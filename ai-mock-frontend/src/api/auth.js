import { apiRequest, getStoredToken } from './client';

export async function registerUser(payload) {
  return apiRequest('/api/v1/auth/register', { method: 'POST', body: payload });
}

export async function loginUser(payload) {
  const data = await apiRequest('/api/v1/auth/login', { method: 'POST', body: payload });
  return data;
}

export async function fetchCurrentUser() {
  const token = getStoredToken();
  if (!token) {
    return null;
  }
  return apiRequest('/api/v1/auth/me', { method: 'GET' }, token);
}
