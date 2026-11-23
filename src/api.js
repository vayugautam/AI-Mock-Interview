/**
 * Typed Axios API layer for the AI Mock Interview FastAPI backend.
 * Stores JWT in memory + localStorage, attaches Authorization automatically,
 * and triggers a 401 redirect callback on expired/invalid tokens.
 */

import axios from 'axios';

const TOKEN_STORAGE_KEY = 'mock_interview_jwt';

export const API_BASE_URL =
  (import.meta.env && import.meta.env.VITE_API_BASE_URL) || 'http://localhost:8000/api/v1';

/** @type {string | null} */
let inMemoryToken = readStoredToken();

/** @type {(() => void) | null} */
let unauthorizedHandler = null;

/**
 * Safely read JWT from localStorage.
 * @returns {string | null}
 */
function readStoredToken() {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Return current JWT from memory (falling back to localStorage).
 * @returns {string | null}
 */
export function getAuthToken() {
  if (!inMemoryToken) {
    inMemoryToken = readStoredToken();
  }
  return inMemoryToken;
}

/**
 * Persist JWT in both memory and localStorage.
 * @param {string} token
 */
export function setAuthToken(token) {
  inMemoryToken = token;
  try {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // Ignore storage quota / privacy mode errors; in-memory token remains active.
  }
}

/**
 * Clear JWT from memory and localStorage.
 */
export function clearAuthToken() {
  inMemoryToken = null;
  try {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
}

/**
 * Register a callback invoked when any authenticated request returns 401.
 * @param {(() => void) | null} handler
 */
export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = handler;
}

/**
 * Extract a clean user-facing error message from an Axios error or generic Error.
 * @param {unknown} error
 * @param {string} [fallback]
 * @returns {string}
 */
export function getApiErrorMessage(error, fallback = 'Something went wrong. Please try again.') {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === 'string' && detail.trim()) {
      return detail;
    }
    if (Array.isArray(detail) && detail.length > 0) {
      return detail
        .map((item) => (typeof item?.msg === 'string' ? item.msg : JSON.stringify(item)))
        .join('; ');
    }
    if (!error.response) {
      return `Cannot reach the backend API at ${API_BASE_URL}. Make sure FastAPI is running.`;
    }
    return error.message || fallback;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

/**
 * Return HTTP status code if error is an AxiosError with a response.
 * @param {unknown} error
 * @returns {number | null}
 */
export function getApiErrorStatus(error) {
  if (axios.isAxiosError(error) && error.response) {
    return error.response.status;
  }
  return null;
}

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 60000,
});

apiClient.interceptors.request.use((config) => {
  const token = getAuthToken();
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const url = String(error?.config?.url || '');
    const isAuthEndpoint = url.includes('/auth/login') || url.includes('/auth/register');

    if (status === 401 && !isAuthEndpoint) {
      clearAuthToken();
      if (unauthorizedHandler) {
        unauthorizedHandler();
      } else if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.assign('/login');
      }
    }
    return Promise.reject(error);
  }
);

// ---------------------------------------------------------------------------
// Endpoint functions (one function per FastAPI route)
// ---------------------------------------------------------------------------

/**
 * POST /auth/register
 * @param {{ name: string, email: string, password: string }} payload
 */
export async function registerUser(payload) {
  const { data } = await apiClient.post('/auth/register', payload);
  return data;
}

/**
 * POST /auth/login
 * @param {{ email: string, password: string }} payload
 */
export async function loginUser(payload) {
  const { data } = await apiClient.post('/auth/login', payload);
  if (data?.access_token) {
    setAuthToken(data.access_token);
  }
  return data;
}

/**
 * GET /auth/me
 */
export async function getCurrentUser() {
  const { data } = await apiClient.get('/auth/me');
  return data;
}

/**
 * POST /sessions
 * @param {{ role: string, experience_level: string, interview_type: 'technical' | 'behavioural', difficulty: 'easy' | 'medium' | 'hard', total_questions: number }} payload
 */
export async function createSession(payload) {
  const { data } = await apiClient.post('/sessions', payload);
  return data;
}

/**
 * GET /sessions
 */
export async function listSessions() {
  const { data } = await apiClient.get('/interviews');
  return data;
}

/**
 * GET /sessions/{sessionId}
 * @param {number | string} sessionId
 */
export async function getSession(sessionId) {
  const { data } = await apiClient.get(`/sessions/${sessionId}`);
  return data;
}

/**
 * POST /sessions/{sessionId}/next-question
 * @param {number | string} sessionId
 */
export async function generateNextQuestion(sessionId) {
  const { data } = await apiClient.post(`/sessions/${sessionId}/next-question`);
  return data;
}

/**
 * POST /sessions/{sessionId}/questions/{questionId}/answer
 * @param {number | string} sessionId
 * @param {number | string} questionId
 * @param {{ input_mode: 'text' | 'voice', text?: string, audio?: Blob, filename?: string, time_taken_sec?: number }} payload
 */
export async function submitAnswer(sessionId, questionId, payload) {
  const form = new FormData();
  form.append('input_mode', payload.input_mode);
  if (payload.input_mode === 'text' && payload.text !== undefined) {
    form.append('text', payload.text);
  }
  if (payload.input_mode === 'voice' && payload.audio) {
    form.append('audio', payload.audio, payload.filename || 'answer.webm');
  }
  if (payload.time_taken_sec !== undefined && payload.time_taken_sec !== null) {
    form.append('time_taken_sec', String(payload.time_taken_sec));
  }

  const { data } = await apiClient.post(
    `/sessions/${sessionId}/questions/${questionId}/answer`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  );
  return data;
}

/**
 * POST /sessions/{sessionId}/questions/{questionId}/retry-evaluation
 * @param {number | string} sessionId
 * @param {number | string} questionId
 */
export async function retryEvaluation(sessionId, questionId) {
  const { data } = await apiClient.post(
    `/sessions/${sessionId}/questions/${questionId}/retry-evaluation`
  );
  return data;
}

/**
 * POST /sessions/{sessionId}/complete
 * @param {number | string} sessionId
 */
export async function completeSession(sessionId) {
  const { data } = await apiClient.post(`/sessions/${sessionId}/complete`);
  return data;
}

/**
 * GET /sessions/{sessionId}/result
 * @param {number | string} sessionId
 */
export async function getSessionResult(sessionId) {
  const { data } = await apiClient.get(`/sessions/${sessionId}/result`);
  return data;
}
