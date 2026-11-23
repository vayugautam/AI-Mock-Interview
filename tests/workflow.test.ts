import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { GoogleGenAI } from '@google/genai';
import { createApp } from '../server/createApp';

/**
 * Generates a syntactically valid, uncompressed single-page PDF 1.4 buffer
 * containing plain selectable text that `unpdf` extracts cleanly.
 */
function buildValidPdfBuffer(textLines: string[]): Buffer {
  const escaped = textLines
    .map((line) => line.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'))
    .map((line, i) => `(${line}) Tj ${i < textLines.length - 1 ? '0 -16 Td' : ''}`)
    .join('\n');

  const streamContent = `BT\n/F1 12 Tf\n50 740 Td\n${escaped}\nET\n`;

  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(streamContent, 'utf8')} >>\nstream\n${streamContent}endstream\nendobj\n`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];

  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj;
  }

  const xrefStart = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(pdf, 'utf8');
}

function createMockAiClient(opts?: {
  failWebResearch?: boolean;
  malformedQuestionJson?: boolean;
}) {
  const capturedPrompts: string[] = [];

  const mockAi = {
    models: {
      generateContent: async (args: any) => {
        const prompt = String(args?.contents || '');
        capturedPrompts.push(prompt);

        // 1. Bounded Web Research (tools: [{ googleSearch: {} }])
        if (args?.config?.tools?.some((t: any) => 'googleSearch' in t)) {
          if (opts?.failWebResearch) {
            throw new Error('Simulated network timeout during web grounding');
          }
          return {
            text: 'Acme Cloud Engineering relies on distributed TypeScript services, PostgreSQL optimization, Redis caching, and Kubernetes observability.',
            candidates: [
              {
                groundingMetadata: {
                  groundingChunks: [
                    {
                      web: {
                        title: 'Acme Engineering Blog — Architecture',
                        uri: 'https://engineering.example.com/acme-stack',
                      },
                    },
                    {
                      web: {
                        title: 'PostgreSQL Indexing Guide',
                        uri: 'https://postgres.example.org/docs/indexes',
                      },
                    },
                  ],
                },
              },
            ],
          };
        }

        // 2. JD Extraction
        if (prompt.includes('Analyze the following Job Description strictly')) {
          return {
            text: JSON.stringify({
              jobTitle: 'Senior Backend Engineer',
              companyName: 'Acme Cloud',
              requiredTechnicalSkills: ['TypeScript', 'PostgreSQL', 'Redis', 'Kubernetes'],
              preferredSkills: ['GraphQL', 'Terraform'],
              responsibilities: [
                'Design low-latency REST and WebSocket APIs',
                'Optimize PostgreSQL queries and composite indexes',
                'Lead incident reviews and mentor junior engineers',
              ],
              requiredExperience: '3+ years backend engineering',
              toolsAndTechnologies: ['Node.js', 'Docker', 'PostgreSQL', 'Redis'],
              importantQualifications: ['B.S. in Computer Science or equivalent'],
            }),
          };
        }

        // 3. Resume Extraction
        if (prompt.includes('Analyze the following candidate Resume strictly')) {
          return {
            text: JSON.stringify({
              candidateSkills: ['TypeScript', 'Node.js', 'PostgreSQL', 'React'],
              workExperience: [
                {
                  role: 'Software Engineer',
                  company: 'FinLedger Systems',
                  duration: '2022 - Present',
                  highlights: [
                    'Built Node.js billing microservices processing 50k events/day',
                    'Reduced PostgreSQL p95 query latency by 40% via composite indexes',
                  ],
                },
              ],
              projects: [
                {
                  name: 'Real-Time Analytics Gateway',
                  description: 'High-throughput Node.js ingestion pipeline backed by Postgres',
                  technologies: ['TypeScript', 'Node.js', 'PostgreSQL', 'Docker'],
                },
              ],
              education: ['B.Tech in Computer Science'],
              technologiesUsed: ['TypeScript', 'Node.js', 'PostgreSQL', 'Docker'],
              achievements: ['Reduced p95 API latency by 40%'],
            }),
          };
        }

        // 4. Question Generation
        if (prompt.includes('personalized, grounded mock interview with EXACTLY')) {
          if (opts?.malformedQuestionJson) {
            return { text: '{broken json output' };
          }
          const match = prompt.match(/EXACTLY (\d+) distinct questions/);
          const count = match ? Number(match[1]) : 5;
          const isBehavioralOnly = prompt.includes('Interview Type: behavioral');

          const questions = Array.from({ length: count }, (_, idx) => {
            const isBeh = isBehavioralOnly || (!prompt.includes('Interview Type: technical') && idx % 3 === 2);
            const isGap = !isBeh && idx % 2 === 1;
            const skill = isBeh
              ? 'Incident Leadership'
              : isGap
              ? idx === 1
                ? 'Kubernetes'
                : 'Redis'
              : 'PostgreSQL';

            return {
              question: isBeh
                ? `In your FinLedger Systems role (#${idx + 1}), describe a high-severity production incident you led and measurable actions taken.`
                : isGap
                ? `The JD requires ${skill} (${idx + 1}), which is not highlighted on your resume. How would you architect ${skill} for Acme Cloud scale?`
                : `On your FinLedger billing microservices (#${idx + 1}), how did you tune ${skill} composite indexes to cut p95 latency by 40%?`,
              topic: isBeh ? 'Engineering Ownership' : `${skill} Architecture`,
              difficulty: 'medium',
              questionType: isBeh ? 'behavioral' : 'technical',
              skillBeingAssessed: skill,
              jdRelevance: `Required for Senior Backend Engineer at Acme Cloud (${skill})`,
              resumeAlignment: isGap ? 'skill_gap' : isBeh ? 'resume_verified' : 'resume_verified',
              expectedKeywords: isBeh
                ? ['situation', 'task', 'action', 'result', 'root cause']
                : [skill, 'latency', 'trade-offs', 'scalability'],
              referenceAnswer: isBeh
                ? 'Frame Situation, Task, personal Action in debugging and mitigation, and quantifiable Result.'
                : `Explain ${skill} architecture, failure modes, memory/consistency trade-offs, and monitoring metrics.`,
              hint: `Connect directly to ${skill} constraints.`,
            };
          });

          return { text: JSON.stringify({ questions }) };
        }

        // 5. Answer Evaluation
        if (prompt.includes('structured rubric evaluator')) {
          const lower = prompt.toLowerCase();
          const isOffTopic = lower.includes('pizza') || lower.includes('cricket');
          if (isOffTopic) {
            return {
              text: JSON.stringify({
                technicalCorrectness: 1.0,
                relevance: 1.2,
                clarity: 4.0,
                completeness: 1.0,
                communication: 4.0,
                isOffTopic: true,
                offTopicReason: 'The response discussed unrelated leisure topics instead of the interview prompt.',
                feedback: 'Off-topic response detected.',
                strengths: ['Complete sentences'],
                weaknesses: ['Did not address the asked technical/behavioral prompt'],
                missingConcepts: ['PostgreSQL', 'trade-offs'],
                suggestedImprovement: 'Directly answer the engineering question using concrete technical details.',
              }),
            };
          }

          return {
            text: JSON.stringify({
              technicalCorrectness: 8.6,
              relevance: 8.8,
              clarity: 8.2,
              completeness: 8.0,
              communication: 8.5,
              isOffTopic: false,
              offTopicReason: '',
              feedback: 'Well-structured, grounded response demonstrating practical production understanding.',
              strengths: ['Explained concrete latency optimization trade-offs', 'Strong structural clarity'],
              weaknesses: ['Could mention connection pool saturation edge cases'],
              missingConcepts: ['connection pooling'],
              suggestedImprovement: 'Add quantitative SLA bounds and fallback behavior under cache eviction.',
            }),
          };
        }

        // 6. Report Narrative Summary
        if (prompt.includes('Summarize this completed mock interview')) {
          return {
            text: JSON.stringify({
              detailedSummary:
                'Strong Senior Backend performance demonstrating database tuning depth while highlighting Redis and Kubernetes areas for targeted preparation.',
            }),
          };
        }

        return { text: '{}' };
      },
      embedContent: async () => ({
        embeddings: [{ values: new Array(64).fill(0.125) }],
      }),
    },
  } as unknown as GoogleGenAI;

  return { mockAi, capturedPrompts };
}

describe('JD-Driven & Resume-Aware AI Mock Interview Workflow', () => {
  let tempDir: string;
  let server: http.Server;
  let baseUrl: string;
  let capturedPrompts: string[];
  let kbStoreRef: any;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-mock-interview-test-'));
    const { mockAi, capturedPrompts: prompts } = createMockAiClient();
    capturedPrompts = prompts;

    const { app, kbStore } = createApp({
      dataDir: tempDir,
      aiClient: mockAi,
      hasApiKey: true,
    });
    kbStoreRef = kbStore;

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('supports registration, login, JD PDF/text upload, resume upload, RAG isolation, question generation, text evaluation, duplicate guards, and final report', async () => {
    // 1. Register User A & User B
    const regA = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Alice Candidate',
        email: 'alice@example.com',
        password: 'password123',
      }),
    });
    expect(regA.status).toBe(201);
    const userAData = await regA.json();
    const tokenA = userAData.token;
    expect(userAData.user.email).toBe('alice@example.com');

    const regB = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Bob Other',
        email: 'bob@example.com',
        password: 'password123',
      }),
    });
    expect(regB.status).toBe(201);
    const userBData = await regB.json();
    const tokenB = userBData.token;

    // 2. Reject invalid file types and malformed PDFs
    const badForm = new FormData();
    badForm.append('file', new Blob(['plain text not pdf'], { type: 'text/plain' }), 'notes.txt');
    const badRes = await fetch(`${baseUrl}/api/documents/jd/upload-pdf`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: badForm,
    });
    expect(badRes.status).toBe(400);

    const fakePdfForm = new FormData();
    fakePdfForm.append(
      'file',
      new Blob(['NOT-A-PDF-MAGIC-HEADER'], { type: 'application/pdf' }),
      'fake.pdf'
    );
    const fakePdfRes = await fetch(`${baseUrl}/api/documents/resume/upload-pdf`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: fakePdfForm,
    });
    expect(fakePdfRes.status).toBe(400);

    // 3. Upload Valid JD PDF & Resume PDF for User A
    const jdPdfBytes = buildValidPdfBuffer([
      'Senior Backend Engineer - Acme Cloud',
      'Required Skills: TypeScript, Node.js, PostgreSQL, Redis, Kubernetes',
      'Responsibilities: Design low-latency REST APIs and optimize Postgres indexes.',
      'Experience: 3+ years building scalable distributed systems.',
    ]);
    const jdForm = new FormData();
    jdForm.append('file', new Blob([new Uint8Array(jdPdfBytes)], { type: 'application/pdf' }), 'senior_backend_jd.pdf');
    jdForm.append('enableWebResearch', 'true');

    const jdUploadRes = await fetch(`${baseUrl}/api/documents/jd/upload-pdf`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: jdForm,
    });
    expect(jdUploadRes.status).toBe(201);
    const jdBody = await jdUploadRes.json();
    const jdDocId = jdBody.document.id;
    expect(jdBody.document.analysis.jobTitle).toBe('Senior Backend Engineer');
    expect(jdBody.document.webSources.length).toBeGreaterThan(0);
    expect(jdBody.document.chunkCount).toBeGreaterThan(0);

    // Also verify Pasted JD Text validation and submission
    const shortJdRes = await fetch(`${baseUrl}/api/documents/jd/text`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenA}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: 'Too short' }),
    });
    expect(shortJdRes.status).toBe(400);

    const resumePdfBytes = buildValidPdfBuffer([
      'Alice Candidate - Software Engineer at FinLedger Systems (2022-Present)',
      'Skills: TypeScript, Node.js, PostgreSQL, Docker, React',
      'Built billing microservices processing 50k events per day.',
      'Reduced PostgreSQL p95 latency by 40 percent via composite indexes.',
      'Education: B.Tech in Computer Science',
    ]);
    const resumeForm = new FormData();
    resumeForm.append('file', new Blob([new Uint8Array(resumePdfBytes)], { type: 'application/pdf' }), 'alice_resume.pdf');

    const resUploadRes = await fetch(`${baseUrl}/api/documents/resume/upload-pdf`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: resumeForm,
    });
    expect(resUploadRes.status).toBe(201);
    const resBody = await resUploadRes.json();
    const resumeDocId = resBody.document.id;
    expect(resBody.document.analysis.candidateSkills).toContain('TypeScript');

    // 4. User Ownership & RAG Isolation Checks
    const crossDocRes = await fetch(`${baseUrl}/api/documents/${jdDocId}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    expect(crossDocRes.status).toBe(403);

    const crossGenRes = await fetch(`${baseUrl}/api/interview/generate-questions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenB}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jdId: jdDocId,
        resumeId: resumeDocId,
        questionCount: 5,
        interviewType: 'mixed',
        difficulty: 'medium',
      }),
    });
    expect(crossGenRes.status).toBe(403);

    // Verify RAG store rejects returning User A doc chunks to User B
    const ragForUserB = await kbStoreRef.retrieveTopK({
      query: 'FinLedger billing microservices PostgreSQL',
      topK: 5,
      userId: userBData.user.id,
      allowedDocIds: [resumeDocId],
      scopeFilter: 'user_doc',
    });
    expect(ragForUserB.length).toBe(0);

    const ragForUserA = await kbStoreRef.retrieveTopK({
      query: 'FinLedger billing microservices PostgreSQL',
      topK: 5,
      userId: userAData.user.id,
      allowedDocIds: [resumeDocId],
      scopeFilter: 'user_doc',
    });
    expect(ragForUserA.length).toBeGreaterThan(0);

    // 5. Invalid Question Count / Type / Difficulty Config Rejected
    const badCountRes = await fetch(`${baseUrl}/api/interview/generate-questions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenA}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jdId: jdDocId,
        resumeId: resumeDocId,
        questionCount: 7,
        interviewType: 'mixed',
        difficulty: 'medium',
      }),
    });
    expect(badCountRes.status).toBe(400);

    const overMaxRes = await fetch(`${baseUrl}/api/interview/generate-questions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenA}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jdId: jdDocId,
        resumeId: resumeDocId,
        questionCount: 25,
        interviewType: 'mixed',
        difficulty: 'medium',
      }),
    });
    expect(overMaxRes.status).toBe(400);

    // 6. Generate 5-Question Mixed Interview
    const genRes = await fetch(`${baseUrl}/api/interview/generate-questions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenA}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jdId: jdDocId,
        resumeId: resumeDocId,
        questionCount: 5,
        interviewType: 'mixed',
        difficulty: 'medium',
      }),
    });
    expect(genRes.status).toBe(200);
    const genBody = await genRes.json();
    expect(genBody.questions).toHaveLength(5);
    expect(genBody.jdMissingSkills).toContain('Redis');
    expect(genBody.jdMissingSkills).toContain('Kubernetes');

    // Confirm prompt included both JD and Resume extracted context
    const lastGenPrompt = capturedPrompts.find((p) =>
      p.includes('personalized, grounded mock interview with EXACTLY 5')
    );
    expect(lastGenPrompt).toContain('Senior Backend Engineer');
    expect(lastGenPrompt).toContain('FinLedger Systems');

    const interviewId = genBody.interviewId;

    // 7. Off-topic answer check + Re-answer + Valid Answer Evaluation + Duplicate Guard (409)
    const offTopicRes = await fetch(`${baseUrl}/api/interview/evaluate-answer`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenA}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        interviewId,
        questionId: 1,
        candidateAnswer: 'Yesterday I ate pizza after playing cricket with friends.',
      }),
    });
    expect(offTopicRes.status).toBe(200);
    const offTopicData = await offTopicRes.json();
    expect(offTopicData.evaluation.isOffTopic).toBe(true);

    // Re-submit valid answers for all 5 questions
    for (const q of genBody.questions) {
      const evalRes = await fetch(`${baseUrl}/api/interview/evaluate-answer`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenA}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          interviewId,
          questionId: q.id,
          candidateAnswer:
            'We used composite indexes matching the WHERE and ORDER BY columns, monitored EXPLAIN ANALYZE plans, and considered Redis invalidation and Kubernetes pod scaling trade-offs.',
        }),
      });
      expect(evalRes.status).toBe(200);
      const evalData = await evalRes.json();
      expect(evalData.evaluation.isOffTopic).toBe(false);
      expect(evalData.evaluation.overallScoreOutOf10).toBeGreaterThan(5);
    }

    // Duplicate submission after valid evaluation returns 409
    const dupRes = await fetch(`${baseUrl}/api/interview/evaluate-answer`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenA}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        interviewId,
        questionId: 1,
        candidateAnswer: 'Duplicate attempt',
      }),
    });
    expect(dupRes.status).toBe(409);

    // 8. Finalize Report & Verify Real Computed Metrics + History Persistence
    const finRes = await fetch(`${baseUrl}/api/interview/finalize`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenA}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ interviewId }),
    });
    expect(finRes.status).toBe(200);
    const finData = await finRes.json();
    expect(finData.report.totalQuestions).toBe(5);
    expect(finData.report.questionsAnswered).toBe(5);
    expect(finData.report.technicalPerformance).toBeGreaterThan(7);
    expect(finData.report.behavioralPerformance).toBeGreaterThan(7);
    expect(finData.report.skillPerformance.length).toBeGreaterThan(0);
    expect(finData.report.jdMissingSkills).toContain('Kubernetes');

    const histRes = await fetch(`${baseUrl}/api/interview/history`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    expect(histRes.status).toBe(200);
    const histData = await histRes.json();
    expect(histData.interviews.length).toBe(1);
    expect(histData.interviews[0].id).toBe(interviewId);
  });

  it('gracefully degrades when web research fails without blocking JD analysis, and fails cleanly with 503/502 on missing key or invalid LLM output without saving incomplete sessions', async () => {
    // Sub-app 1: Missing API Key -> 503 and zero incomplete sessions saved
    const noKeyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-mock-nokey-'));
    const { mockAi: okAi } = createMockAiClient({ failWebResearch: true });
    const { app: noKeyApp } = createApp({
      dataDir: noKeyDir,
      aiClient: okAi,
      hasApiKey: false,
    });
    const noKeyServer = noKeyApp.listen(0);
    const noKeyUrl = `http://127.0.0.1:${(noKeyServer.address() as any).port}`;

    try {
      const loginRes = await fetch(`${noKeyUrl}/api/auth/demo`, { method: 'POST' });
      const { token } = await loginRes.json();

      const jdAttempt = await fetch(`${noKeyUrl}/api/documents/jd/text`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: 'Backend Engineer with TypeScript, PostgreSQL, Docker, and Kubernetes skills required.',
        }),
      });
      expect(jdAttempt.status).toBe(503);
    } finally {
      await new Promise<void>((resolve) => noKeyServer.close(() => resolve()));
      fs.rmSync(noKeyDir, { recursive: true, force: true });
    }

    // Sub-app 2: Web search fails -> JD succeeds cleanly ('unavailable'); Malformed Q JSON -> 502 with 0 sessions created
    const failDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-mock-fail-'));
    const { mockAi: partialFailAi } = createMockAiClient({
      failWebResearch: true,
      malformedQuestionJson: true,
    });
    const { app: partialApp } = createApp({
      dataDir: failDir,
      aiClient: partialFailAi,
      hasApiKey: true,
    });
    const partialServer = partialApp.listen(0);
    const partialUrl = `http://127.0.0.1:${(partialServer.address() as any).port}`;

    try {
      const loginRes = await fetch(`${partialUrl}/api/auth/demo`, { method: 'POST' });
      const { token } = await loginRes.json();

      const jdRes = await fetch(`${partialUrl}/api/documents/jd/text`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: 'Senior Backend Engineer at Acme Cloud requiring TypeScript, PostgreSQL, Redis, and Docker.',
          enableWebResearch: true,
        }),
      });
      expect(jdRes.status).toBe(201);
      const jdData = await jdRes.json();
      expect(jdData.document.webResearchStatus).toBe('unavailable');
      expect(jdData.document.webSources).toEqual([]);

      const resumePdfBytes = buildValidPdfBuffer([
        'Candidate Resume: 3 years software engineering with TypeScript, Node.js, Postgres, Docker.',
        'Education: B.S. Computer Science. Built distributed APIs.',
      ]);
      const resumeForm = new FormData();
      resumeForm.append('file', new Blob([new Uint8Array(resumePdfBytes)], { type: 'application/pdf' }), 'res.pdf');
      const resUpload = await fetch(`${partialUrl}/api/documents/resume/upload-pdf`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: resumeForm,
      });
      expect(resUpload.status).toBe(201);
      const resData = await resUpload.json();

      const brokenGen = await fetch(`${partialUrl}/api/interview/generate-questions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jdId: jdData.document.id,
          resumeId: resData.document.id,
          questionCount: 10,
          interviewType: 'technical',
          difficulty: 'hard',
        }),
      });
      expect(brokenGen.status).toBe(502);

      // Verify zero incomplete sessions persisted in history/store
      const histRes = await fetch(`${partialUrl}/api/interview/history`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const histData = await histRes.json();
      expect(histData.interviews).toHaveLength(0);
    } finally {
      await new Promise<void>((resolve) => partialServer.close(() => resolve()));
      fs.rmSync(failDir, { recursive: true, force: true });
    }
  });
});
