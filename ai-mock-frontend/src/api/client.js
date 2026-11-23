const DEFAULT_API_BASE_URL = 'http://localhost:8000';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL;

function buildHeaders(token, extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (!headers['Content-Type'] && !(extraHeaders.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  return headers;
}

async function parseResponse(response) {
  if (response.status === 204) {
    return null;
  }
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem('token');
      window.dispatchEvent(new CustomEvent('auth:unauthorized'));
    }
    const message = typeof payload === 'object' && payload && 'detail' in payload
      ? payload.detail
      : 'Request failed';
    throw new Error(message);
  }

  return payload;
}

export async function apiRequest(path, options = {}, token) {
  const url = `${API_BASE_URL}${path}`;
  const { body, headers, ...rest } = options;
  const requestOptions = {
    ...rest,
    headers: buildHeaders(token, headers || {}),
  };

  if (body instanceof FormData) {
    delete requestOptions.headers['Content-Type'];
  }

  if (body !== undefined) {
    requestOptions.body = typeof body === 'string' || body instanceof FormData ? body : JSON.stringify(body);
  }

  const response = await fetch(url, requestOptions);
  return parseResponse(response);
}

export function getStoredToken() {
  return localStorage.getItem('token');
}

export function setStoredToken(token) {
  if (!token) {
    localStorage.removeItem('token');
    return;
  }
  localStorage.setItem('token', token);
}
