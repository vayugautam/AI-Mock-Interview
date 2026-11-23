import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import multer from 'multer';
import { GoogleGenAI, Type } from '@google/genai';
import { generateContentResilient } from './geminiResilient';
import { synthesizeInterviewerQuestion } from './groqQuestionGenerator';
import { transcribeWavWithGemini } from './speechToText';
import { SqliteSessionStore } from './sqliteSessionStore';
import { KnowledgeBaseStore, ANNOTATED_EVAL_SET } from './knowledgeBase';
import {
  DEFAULT_EARLY_FUSION_WEIGHTS,
  normalizeEarlyFusionWeights,
  evaluateMultimodalAnswer,
  mapScoreToBand,
  runSemester7Benchmark,
} from './evaluationEngine';
import type { EarlyFusionWeights } from './evaluationEngine';
import {
  DocumentValidationError,
  MAX_PDF_SIZE_BYTES,
  splitIntoSemanticChunks,
  validateAndExtractPdf,
  validatePastedText,
} from './pdfExtractor';
import { DocumentStore, toPublicDocumentSummary } from './documentStore';
import {
  AiServiceError,
  analyzeJobDescription,
  analyzeResume,
  computeSkillGap,
  performBoundedWebResearch,
  DOCUMENT_ANALYSIS_PROMPT_VERSION,
} from './documentAnalyzer';
import {
  generateJdResumeQuestions,
  QUESTION_PROMPT_VERSION,
  validateInterviewConfig,
} from './interviewService';
import type {
  JobDescriptionAnalysis,
  ResumeAnalysis,
  SkillPerformanceSummary,
  WebResearchSource,
} from '../src/types';

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
  targetField?: string;
  difficulty?: string;
  interviewType?: string;
  skills?: string[];
  activeJdId?: string;
  activeResumeId?: string;
}

export interface InterviewRecord {
  id: string;
  userId: string;
  techField: string;
  jdId?: string;
  resumeId?: string;
  jdTitle?: string;
  companyName?: string;
  resumeFileName?: string;
  jdMissingSkills?: string[];
  webSources?: WebResearchSource[];
  interviewType: 'technical' | 'behavioral' | 'mixed' | 'behavioural';
  difficulty: 'easy' | 'medium' | 'hard' | 'junior' | 'intermediate' | 'senior' | 'lead';
  ragEnabled: boolean;
  questionCount: number;
  questionGenerationSource?: 'gemini' | 'groq' | 'curated_fallback';
  questionPromptVersion?: string;
  questionSchemaValid?: boolean;
  generationLatencyMs?: number;
  createdAt: string;
  completedAt?: string;
  questions: Array<{
    id: number;
    question: string;
    topic: string;
    subject: string;
    interviewType: 'technical' | 'behavioral' | 'behavioural';
    questionType?: 'technical' | 'behavioral';
    difficulty: string;
    skillBeingAssessed?: string;
    jdRelevance?: string;
    resumeAlignment?: 'resume_verified' | 'skill_gap' | 'jd_core';
    expectedKeywords: string[];
    referenceAnswer?: string;
    hint?: string;
    retrievedChunkIds?: string[];
    isAdaptiveFollowUp?: boolean;
  }>;
  answers: Array<{
    questionId: number;
    question: string;
    topic: string;
    skillBeingAssessed?: string;
    resumeAlignment?: 'resume_verified' | 'skill_gap' | 'jd_core';
    interviewType: 'technical' | 'behavioral' | 'behavioural';
    inputModality: 'text' | 'voice';
    rawTranscript: string;
    cleanedTranscript: string;
    evaluation: any;
  }>;
  report?: any;
}

export interface CreateAppOptions {
  dataDir: string;
  aiClient?: GoogleGenAI;
  hasApiKey?: boolean;
}

function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
}

function normalizeDeliveryTelemetry(input: unknown) {
  if (!input || typeof input !== 'object') return undefined;
  const values = input as Record<string, unknown>;
  const bounded = (key: string, min: number, max: number) => {
    const value = Number(values[key]);
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : undefined;
  };
  return {
    speakingRateWpm: bounded('speakingRateWpm', 0, 400),
    pauseFrequencyPerMin: bounded('pauseFrequencyPerMin', 0, 60),
    trimmedDurationSeconds: bounded('trimmedDurationSeconds', 1, 1800),
    normalizedGainDb: bounded('normalizedGainDb', -30, 30),
    sampleRateHz: bounded('sampleRateHz', 8000, 48000),
  };
}

export function createApp(options: CreateAppOptions) {
  const { dataDir } = options;
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const ai =
    options.aiClient ||
    new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY || '',
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

  const isAiKeyConfigured = () =>
    (options.hasApiKey !== undefined ? options.hasApiKey : Boolean(process.env.GEMINI_API_KEY)) || Boolean(process.env.GROQ_API_KEY);

  const USERS_FILE = path.join(dataDir, 'users.json');
  const INTERVIEWS_FILE = path.join(dataDir, 'interviews_d2.json');
  const FUSION_WEIGHTS_FILE = path.join(dataDir, 'early_fusion_weights.json');
  const sessionStore = new SqliteSessionStore(dataDir);
  sessionStore.migrateLegacyJson(USERS_FILE, INTERVIEWS_FILE);
  let earlyFusionWeights: EarlyFusionWeights = { ...DEFAULT_EARLY_FUSION_WEIGHTS };
  try {
    if (fs.existsSync(FUSION_WEIGHTS_FILE)) {
      earlyFusionWeights = normalizeEarlyFusionWeights(JSON.parse(fs.readFileSync(FUSION_WEIGHTS_FILE, 'utf8')));
    }
  } catch (err) {
    console.warn('Stored early-fusion weights could not be loaded; using the default rubric weights.');
  }

  const kbStore = new KnowledgeBaseStore(dataDir, ai);
  const docStore = new DocumentStore(dataDir);

  let users: Record<string, UserRecord> = sessionStore.loadUsers();
  const sessions: Record<string, string> = {};
  let interviews: InterviewRecord[] = sessionStore.loadInterviews();

  function saveUsers() {
    sessionStore.saveUsers(users);
  }

  function saveInterviews() {
    sessionStore.saveInterviews(interviews);
  }

  function authMiddleware(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
    }

    const token = authHeader.split(' ')[1];
    const userId = sessions[token];
    if (!userId || !users[userId]) {
      return res.status(401).json({ error: 'Unauthorized: Session expired or invalid' });
    }

    (req as any).user = users[userId];
    (req as any).token = token;
    next();
  }

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_PDF_SIZE_BYTES + 1024 * 256 },
  });

  const app = express();
  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ extended: true, limit: '25mb' }));

  // ==========================================
  // AUTH ROUTES (Preserved)
  // ==========================================

  app.post('/api/auth/register', (req, res) => {
    try {
      const { name, email, password, targetField, difficulty, interviewType } = req.body;
      if (!email || !password || !name) {
        return res.status(400).json({ error: 'Name, email, and password are required' });
      }

      const normalizedEmail = String(email).trim().toLowerCase();
      const existingUser = Object.values(users).find((u) => u.email === normalizedEmail);
      if (existingUser) {
        return res.status(409).json({ error: 'An account with this email already exists' });
      }

      const salt = crypto.randomBytes(16).toString('hex');
      const passwordHash = hashPassword(String(password), salt);
      const userId = 'usr_' + crypto.randomUUID();

      const newUser: UserRecord = {
        id: userId,
        name: String(name).trim(),
        email: normalizedEmail,
        passwordHash,
        salt,
        createdAt: new Date().toISOString(),
        targetField: targetField || 'Full Stack Development',
        difficulty: difficulty || 'medium',
        interviewType: interviewType || 'mixed',
        skills: [],
      };

      users[userId] = newUser;
      saveUsers();

      const token = 'tok_' + crypto.randomBytes(32).toString('hex');
      sessions[token] = userId;

      const { passwordHash: _, salt: __, ...safeUser } = newUser;
      return res.status(201).json({ user: safeUser, token });
    } catch {
      return res.status(500).json({ error: 'Failed to create account' });
    }
  });

  app.post('/api/auth/login', (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      const normalizedEmail = String(email).trim().toLowerCase();
      const user = Object.values(users).find((u) => u.email === normalizedEmail);
      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const computedHash = hashPassword(String(password), user.salt);
      if (computedHash !== user.passwordHash) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const token = 'tok_' + crypto.randomBytes(32).toString('hex');
      sessions[token] = user.id;

      const { passwordHash: _, salt: __, ...safeUser } = user;
      return res.json({ user: safeUser, token });
    } catch {
      return res.status(500).json({ error: 'Failed to login' });
    }
  });

  app.post('/api/auth/demo', (_req, res) => {
    try {
      const demoEmail = 'student.demo@hbtu.ac.in';
      let demoUser = Object.values(users).find((u) => u.email === demoEmail);

      if (!demoUser) {
        const salt = crypto.randomBytes(16).toString('hex');
        const passwordHash = hashPassword('demo1234', salt);
        demoUser = {
          id: 'usr_academic_demo',
          name: 'Aarav Verma',
          email: demoEmail,
          passwordHash,
          salt,
          createdAt: new Date().toISOString(),
          targetField: 'Full Stack Development',
          difficulty: 'medium',
          interviewType: 'mixed',
          skills: [],
        };
        users[demoUser.id] = demoUser;
        saveUsers();
      }

      const token = 'tok_' + crypto.randomBytes(32).toString('hex');
      sessions[token] = demoUser.id;

      const { passwordHash: _, salt: __, ...safeUser } = demoUser;
      return res.json({ user: safeUser, token });
    } catch {
      return res.status(500).json({ error: 'Failed to initialize demo session' });
    }
  });

  app.get('/api/auth/me', authMiddleware, (req, res) => {
    const user = (req as any).user as UserRecord;
    const { passwordHash: _, salt: __, ...safeUser } = user;
    return res.json({ user: safeUser });
  });

  app.post('/api/auth/update-profile', authMiddleware, (req, res) => {
    const user = (req as any).user as UserRecord;
    const { targetField, difficulty, interviewType, skills, name } = req.body;
    if (targetField) user.targetField = targetField;
    if (difficulty) user.difficulty = difficulty;
    if (interviewType) user.interviewType = interviewType;
    if (Array.isArray(skills)) user.skills = skills;
    if (name) user.name = String(name).trim();

    users[user.id] = user;
    saveUsers();

    const { passwordHash: _, salt: __, ...safeUser } = user;
    return res.json({ user: safeUser });
  });

  // ==========================================
  // DOCUMENT ROUTES: JD (PDF / Text) & RESUME (PDF)
  // ==========================================

  async function processAndStoreJd(params: {
    user: UserRecord;
    sourceType: 'pdf' | 'text';
    normalizedText: string;
    fileName?: string;
    fileSizeBytes?: number;
    pageCount?: number;
    enableWebResearch?: boolean;
  }) {
    const analysis = await analyzeJobDescription(ai, params.normalizedText, isAiKeyConfigured());
    const research =
      params.enableWebResearch !== false
        ? await performBoundedWebResearch(ai, analysis, isAiKeyConfigured())
        : { summary: '', sources: [], status: 'skipped' as const };

    const jdId = 'jd_' + crypto.randomUUID();
    const textChunks = splitIntoSemanticChunks(params.normalizedText);
    const storedChunks = await kbStore.upsertDocumentChunks({
      userId: params.user.id,
      docId: jdId,
      docType: 'jd',
      subject: analysis.jobTitle !== 'Unknown' ? analysis.jobTitle : 'Job Description',
      chunksText: textChunks.length > 0 ? textChunks : [params.normalizedText.slice(0, 600)],
      expectedConcepts: [
        ...analysis.requiredTechnicalSkills,
        ...analysis.toolsAndTechnologies,
      ],
    });

    const record = docStore.addDocument({
      id: jdId,
      userId: params.user.id,
      docType: 'jd',
      sourceType: params.sourceType,
      fileName: params.fileName,
      fileSizeBytes: params.fileSizeBytes,
      pageCount: params.pageCount,
      charCount: params.normalizedText.length,
      rawText: params.normalizedText,
      normalizedText: params.normalizedText,
      analysis,
      analysisPromptVersion: DOCUMENT_ANALYSIS_PROMPT_VERSION,
      webResearchSummary: research.summary,
      webSources: research.sources,
      webResearchStatus: research.status,
      chunkIds: storedChunks.map((c) => c.id),
    });

    params.user.activeJdId = record.id;
    if (analysis.jobTitle && analysis.jobTitle !== 'Unknown') {
      params.user.targetField = analysis.jobTitle;
    }
    users[params.user.id] = params.user;
    saveUsers();

    return toPublicDocumentSummary(record);
  }

  app.post(
    '/api/documents/jd/upload-pdf',
    authMiddleware,
    upload.single('file'),
    async (req, res) => {
      try {
        const user = (req as any).user as UserRecord;
        const file = req.file;
        if (!file) {
          return res.status(400).json({ error: 'Please select a Job Description PDF file to upload.' });
        }

        const enableWebResearch = req.body?.enableWebResearch !== 'false';
        const extracted = await validateAndExtractPdf({
          buffer: file.buffer,
          originalName: file.originalname,
          mimeType: file.mimetype,
          docLabel: 'Job Description',
        });

        const doc = await processAndStoreJd({
          user,
          sourceType: 'pdf',
          normalizedText: extracted.normalizedText,
          fileName: file.originalname,
          fileSizeBytes: file.size,
          pageCount: extracted.pageCount,
          enableWebResearch,
        });

        return res.status(201).json({ document: doc });
      } catch (err: any) {
        if (err instanceof DocumentValidationError || err instanceof AiServiceError) {
          return res.status(err.statusCode).json({ error: err.message });
        }
        return res.status(500).json({ error: 'Failed to process Job Description PDF.' });
      }
    }
  );

  app.post('/api/documents/jd/text', authMiddleware, async (req, res) => {
    try {
      const user = (req as any).user as UserRecord;
      const { text, enableWebResearch = true } = req.body;

      const normalizedText = validatePastedText(String(text || ''), 'Job Description');
      const doc = await processAndStoreJd({
        user,
        sourceType: 'text',
        normalizedText,
        enableWebResearch: Boolean(enableWebResearch),
      });

      return res.status(201).json({ document: doc });
    } catch (err: any) {
      if (err instanceof DocumentValidationError || err instanceof AiServiceError) {
        return res.status(err.statusCode).json({ error: err.message });
      }
      return res.status(500).json({ error: 'Failed to analyze pasted Job Description text.' });
    }
  });

  app.post(
    '/api/documents/resume/upload-pdf',
    authMiddleware,
    upload.single('file'),
    async (req, res) => {
      try {
        const user = (req as any).user as UserRecord;
        const file = req.file;
        if (!file) {
          return res.status(400).json({ error: 'Please select a Resume PDF file to upload.' });
        }

        const extracted = await validateAndExtractPdf({
          buffer: file.buffer,
          originalName: file.originalname,
          mimeType: file.mimetype,
          docLabel: 'Resume',
        });

        const analysis = await analyzeResume(ai, extracted.normalizedText, isAiKeyConfigured());

        const resumeId = 'res_' + crypto.randomUUID();
        const textChunks = splitIntoSemanticChunks(extracted.normalizedText);
        const storedChunks = await kbStore.upsertDocumentChunks({
          userId: user.id,
          docId: resumeId,
          docType: 'resume',
          subject: 'Candidate Resume',
          chunksText:
            textChunks.length > 0 ? textChunks : [extracted.normalizedText.slice(0, 600)],
          expectedConcepts: [...analysis.candidateSkills, ...analysis.technologiesUsed],
        });

        const record = docStore.addDocument({
          id: resumeId,
          userId: user.id,
          docType: 'resume',
          sourceType: 'pdf',
          fileName: file.originalname,
          fileSizeBytes: file.size,
          pageCount: extracted.pageCount,
          charCount: extracted.normalizedText.length,
          rawText: extracted.normalizedText,
          normalizedText: extracted.normalizedText,
          analysis,
          analysisPromptVersion: DOCUMENT_ANALYSIS_PROMPT_VERSION,
          chunkIds: storedChunks.map((c) => c.id),
        });

        user.activeResumeId = record.id;
        user.skills = analysis.candidateSkills.slice(0, 10);
        users[user.id] = user;
        saveUsers();

        return res.status(201).json({ document: toPublicDocumentSummary(record) });
      } catch (err: any) {
        if (err instanceof DocumentValidationError || err instanceof AiServiceError) {
          return res.status(err.statusCode).json({ error: err.message });
        }
        return res.status(500).json({ error: 'Failed to process Resume PDF.' });
      }
    }
  );

  app.get('/api/documents/current', authMiddleware, (req, res) => {
    const user = (req as any).user as UserRecord;
    const latestJd = user.activeJdId
      ? docStore.getDocumentByIdForUser(user.activeJdId, user.id)
      : docStore.getLatestForUser(user.id, 'jd');
    const latestResume = user.activeResumeId
      ? docStore.getDocumentByIdForUser(user.activeResumeId, user.id)
      : docStore.getLatestForUser(user.id, 'resume');

    return res.json({
      jd: latestJd ? toPublicDocumentSummary(latestJd) : null,
      resume: latestResume ? toPublicDocumentSummary(latestResume) : null,
    });
  });

  app.get('/api/documents/:id', authMiddleware, (req, res) => {
    const user = (req as any).user as UserRecord;
    const rawDoc = docStore.getDocumentRawById(req.params.id);
    if (!rawDoc) {
      return res.status(404).json({ error: 'Document not found' });
    }
    if (rawDoc.userId !== user.id) {
      return res.status(403).json({ error: 'Forbidden: You do not have access to this document.' });
    }
    return res.json({ document: toPublicDocumentSummary(rawDoc) });
  });

  // ==========================================
  // KNOWLEDGE BASE (D1) & RAG ROUTES (Preserved)
  // ==========================================

  app.get('/api/kb/chunks', authMiddleware, (req, res) => {
    const subject = typeof req.query.subject === 'string' ? req.query.subject : '';
    const interviewType = typeof req.query.interviewType === 'string' ? req.query.interviewType : '';
    const q = typeof req.query.q === 'string' ? req.query.q.toLowerCase().trim() : '';

    let items = kbStore.getAllChunks(false).map((c) => ({
      id: c.id,
      subject: c.subject,
      interviewType: c.interviewType,
      difficulty: c.difficulty,
      question: c.question,
      referenceAnswer: c.referenceAnswer,
      expectedConcepts: c.expectedConcepts,
      rubricFocus: c.rubricFocus,
      hasEmbedding: c.embedding.length > 0,
      embeddingDimensions: c.embedding.length,
      embeddingSource: c.embeddingSource,
      createdBy: c.createdBy,
      createdAt: c.createdAt,
    }));

    if (subject && subject !== 'All') {
      items = items.filter((i) => i.subject.toLowerCase() === subject.toLowerCase());
    }
    if (interviewType && interviewType !== 'all') {
      items = items.filter((i) => i.interviewType === interviewType);
    }
    if (q) {
      items = items.filter(
        (i) =>
          i.question.toLowerCase().includes(q) ||
          i.referenceAnswer.toLowerCase().includes(q) ||
          i.expectedConcepts.some((c) => c.toLowerCase().includes(q))
      );
    }

    return res.json({ chunks: items, total: items.length });
  });

  app.post('/api/kb/chunks', authMiddleware, async (req, res) => {
    try {
      const user = (req as any).user as UserRecord;
      const {
        subject,
        interviewType,
        difficulty,
        question,
        referenceAnswer,
        expectedConcepts,
        rubricFocus,
      } = req.body;

      if (!subject || !question || !referenceAnswer) {
        return res
          .status(400)
          .json({ error: 'Subject, question, and referenceAnswer are required' });
      }

      const conceptsArr = Array.isArray(expectedConcepts)
        ? expectedConcepts
        : String(expectedConcepts || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);

      const created = await kbStore.addChunk({
        subject,
        interviewType: interviewType || 'technical',
        difficulty: difficulty || 'medium',
        question,
        referenceAnswer,
        expectedConcepts: conceptsArr.length > 0 ? conceptsArr : ['core concept', 'trade-offs'],
        rubricFocus,
        createdBy: user.name,
      });

      return res.status(201).json({
        chunk: {
          ...created,
          hasEmbedding: created.embedding.length > 0,
          embeddingDimensions: created.embedding.length,
          embedding: undefined,
        },
      });
    } catch {
      return res.status(500).json({ error: 'Failed to store knowledge chunk' });
    }
  });

  app.post('/api/kb/search', authMiddleware, async (req, res) => {
    try {
      const { query, subject, interviewType, topK } = req.body;
      if (!query) {
        return res.status(400).json({ error: 'Query is required' });
      }
      const results = await kbStore.retrieveTopK({
        query,
        subject,
        interviewType,
        topK: topK || 4,
        scopeFilter: 'global',
      });
      return res.json({
        results: results.map((r) => ({
          ...r,
          hasEmbedding: r.embedding.length > 0,
          embeddingDimensions: r.embedding.length,
          embedding: undefined,
        })),
      });
    } catch {
      return res.status(500).json({ error: 'Failed to search knowledge base' });
    }
  });

  app.post('/api/kb/reindex', authMiddleware, async (_req, res) => {
    try {
      const stats = await kbStore.reindexAllWithGemini();
      return res.json(stats);
    } catch {
      return res.status(500).json({ error: 'Failed to reindex knowledge base' });
    }
  });

  // ==========================================
  // JD + RESUME INTERVIEW QUESTION GENERATION
  // ==========================================

  app.post('/api/interview/generate-questions', authMiddleware, async (req, res) => {
    try {
      const user = (req as any).user as UserRecord;
      const { jdId, resumeId, questionCount, interviewType, difficulty } = req.body;

      if (!jdId || !resumeId) {
        return res.status(400).json({
          error: 'Both a valid Job Description and Resume must be provided before generating the interview.',
        });
      }

      const rawJd = docStore.getDocumentRawById(String(jdId));
      const rawResume = docStore.getDocumentRawById(String(resumeId));

      if (!rawJd || rawJd.docType !== 'jd') {
        return res.status(404).json({ error: 'Job Description document not found.' });
      }
      if (!rawResume || rawResume.docType !== 'resume') {
        return res.status(404).json({ error: 'Resume document not found.' });
      }
      if (rawJd.userId !== user.id || rawResume.userId !== user.id) {
        return res.status(403).json({
          error: 'Forbidden: You can only generate interviews using your own uploaded documents.',
        });
      }

      const config = validateInterviewConfig({ questionCount, interviewType, difficulty });

      const recentQuestions = interviews
        .filter((s) => s.userId === user.id)
        .slice(-3)
        .flatMap((s) => s.questions.map((q) => q.question))
        .slice(0, 12);

      const generated = await generateJdResumeQuestions({
        ai,
        kb: kbStore,
        userId: user.id,
        jdDoc: rawJd,
        resumeDoc: rawResume,
        config,
        recentQuestions,
        hasApiKey: isAiKeyConfigured() || Boolean(process.env.GROQ_API_KEY),
        hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
        hasGroqKey: Boolean(process.env.GROQ_API_KEY),
      });

      const jdAnalysis = rawJd.analysis as JobDescriptionAnalysis;
      const roleTitle =
        jdAnalysis.jobTitle !== 'Unknown' ? jdAnalysis.jobTitle : 'JD-Driven Placement Interview';

      // Update user profile preferences cleanly
      user.targetField = roleTitle;
      user.difficulty = config.difficulty;
      user.interviewType = config.interviewType;
      users[user.id] = user;
      saveUsers();

      const interviewSession: InterviewRecord = {
        id: 'int_' + crypto.randomUUID(),
        userId: user.id,
        techField: roleTitle,
        jdId: rawJd.id,
        resumeId: rawResume.id,
        jdTitle: roleTitle,
        companyName: jdAnalysis.companyName,
        resumeFileName: rawResume.fileName,
        jdMissingSkills: generated.jdMissingSkills,
        webSources: generated.webSources,
        interviewType: config.interviewType,
        difficulty: config.difficulty,
        ragEnabled: true,
        questionCount: config.questionCount,
        questionGenerationSource: generated.questionGenerationSource,
        questionPromptVersion: generated.promptVersion || QUESTION_PROMPT_VERSION,
        questionSchemaValid: generated.questionSchemaValid,
        generationLatencyMs: generated.generationLatencyMs,
        createdAt: new Date().toISOString(),
        questions: generated.questions.map((q) => ({
          ...q,
          interviewType: q.interviewType,
        })),
        answers: [],
      };

      interviews.push(interviewSession);
      saveInterviews();

      return res.json({
        interviewId: interviewSession.id,
        techField: roleTitle,
        jdTitle: roleTitle,
        companyName: jdAnalysis.companyName,
        resumeFileName: rawResume.fileName,
        jdMissingSkills: generated.jdMissingSkills,
        webSources: generated.webSources,
        interviewType: config.interviewType,
        difficulty: config.difficulty,
        ragEnabled: true,
        questionCount: config.questionCount,
        questionGenerationSource: interviewSession.questionGenerationSource,
        questionPromptVersion: interviewSession.questionPromptVersion,
        questionSchemaValid: interviewSession.questionSchemaValid,
        generationLatencyMs: interviewSession.generationLatencyMs,
        // Keep answer keys server-side until the final interview report is fetched.
        questions: interviewSession.questions.map(({ referenceAnswer: _referenceAnswer, ...question }) => question),
      });
    } catch (err: any) {
      if (err instanceof AiServiceError || err instanceof DocumentValidationError) {
        return res.status(err.statusCode).json({ error: err.message });
      }
      console.error('Question generation error:', err);
      return res.status(500).json({ error: 'Failed to generate personalized interview questions.' });
    }
  });

  // ==========================================
  // ANSWER EVALUATION (Text-based, Duplicate Guarded, Grounded)
  // ==========================================

  app.post('/api/speech/synthesize-question', authMiddleware, async (req, res) => {
    try {
      const questionText = String(req.body?.questionText || '').trim();
      const persona = String(req.body?.persona || 'calm_recruiter');
      if (!questionText || questionText.length > 2000) {
        return res.status(400).json({ error: 'Provide a question under 2,000 characters.' });
      }
      if (!process.env.GROQ_API_KEY) {
        // Empty audio tells the client to use its built-in speech voice without
        // exposing provider configuration as a candidate-facing error.
        return res.json({ audioSegments: [] });
      }
      const audioSegments = await synthesizeInterviewerQuestion(questionText, persona);
      return res.json({ audioSegments });
    } catch (err: any) {
      console.warn('Question audio generation failed:', err?.message || err);
      return res.status(502).json({ error: 'Could not generate question audio.' });
    }
  });

  app.post('/api/interview/evaluate-answer', authMiddleware, async (req, res) => {
    try {
      const user = (req as any).user as UserRecord;
      const {
        interviewId,
        questionId,
        candidateAnswer,
        rawTranscript,
        inputModality: requestedModality = 'text',
        audioWavBase64,
        audioDurationSeconds = 0,
        deliveryTelemetry,
        allowResubmit = false,
      } = req.body;
      const inputModality = requestedModality === 'voice' ? 'voice' : 'text';
      let answerText = String(candidateAnswer || rawTranscript || '').trim();

      if (inputModality === 'voice' && audioWavBase64 !== undefined && (
        typeof audioWavBase64 !== 'string' ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(audioWavBase64)
      )) {
        return res.status(400).json({ error: 'The uploaded voice recording is invalid.' });
      }
      if (inputModality === 'voice' && typeof audioWavBase64 === 'string' && audioWavBase64.length > 20_000_000) {
        return res.status(413).json({ error: 'Recorded answer exceeds the 15 MB upload limit.' });
      }
      if (inputModality === 'voice' && !answerText && !audioWavBase64) {
        return res.status(400).json({ error: 'Add a live transcript or record audio for transcription.' });
      }
      if (inputModality === 'voice' && !answerText && !isAiKeyConfigured()) {
        return res.status(503).json({ error: 'Voice transcription requires GEMINI_API_KEY or GROQ_API_KEY when browser transcription is unavailable.' });
      }
      if (inputModality === 'voice' && !answerText && audioWavBase64) {
        try {
          answerText = await transcribeWavWithGemini(ai, audioWavBase64);
        } catch (err: any) {
          const transcriptionError: any = new Error(`Voice transcription failed: ${err?.message || 'Gemini could not transcribe the recording.'}`);
          transcriptionError.statusCode = 502;
          throw transcriptionError;
        }
      }

      if (!interviewId || questionId === undefined || !answerText) {
        return res.status(400).json({
          error: 'interviewId, questionId, and an answer transcript are required. For voice answers, make sure your recording contains clear speech.',
        });
      }

      const interview = interviews.find((i) => i.id === interviewId);
      if (!interview) {
        return res.status(404).json({ error: 'Interview session not found.' });
      }
      if (interview.userId !== user.id) {
        return res.status(403).json({ error: 'Forbidden: Cannot submit answers to another user’s session.' });
      }

      const qObj = interview.questions.find((q) => q.id === Number(questionId));
      if (!qObj) {
        return res.status(404).json({ error: 'Question not found in this interview session.' });
      }

      const existingIdx = interview.answers.findIndex((a) => a.questionId === qObj.id);
      if (existingIdx >= 0 && !allowResubmit && !interview.answers[existingIdx].evaluation?.isOffTopic) {
        return res.status(409).json({
          error: 'An answer for this question has already been submitted and evaluated.',
        });
      }

      const allowedDocIds = [interview.jdId, interview.resumeId].filter(
        (id): id is string => Boolean(id)
      );

      const evaluation = await evaluateMultimodalAnswer({
        ai,
        kb: kbStore,
        questionText: qObj.question,
        subject: qObj.topic || interview.techField,
        interviewType: qObj.questionType || qObj.interviewType || 'technical',
        expectedKeywords: qObj.expectedKeywords || [],
        rawAnswerText: String(rawTranscript || answerText).trim(),
        inputModality,
        audioDurationSeconds: Number(audioDurationSeconds) || 0,
        deliveryTelemetry: inputModality === 'voice' ? normalizeDeliveryTelemetry(deliveryTelemetry) : undefined,
        referenceAnswerOverride: qObj.referenceAnswer,
        userId: user.id,
        allowedDocIds,
        strictAiMode: true,
        hasApiKey: isAiKeyConfigured(),
        hasGroqKey: Boolean(process.env.GROQ_API_KEY),
        earlyFusionWeights,
      });

      const answerEntry = {
        questionId: qObj.id,
        question: qObj.question,
        topic: qObj.topic || interview.techField,
        skillBeingAssessed: qObj.skillBeingAssessed,
        resumeAlignment: qObj.resumeAlignment,
        interviewType: qObj.questionType || qObj.interviewType || 'technical',
        inputModality,
        rawTranscript: evaluation.rawTranscript,
        cleanedTranscript: evaluation.cleanedTranscript,
        evaluation,
      };

      if (existingIdx >= 0) {
        interview.answers[existingIdx] = answerEntry;
      } else {
        interview.answers.push(answerEntry);
      }

      saveInterviews();

      return res.json({ evaluation, answerEntry });
    } catch (err: any) {
      if (err?.statusCode) {
        return res.status(err.statusCode).json({ error: err.message });
      }
      console.error('Answer evaluation error:', err);
      return res.status(500).json({ error: 'Failed to evaluate answer.' });
    }
  });

  app.post('/api/interview/generate-ideal-answer', authMiddleware, async (req, res) => {
    try {
      const { questionText, topic, techField, difficulty, referenceAnswer } = req.body;
      if (!questionText) {
        return res.status(400).json({ error: 'Missing questionText' });
      }

      if (referenceAnswer) {
        return res.json({
          idealAnswer: {
            summary: `Grounded reference answer for ${topic || techField || 'this question'}`,
            keyPoints: [],
            fullIdealAnswer: referenceAnswer,
            tradeOffsAndConsiderations: 'Tailor explanation to concrete examples and edge cases.',
            mustMentionKeywords: [],
          },
        });
      }

      if (!isAiKeyConfigured()) {
        return res.status(503).json({
          error: 'Reference answer generation requires GEMINI_API_KEY in Settings > Secrets.',
        });
      }

      const retrieved = await kbStore.retrieveTopK({
        query: `${techField || ''} ${questionText}`,
        subject: techField,
        topK: 1,
        scopeFilter: 'global',
      });
      const kbMatch = retrieved[0];

      const response = await generateContentResilient(ai, {
        model: 'gemini-4-hydrogen',
        contents: `Provide a clear reference model answer for:
Role/Subject: ${techField || 'Interview Topic'} (${difficulty || 'medium'} level)
Topic: ${topic || 'Core Concepts'}
Question: "${questionText}"
${kbMatch ? `Knowledge Base Reference:\n"${kbMatch.referenceAnswer}"` : ''}`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              keyPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
              fullIdealAnswer: { type: Type.STRING },
              tradeOffsAndConsiderations: { type: Type.STRING },
              mustMentionKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
          },
          systemInstruction: 'You are an expert technical interviewer. Output valid JSON only.',
        },
      });

      const idealAnswer = JSON.parse(response.text || '{}');
      if (kbMatch) idealAnswer.groundedFromKbId = kbMatch.id;
      return res.json({ idealAnswer });
    } catch {
      return res.status(500).json({ error: 'Failed to generate reference answer' });
    }
  });

  // ==========================================
  // FINAL REPORT & ANALYTICS
  // ==========================================

  app.post('/api/interview/finalize', authMiddleware, async (req, res) => {
    try {
      const user = (req as any).user as UserRecord;
      const { interviewId } = req.body;
      const interview = interviews.find((i) => i.id === interviewId);
      if (!interview) {
        return res.status(404).json({ error: 'Interview session not found' });
      }
      if (interview.userId !== user.id) {
        return res.status(403).json({ error: 'Forbidden: Cannot access another user’s interview report.' });
      }

      // If already finalized with same answer count, return saved report
      if (
        interview.report &&
        interview.report.questionsAnswered === interview.answers.length &&
        interview.completedAt
      ) {
        return res.json({ report: interview.report, interview });
      }

      const answers = interview.answers;
      const n = answers.length;
      const avg = (arr: number[]) =>
        arr.length > 0 ? Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1)) : 0;

      const overallScoreOutOf10 = avg(answers.map((a) => a.evaluation.overallScoreOutOf10));
      const earlyFusionAvg = avg(answers.map((a) => a.evaluation.earlyFusionScore));
      const lateFusionAvg = avg(answers.map((a) => a.evaluation.lateFusionScore));
      const consistencyAvg =
        n > 0
          ? Number(
              (
                answers.reduce((acc, a) => acc + (a.evaluation.consistencyIndicator || 0.85), 0) / n
              ).toFixed(2)
            )
          : 0;

      const criteriaAverages = {
        technicalCorrectness: avg(answers.map((a) => a.evaluation.criteria.technicalCorrectness)),
        relevance: avg(answers.map((a) => a.evaluation.criteria.relevance)),
        clarity: avg(answers.map((a) => a.evaluation.criteria.clarity)),
        completeness: avg(answers.map((a) => a.evaluation.criteria.completeness)),
        communication: avg(answers.map((a) => a.evaluation.criteria.communication)),
      };

      const techScores = answers
        .filter((a) => a.interviewType === 'technical')
        .map((a) => a.evaluation.overallScoreOutOf10);
      const behScores = answers
        .filter((a) => a.interviewType === 'behavioral' || a.interviewType === 'behavioural')
        .map((a) => a.evaluation.overallScoreOutOf10);

      const technicalPerformance = techScores.length > 0 ? avg(techScores) : null;
      const behavioralPerformance = behScores.length > 0 ? avg(behScores) : null;

      // Skill-wise performance aggregation
      const skillMap = new Map<
        string,
        { scores: number[]; alignment?: 'resume_verified' | 'skill_gap' | 'jd_core' }
      >();
      for (const ans of answers) {
        const skillName = ans.skillBeingAssessed || ans.topic || 'Core Competency';
        const existing = skillMap.get(skillName) || {
          scores: [],
          alignment: ans.resumeAlignment,
        };
        existing.scores.push(ans.evaluation.overallScoreOutOf10);
        skillMap.set(skillName, existing);
      }

      const skillPerformance: SkillPerformanceSummary[] = Array.from(skillMap.entries()).map(
        ([skill, info]) => {
          const scoreOutOf10 = avg(info.scores);
          return {
            skill,
            scoreOutOf10,
            band: mapScoreToBand(scoreOutOf10),
            questionCount: info.scores.length,
            alignment: info.alignment,
          };
        }
      );

      const categoryMap = new Map<string, number[]>();
      for (const ans of answers) {
        const list = categoryMap.get(ans.topic) || [];
        list.push(ans.evaluation.overallScoreOutOf10);
        categoryMap.set(ans.topic, list);
      }

      const categoryPerformance = Array.from(categoryMap.entries()).map(([topic, scores]) => {
        const topicAvg = avg(scores);
        return {
          topic,
          scoreOutOf10: topicAvg,
          band: mapScoreToBand(topicAvg),
        };
      });

      // Compute JD skills missing from Resume dynamically if docs present, or reuse session gap
      let jdMissingSkills = interview.jdMissingSkills || [];
      if (interview.jdId && interview.resumeId) {
        const jdDoc = docStore.getDocumentByIdForUser(interview.jdId, user.id);
        const resDoc = docStore.getDocumentByIdForUser(interview.resumeId, user.id);
        if (jdDoc && resDoc) {
          jdMissingSkills = computeSkillGap(
            jdDoc.analysis as JobDescriptionAnalysis,
            resDoc.analysis as ResumeAnalysis
          ).missingFromResumeSkills;
        }
      }

      // Strong and weak areas derived strictly from actual evaluated skill/answer data
      const strongSkills = skillPerformance
        .filter((s) => s.scoreOutOf10 >= 7.0)
        .map((s) => `${s.skill} (${s.scoreOutOf10.toFixed(1)}/10)`);
      const weakSkills = skillPerformance
        .filter((s) => s.scoreOutOf10 < 6.5)
        .map((s) => `${s.skill} (${s.scoreOutOf10.toFixed(1)}/10)`);

      const allStrengths = Array.from(
        new Set([...strongSkills, ...answers.flatMap((a) => a.evaluation.strengths || [])])
      ).slice(0, 6);

      const allWeaknesses = Array.from(
        new Set([...weakSkills, ...answers.flatMap((a) => a.evaluation.weaknesses || [])])
      ).slice(0, 6);

      const allMissingConcepts = Array.from(
        new Set(answers.flatMap((a) => a.evaluation.missingConcepts || []))
      ).slice(0, 8);

      const recommendedTopics = Array.from(
        new Set([...jdMissingSkills.slice(0, 4), ...allMissingConcepts.slice(0, 4)])
      ).slice(0, 8);

      const performanceBand = mapScoreToBand(overallScoreOutOf10);

      let detailedSummary =
        n > 0
          ? `Completed ${n} of ${interview.questions.length} questions for ${interview.jdTitle || interview.techField} with an overall score of ${overallScoreOutOf10.toFixed(1)}/10 (${performanceBand}).${
              technicalPerformance !== null
                ? ` Technical average: ${technicalPerformance.toFixed(1)}/10.`
                : ''
            }${
              behavioralPerformance !== null
                ? ` Behavioral average: ${behavioralPerformance.toFixed(1)}/10.`
                : ''
            }`
          : 'No answers have been evaluated yet in this session.';

      if (isAiKeyConfigured() && n > 0) {
        try {
          const response = await generateContentResilient(ai, {
            model: 'gemini-4-hydrogen',
            contents: `Summarize this completed mock interview concisely in 3 sentences using ONLY these actual metrics (do NOT invent scores or hiring verdicts):
Role: ${interview.jdTitle || interview.techField}
Questions Answered: ${n} / ${interview.questions.length}
Overall Score: ${overallScoreOutOf10}/10 (${performanceBand})
Technical Performance: ${technicalPerformance !== null ? technicalPerformance + '/10' : 'N/A'}
Behavioral Performance: ${behavioralPerformance !== null ? behavioralPerformance + '/10' : 'N/A'}
JD Skills Missing From Resume: ${jdMissingSkills.join(', ') || 'None'}
Missed Concepts During Interview: ${allMissingConcepts.join(', ') || 'None'}`,
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  detailedSummary: { type: Type.STRING },
                },
              },
            },
          });
          const parsed = JSON.parse(response.text || '{}');
          if (parsed?.detailedSummary) {
            detailedSummary = parsed.detailedSummary;
          }
        } catch (err: any) {
          console.warn('Report narrative synthesis skipped:', err?.message || err);
        }
      }

      const report = {
        totalQuestions: interview.questions.length,
        questionsAnswered: n,
        overallScoreOutOf10,
        performanceBand,
        technicalPerformance,
        behavioralPerformance,
        earlyFusionAvg,
        lateFusionAvg,
        consistencyAvg,
        criteriaAverages,
        skillPerformance,
        categoryPerformance,
        jdMissingSkills,
        strengths: allStrengths,
        areasForImprovement: allWeaknesses,
        recommendedTopics,
        detailedSummary,
      };

      interview.report = report;
      interview.completedAt = new Date().toISOString();
      saveInterviews();

      return res.json({ report, interview });
    } catch (err: any) {
      console.error('Finalize error:', err);
      return res.status(500).json({ error: 'Failed to finalize interview report' });
    }
  });

  app.get('/api/interview/history', authMiddleware, (req, res) => {
    const user = (req as any).user as UserRecord;
    const userInterviews = interviews
      .filter((i) => i.userId === user.id && (i.answers.length > 0 || i.report))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return res.json({ interviews: userInterviews });
  });

  app.get('/api/interview/:id', authMiddleware, (req, res) => {
    const user = (req as any).user as UserRecord;
    const rawInterview = interviews.find((i) => i.id === req.params.id);
    if (!rawInterview) {
      return res.status(404).json({ error: 'Interview not found' });
    }
    if (rawInterview.userId !== user.id) {
      return res.status(403).json({ error: 'Forbidden: You cannot view another user’s session.' });
    }
    return res.json({ interview: rawInterview });
  });

  // ==========================================
  // VALIDATION BENCHMARK (Preserved)
  // ==========================================

  app.get('/api/validation/samples', authMiddleware, (_req, res) => {
    return res.json({ samples: ANNOTATED_EVAL_SET });
  });

  app.post('/api/validation/run-benchmark', authMiddleware, async (_req, res) => {
    try {
      const result = await runSemester7Benchmark(ai, kbStore, interviews);
      earlyFusionWeights = normalizeEarlyFusionWeights(result.tunedEarlyFusionWeights);
      fs.writeFileSync(FUSION_WEIGHTS_FILE, JSON.stringify(earlyFusionWeights, null, 2), 'utf8');
      return res.json({ ...result, tunedEarlyFusionWeights: earlyFusionWeights });
    } catch {
      return res.status(500).json({ error: 'Failed to execute validation benchmark' });
    }
  });

  // Multer error handler (returns clean JSON instead of HTML stack traces)
  app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Uploaded PDF exceeds the maximum allowed 5 MB size limit.' });
    }
    if (err) {
      return res.status(err.statusCode || 400).json({ error: err.message || 'Invalid request payload' });
    }
    next();
  });

  return { app, kbStore, docStore };
}
