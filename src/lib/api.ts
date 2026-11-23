import {
  User,
  InterviewQuestion,
  AnswerEvaluation,
  InterviewSession,
  FinalReport,
  DifficultyLevel,
  InterviewType,
  KnowledgeChunk,
  ValidationSample,
  BenchmarkRunResult,
  StoredDocument,
  WebResearchSource,
} from '../types';

const TOKEN_KEY = 'talentpulse_auth_token';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function removeStoredToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function fetchWithAuth(url: string, options: RequestInit = {}) {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `HTTP error ${response.status}: ${response.statusText}`);
  }

  return data;
}

export const api = {
  // Auth
  async register(params: {
    name: string;
    email: string;
    password: string;
    targetField?: string;
    difficulty?: DifficultyLevel;
    interviewType?: InterviewType;
  }) {
    const data = await fetchWithAuth('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    if (data.token) setStoredToken(data.token);
    return data as { user: User; token: string };
  },

  async login(params: { email: string; password: string }) {
    const data = await fetchWithAuth('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    if (data.token) setStoredToken(data.token);
    return data as { user: User; token: string };
  },

  async demoLogin() {
    const data = await fetchWithAuth('/api/auth/demo', {
      method: 'POST',
    });
    if (data.token) setStoredToken(data.token);
    return data as { user: User; token: string };
  },

  async getMe(): Promise<{ user: User }> {
    return fetchWithAuth('/api/auth/me');
  },

  async updateProfile(params: {
    targetField?: string;
    difficulty?: DifficultyLevel;
    interviewType?: InterviewType;
    skills?: string[];
    name?: string;
  }): Promise<{ user: User }> {
    return fetchWithAuth('/api/auth/update-profile', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  // JD & Resume Documents
  async uploadJdPdf(file: File, enableWebResearch = true): Promise<{ document: StoredDocument }> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('enableWebResearch', String(enableWebResearch));
    return fetchWithAuth('/api/documents/jd/upload-pdf', {
      method: 'POST',
      body: formData,
    });
  },

  async submitJdText(text: string, enableWebResearch = true): Promise<{ document: StoredDocument }> {
    return fetchWithAuth('/api/documents/jd/text', {
      method: 'POST',
      body: JSON.stringify({ text, enableWebResearch }),
    });
  },

  async uploadResumePdf(file: File): Promise<{ document: StoredDocument }> {
    const formData = new FormData();
    formData.append('file', file);
    return fetchWithAuth('/api/documents/resume/upload-pdf', {
      method: 'POST',
      body: formData,
    });
  },

  async getCurrentDocuments(): Promise<{ jd: StoredDocument | null; resume: StoredDocument | null }> {
    return fetchWithAuth('/api/documents/current');
  },

  async getDocument(id: string): Promise<{ document: StoredDocument }> {
    return fetchWithAuth(`/api/documents/${id}`);
  },

  // Knowledge Base (D1)
  async getKnowledgeChunks(params?: {
    subject?: string;
    interviewType?: string;
    q?: string;
  }): Promise<{ chunks: KnowledgeChunk[]; total: number }> {
    const query = new URLSearchParams();
    if (params?.subject) query.set('subject', params.subject);
    if (params?.interviewType) query.set('interviewType', params.interviewType);
    if (params?.q) query.set('q', params.q);
    return fetchWithAuth(`/api/kb/chunks?${query.toString()}`);
  },

  async addKnowledgeChunk(params: {
    subject: string;
    interviewType: 'technical' | 'behavioural';
    difficulty: DifficultyLevel;
    question: string;
    referenceAnswer: string;
    expectedConcepts: string[];
    rubricFocus?: string;
  }): Promise<{ chunk: KnowledgeChunk }> {
    return fetchWithAuth('/api/kb/chunks', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  async searchKnowledgeBase(params: {
    query: string;
    subject?: string;
    interviewType?: 'technical' | 'behavioural';
    topK?: number;
  }): Promise<{ results: KnowledgeChunk[] }> {
    return fetchWithAuth('/api/kb/search', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  async reindexKnowledgeBase(): Promise<{ total: number; geminiEmbedded: number }> {
    return fetchWithAuth('/api/kb/reindex', { method: 'POST' });
  },

  // JD + Resume Personalized Question Generation
  async generateQuestions(params: {
    jdId: string;
    resumeId: string;
    questionCount: 5 | 10 | 15 | 20;
    interviewType: 'technical' | 'behavioral' | 'mixed';
    difficulty: 'easy' | 'medium' | 'hard';
  }): Promise<{
    interviewId: string;
    techField: string;
    jdTitle: string;
    companyName: string;
    resumeFileName?: string;
    jdMissingSkills: string[];
    webSources: WebResearchSource[];
    interviewType: InterviewType;
    difficulty: DifficultyLevel;
    ragEnabled: boolean;
    questionCount: number;
    questionGenerationSource?: 'gemini' | 'groq' | 'curated_fallback';
    questionPromptVersion?: string;
    questionSchemaValid?: boolean;
    generationLatencyMs?: number;
    questions: InterviewQuestion[];
  }> {
    return fetchWithAuth('/api/interview/generate-questions', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  async generateIdealAnswer(params: {
    questionText: string;
    topic?: string;
    techField?: string;
    difficulty?: string;
    referenceAnswer?: string;
  }): Promise<{ idealAnswer: any }> {
    return fetchWithAuth('/api/interview/generate-ideal-answer', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  async evaluateAnswer(params: {
    interviewId: string;
    questionId: number;
    candidateAnswer: string;
    allowResubmit?: boolean;
    inputModality?: 'text' | 'voice';
    rawTranscript?: string;
    audioWavBase64?: string;
    audioDurationSeconds?: number;
    deliveryTelemetry?: {
      speakingRateWpm?: number;
      pauseFrequencyPerMin?: number;
      trimmedDurationSeconds?: number;
      normalizedGainDb?: number;
      sampleRateHz?: number;
    };
  }): Promise<{ evaluation: AnswerEvaluation; answerEntry: any }> {
    return fetchWithAuth('/api/interview/evaluate-answer', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  async synthesizeQuestionSpeech(params: {
    questionText: string;
    persona: string;
  }): Promise<{ audioSegments: string[] }> {
    return fetchWithAuth('/api/speech/synthesize-question', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  // Reports & Analytics
  async finalizeInterview(params: {
    interviewId: string;
  }): Promise<{ report: FinalReport; interview: InterviewSession }> {
    return fetchWithAuth('/api/interview/finalize', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  async getHistory(): Promise<{ interviews: InterviewSession[] }> {
    return fetchWithAuth('/api/interview/history');
  },

  async getInterview(id: string): Promise<{ interview: InterviewSession }> {
    return fetchWithAuth(`/api/interview/${id}`);
  },

  // Validation Benchmark
  async getValidationSamples(): Promise<{ samples: ValidationSample[] }> {
    return fetchWithAuth('/api/validation/samples');
  },

  async runValidationBenchmark(): Promise<BenchmarkRunResult> {
    return fetchWithAuth('/api/validation/run-benchmark', {
      method: 'POST',
    });
  },
};
