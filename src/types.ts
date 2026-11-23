// Supports both new workflow types ('easy' | 'medium' | 'hard', 'behavioral' | 'mixed')
// and legacy historical session values ('junior' | 'intermediate' | 'senior' | 'lead', 'behavioural')
export type DifficultyLevel = 'easy' | 'medium' | 'hard' | 'junior' | 'intermediate' | 'senior' | 'lead';
export type InterviewType = 'technical' | 'behavioral' | 'mixed' | 'behavioural';
export type PerformanceBand = 'Needs Improvement' | 'Satisfactory' | 'Good' | 'Excellent';
export type InputModality = 'text' | 'voice';
export type ResumeAlignment = 'resume_verified' | 'skill_gap' | 'jd_core';

export interface User {
  id: string;
  name: string;
  email: string;
  targetField?: string;
  difficulty?: DifficultyLevel;
  interviewType?: InterviewType;
  skills?: string[];
  activeJdId?: string;
  activeResumeId?: string;
  createdAt: string;
}

export interface JobDescriptionAnalysis {
  jobTitle: string;
  companyName: string;
  requiredTechnicalSkills: string[];
  preferredSkills: string[];
  responsibilities: string[];
  requiredExperience: string;
  toolsAndTechnologies: string[];
  importantQualifications: string[];
}

export interface ResumeWorkExperience {
  role: string;
  company: string;
  duration: string;
  highlights: string[];
}

export interface ResumeProject {
  name: string;
  description: string;
  technologies: string[];
}

export interface ResumeAnalysis {
  candidateSkills: string[];
  workExperience: ResumeWorkExperience[];
  projects: ResumeProject[];
  education: string[];
  technologiesUsed: string[];
  achievements: string[];
}

export interface WebResearchSource {
  title: string;
  uri: string;
  publishedAt?: string;
}

export interface StoredDocument {
  id: string;
  userId: string;
  docType: 'jd' | 'resume';
  sourceType: 'pdf' | 'text';
  fileName?: string;
  fileSizeBytes?: number;
  pageCount?: number;
  charCount: number;
  normalizedText: string;
  previewText: string;
  analysis: JobDescriptionAnalysis | ResumeAnalysis;
  analysisPromptVersion?: string;
  webResearchSummary?: string;
  webSources?: WebResearchSource[];
  webResearchStatus?: 'completed' | 'skipped' | 'unavailable';
  chunkCount: number;
  createdAt: string;
}

export interface KnowledgeChunk {
  id: string;
  subject: string;
  interviewType: 'technical' | 'behavioural';
  difficulty: DifficultyLevel;
  question: string;
  referenceAnswer: string;
  expectedConcepts: string[];
  rubricFocus: string;
  hasEmbedding: boolean;
  embeddingDimensions?: number;
  createdBy: string;
  createdAt: string;
  similarityScore?: number;
  scope?: 'global' | 'user_doc';
}

export interface IdealAnswer {
  summary: string;
  keyPoints: string[];
  fullIdealAnswer: string;
  tradeOffsAndConsiderations: string;
  mustMentionKeywords: string[];
  groundedFromKbId?: string;
}

export interface InterviewQuestion {
  id: number;
  question: string;
  topic: string;
  subject: string;
  interviewType: 'technical' | 'behavioral' | 'behavioural';
  questionType?: 'technical' | 'behavioral';
  difficulty: string;
  skillBeingAssessed?: string;
  jdRelevance?: string;
  resumeAlignment?: ResumeAlignment;
  expectedKeywords: string[];
  referenceAnswer?: string;
  hint?: string;
  retrievedChunkIds?: string[];
  isAdaptiveFollowUp?: boolean;
  idealAnswer?: IdealAnswer;
}

export interface ContentFeatureVector {
  semanticSimilarityToQuestion: number;
  semanticSimilarityToReference: number;
  conceptCoverageRatio: number;
  normalizedAnswerLength: number;
  starStructureIndicator: number;
  matchedConcepts: string[];
}

export interface DeliveryFeatureVector {
  available: boolean;
  speakingRateWpm: number;
  normalizedSpeakingRate: number;
  pauseFrequencyPerMin: number;
  normalizedPauseControl: number;
  fillerWordCount: number;
  fillerDensity: number;
  normalizedFillerFluency: number;
  rawDurationSeconds: number;
  trimmedDurationSeconds: number;
  normalizedGainDb: number;
  sampleRateHz: number;
}

export interface RubricCriteriaScores {
  technicalCorrectness: number;
  relevance: number;
  clarity: number;
  completeness: number;
  communication: number;
}

export interface AnswerEvaluation {
  promptVersion?: string;
  earlyFusionWeights?: {
    technicalCorrectness: number;
    relevance: number;
    completeness: number;
    clarity: number;
    communication: number;
  };
  overallScoreOutOf10: number;
  earlyFusionScore: number;
  lateFusionScore: number;
  consistencyIndicator: number;
  performanceBand: PerformanceBand;
  isOffTopic: boolean;
  offTopicReason?: string;
  inputModality: InputModality;
  criteria: RubricCriteriaScores;
  contentFeatures: ContentFeatureVector;
  deliveryFeatures: DeliveryFeatureVector;
  rawTranscript: string;
  cleanedTranscript: string;
  feedback: string;
  strengths: string[];
  weaknesses: string[];
  missingConcepts: string[];
  suggestedImprovement: string;
  adaptiveFollowUpQuestion?: string;
  retrievedReferenceSnippet?: string;
  latencyMs: number;
}

export interface AnswerRecord {
  questionId: number;
  question: string;
  topic: string;
  skillBeingAssessed?: string;
  resumeAlignment?: ResumeAlignment;
  interviewType: 'technical' | 'behavioral' | 'behavioural';
  inputModality: InputModality;
  rawTranscript: string;
  cleanedTranscript: string;
  evaluation: AnswerEvaluation;
}

export interface SkillPerformanceSummary {
  skill: string;
  scoreOutOf10: number;
  band: PerformanceBand;
  questionCount: number;
  alignment?: ResumeAlignment;
}

export interface FinalReport {
  totalQuestions: number;
  questionsAnswered: number;
  overallScoreOutOf10: number;
  performanceBand: PerformanceBand;
  technicalPerformance: number | null;
  behavioralPerformance: number | null;
  earlyFusionAvg: number;
  lateFusionAvg: number;
  consistencyAvg: number;
  criteriaAverages: RubricCriteriaScores;
  skillPerformance: SkillPerformanceSummary[];
  categoryPerformance: Array<{
    topic: string;
    scoreOutOf10: number;
    band: PerformanceBand;
  }>;
  jdMissingSkills: string[];
  strengths: string[];
  areasForImprovement: string[];
  recommendedTopics: string[];
  detailedSummary: string;
}

export interface InterviewSession {
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
  interviewType: InterviewType;
  difficulty: DifficultyLevel;
  ragEnabled: boolean;
  questionCount: number;
  questionGenerationSource?: 'gemini' | 'groq' | 'curated_fallback';
  questionPromptVersion?: string;
  questionSchemaValid?: boolean;
  generationLatencyMs?: number;
  createdAt: string;
  completedAt?: string;
  questions: InterviewQuestion[];
  answers: AnswerRecord[];
  report?: FinalReport;
}

export interface ValidationSample {
  id: string;
  subject: string;
  interviewType: 'technical' | 'behavioural';
  question: string;
  referenceAnswer: string;
  expectedConcepts: string[];
  candidateAnswer: string;
  qualityTier: 'Strong' | 'Average' | 'Weak' | 'Off-Topic';
  humanScoreOutOf10: number;
  humanBand: PerformanceBand;
  deliverySample?: {
    speakingRateWpm: number;
    pauseFrequencyPerMin: number;
    fillerWordCount: number;
    durationSeconds: number;
  };
}

export interface StrategyBenchmarkRow {
  strategy: string;
  pearsonR: number;
  spearmanRho: number;
  mae: number;
  bandAccuracyPct: number;
  avgLatencyMs: number;
}

export interface SamplePredictionResult {
  sampleId: string;
  qualityTier: string;
  humanScore: number;
  humanBand: PerformanceBand;
  contentOnlyScore: number;
  deliveryOnlyScore: number;
  earlyFusionScore: number;
  lateFusionScore: number;
  predictedBand: PerformanceBand;
  isOffTopicFlagged: boolean;
}

export interface BenchmarkRunResult {
  executedAt: string;
  sampleCount: number;
  questionGeneratorValidityPct: number | null;
  questionGeneratorAvgLatencyMs: number | null;
  questionGeneratorSampleCount: number;
  tunedEarlyFusionWeights: {
    technicalCorrectness: number;
    relevance: number;
    completeness: number;
    clarity: number;
    communication: number;
  };
  strategies: StrategyBenchmarkRow[];
  samplePredictions: SamplePredictionResult[];
  recommendedStrategy: string;
}

export interface SubjectTrack {
  id: string;
  title: string;
  category: string;
  description: string;
  skills: string[];
}

export const TECH_FIELDS: SubjectTrack[] = [
  {
    id: 'Data Structures & Algorithms',
    title: 'Data Structures & Algorithms',
    category: 'Core CS Placement',
    description: 'Arrays, Trees, Graphs, Dynamic Programming, Complexity Analysis & Recursion',
    skills: ['Trees & Graphs', 'Dynamic Programming', 'Hashing', 'Sorting & Searching', 'Time Complexity'],
  },
  {
    id: 'Database Management Systems',
    title: 'Database Management Systems',
    category: 'Core CS Placement',
    description: 'Normalization, Indexing (B+ Trees), ACID Transactions, Locks, SQL Joins & Query Optimization',
    skills: ['ACID & Isolation', 'Indexing & B-Trees', 'Normalization', 'SQL Optimization', 'Concurrency'],
  },
  {
    id: 'Operating Systems',
    title: 'Operating Systems',
    category: 'Core CS Placement',
    description: 'Processes & Threads, CPU Scheduling, Deadlocks, Virtual Memory, Paging & Semaphores',
    skills: ['Processes & Threads', 'Deadlocks', 'Virtual Memory', 'Paging', 'Mutex & Semaphores'],
  },
  {
    id: 'Computer Networks',
    title: 'Computer Networks',
    category: 'Core CS Placement',
    description: 'OSI & TCP/IP Layers, HTTP/HTTPS, DNS, Congestion Control, Routing & Sockets',
    skills: ['TCP vs UDP', 'HTTP/HTTPS & TLS', 'DNS Resolution', 'Congestion Control', 'Subnetting'],
  },
  {
    id: 'Object-Oriented Programming',
    title: 'Object-Oriented Programming',
    category: 'Core CS Placement',
    description: 'Encapsulation, Polymorphism, Inheritance, Abstraction, SOLID Principles & Design Patterns',
    skills: ['SOLID Principles', 'Polymorphism', 'Design Patterns', 'Interfaces', 'Memory Lifecycle'],
  },
  {
    id: 'Web Development',
    title: 'Web Development',
    category: 'Application Track',
    description: 'React, REST APIs, State Management, Authentication, Browser Rendering & Caching',
    skills: ['React & DOM', 'RESTful APIs', 'JWT & Auth', 'State Management', 'Web Performance'],
  },
  {
    id: 'AI / ML Basics',
    title: 'AI / ML Basics',
    category: 'Emerging Tech',
    description: 'Transformers, Embeddings, RAG Pipelines, Supervised Learning, Overfitting & Evaluation Metrics',
    skills: ['Transformers', 'RAG & Embeddings', 'Bias-Variance', 'Gradient Descent', 'Evaluation Metrics'],
  },
  {
    id: 'HR & Behavioural',
    title: 'HR & Behavioural (STAR)',
    category: 'Placement Readiness',
    description: 'Situation-Task-Action-Result storytelling, Conflict Resolution, Teamwork & Ownership',
    skills: ['STAR Method', 'Conflict Resolution', 'Team Leadership', 'Adaptability', 'Problem Ownership'],
  },
  {
    id: 'Full Stack Development',
    title: 'Full Stack Development',
    category: 'End-to-End Track',
    description: 'React, Node.js, Databases, APIs, Caching, System Design & Deployment',
    skills: ['React', 'Node.js/Express', 'Databases', 'System Design', 'Security'],
  },
];

export const DIFFICULTY_LEVELS: {
  id: DifficultyLevel;
  label: string;
  badge: string;
  description: string;
  focus: string;
}[] = [
  {
    id: 'easy',
    label: 'Easy / Foundational',
    badge: 'Foundations',
    description: 'Core concepts, definitions, baseline tool usage, and clear STAR examples.',
    focus: 'Core Fundamentals',
  },
  {
    id: 'medium',
    label: 'Medium / Applied',
    badge: 'Standard',
    description: 'Practical implementation trade-offs, project deep dives, and JD skill gaps.',
    focus: 'Applied Architecture & Trade-offs',
  },
  {
    id: 'hard',
    label: 'Hard / Senior Depth',
    badge: 'High Rigor',
    description: 'Distributed trade-offs, bottleneck diagnostics, edge cases, and high-stakes leadership.',
    focus: 'System Rigor & Diagnostics',
  },
];
