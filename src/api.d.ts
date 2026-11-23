import type { AxiosInstance } from 'axios';

export type InterviewType = 'technical' | 'behavioural';
export type DifficultyLevel = 'easy' | 'medium' | 'hard';
export type SessionStatus = 'in_progress' | 'completed';
export type InputMode = 'text' | 'voice';

export interface User {
  id: number;
  name: string;
  email: string;
  created_at: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
}

export interface RegisterPayload {
  name: string;
  email: string;
  password: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface SessionCreatePayload {
  role: string;
  experience_level: string;
  interview_type: InterviewType;
  difficulty: DifficultyLevel;
  total_questions: number;
}

export interface Session {
  id: number;
  user_id: number;
  role: string;
  experience_level: string;
  interview_type: InterviewType;
  difficulty: DifficultyLevel;
  total_questions: number;
  status: SessionStatus;
  overall_score: number | null;
  band: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface Question {
  id: number;
  session_id: number;
  order_no: number;
  text: string;
  topic: string;
  type: InterviewType;
  difficulty: DifficultyLevel;
  expected_concepts: string[];
}

export interface Evaluation {
  id: number;
  response_id: number;
  rubric_type: InterviewType;
  scores: Record<string, number>;
  concepts_covered: string[];
  llm_score: number;
  similarity_score: number;
  delivery_score: number | null;
  fused_score: number;
  fusion_method: string;
  method_scores: Record<string, number>;
  eval_version: string;
  created_at: string;
}

export interface AnswerResponse {
  id: number;
  question_id: number;
  input_mode: InputMode;
  raw_text: string;
  cleaned_text: string;
  audio_path: string | null;
  duration_sec: number | null;
  delivery_features: Record<string, unknown> | null;
  content_features: Record<string, unknown>;
  evaluation: Evaluation | null;
}

export interface SubmitAnswerPayload {
  input_mode: InputMode;
  text?: string;
  audio?: Blob;
  filename?: string;
  time_taken_sec?: number;
}

export interface QuestionResult {
  question_id: number;
  order_no: number;
  question: string;
  topic: string;
  input_mode: InputMode;
  scores: Record<string, number>;
  answer_score: number;
  concepts_covered: string[];
  concepts_missing: string[];
  method_scores: Record<string, number>;
}

export interface SessionResult {
  session_id: number;
  role: string;
  interview_type: InterviewType;
  difficulty: DifficultyLevel;
  status: SessionStatus;
  fusion_method: string;
  session_score: number;
  band: string;
  completed_at: string | null;
  questions: QuestionResult[];
}

export declare const API_BASE_URL: string;
export declare const apiClient: AxiosInstance;

export declare function getAuthToken(): string | null;
export declare function setAuthToken(token: string): void;
export declare function clearAuthToken(): void;
export declare function setUnauthorizedHandler(handler: (() => void) | null): void;
export declare function getApiErrorMessage(error: unknown, fallback?: string): string;
export declare function getApiErrorStatus(error: unknown): number | null;

export declare function registerUser(payload: RegisterPayload): Promise<User>;
export declare function loginUser(payload: LoginPayload): Promise<TokenResponse>;
export declare function getCurrentUser(): Promise<User>;
export declare function createSession(payload: SessionCreatePayload): Promise<Session>;
export declare function listSessions(): Promise<Session[]>;
export declare function getSession(sessionId: number | string): Promise<Session>;
export declare function generateNextQuestion(sessionId: number | string): Promise<Question>;
export declare function submitAnswer(
  sessionId: number | string,
  questionId: number | string,
  payload: SubmitAnswerPayload
): Promise<AnswerResponse>;
export declare function retryEvaluation(
  sessionId: number | string,
  questionId: number | string
): Promise<AnswerResponse>;
export declare function completeSession(sessionId: number | string): Promise<Session>;
export declare function getSessionResult(sessionId: number | string): Promise<SessionResult>;
