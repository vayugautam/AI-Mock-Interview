import { apiRequest, getStoredToken } from './client';

function token() {
  return getStoredToken();
}

export async function createInterview(payload) {
  return apiRequest('/api/v1/interviews', { method: 'POST', body: payload }, token());
}

export async function fetchMyResume() {
  return apiRequest('/api/v1/resumes/me', { method: 'GET' }, token());
}

export async function uploadResume(file) {
  const body = new FormData();
  body.append('file', file);
  return apiRequest('/api/v1/resumes/upload', { method: 'POST', body }, token());
}

export async function fetchCompanyResearch(payload, refresh = false) {
  const query = refresh ? '?refresh=true' : '';
  return apiRequest(`/api/v1/company-research${query}`, { method: 'POST', body: payload }, token());
}

export async function fetchInterviews() {
  return apiRequest('/api/v1/interviews', { method: 'GET' }, token());
}

export async function fetchInterview(sessionId) {
  return apiRequest(`/api/v1/interviews/${sessionId}`, { method: 'GET' }, token());
}

export async function createInterviewQuestions(sessionId, payload) {
  return apiRequest(`/api/v1/interviews/${sessionId}/questions`, { method: 'POST', body: payload }, token());
}

export async function fetchQuestions(sessionId) {
  return apiRequest(`/api/v1/interviews/${sessionId}/questions`, { method: 'GET' }, token());
}

export async function submitAnswer(sessionId, questionId, payload) {
  return apiRequest(`/api/v1/interviews/${sessionId}/questions/${questionId}/answer`, { method: 'POST', body: payload }, token());
}

export async function evaluateQuestion(sessionId, questionId) {
  return apiRequest(`/api/v1/interviews/${sessionId}/questions/${questionId}/evaluate`, { method: 'POST' }, token());
}

export async function completeInterview(sessionId) {
  return apiRequest(`/api/v1/interviews/${sessionId}/complete`, { method: 'POST' }, token());
}

export async function fetchResults(sessionId) {
  return apiRequest(`/api/v1/interviews/${sessionId}/results`, { method: 'GET' }, token());
}

export async function fetchDashboardSummary() {
  return apiRequest('/api/v1/dashboard/summary', { method: 'GET' }, token());
}

export async function fetchDashboardProgress() {
  return apiRequest('/api/v1/dashboard/progress', { method: 'GET' }, token());
}
