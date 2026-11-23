import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, getStoredToken, setStoredToken } from './client';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('api client', () => {
  it('adds bearer auth when a token is present', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ ok: true }),
    });

    await apiRequest('/api/v1/auth/me', { method: 'GET' }, 'abc123');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/v1/auth/me',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer abc123' }),
      }),
    );
  });

  it('throws a friendly error for failed requests', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      headers: { get: () => 'application/json' },
      json: async () => ({ detail: 'Invalid token' }),
    });

    await expect(apiRequest('/api/v1/auth/me')).rejects.toThrow('Invalid token');
  });

  it('clears stale credentials and broadcasts unauthorized responses', async () => {
    const handler = vi.fn();
    window.addEventListener('auth:unauthorized', handler);
    setStoredToken('expired-token');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 401,
      ok: false,
      headers: { get: () => 'application/json' },
      json: async () => ({ detail: 'Invalid or expired access token' }),
    });

    await expect(apiRequest('/api/v1/auth/me', { method: 'GET' }, 'expired-token')).rejects.toThrow(
      'Invalid or expired access token',
    );

    expect(getStoredToken()).toBeNull();
    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener('auth:unauthorized', handler);
  });

  it('stores and reads tokens from localStorage', () => {
    setStoredToken('token-123');
    expect(getStoredToken()).toBe('token-123');
  });

  it('returns null for an empty successful response', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 204,
      ok: true,
      headers: { get: () => null },
    });

    await expect(apiRequest('/api/v1/resumes/me', { method: 'GET' }, 'abc123')).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalled();
  });
});
