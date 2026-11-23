import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import InterviewCreatePage from './InterviewCreatePage';

vi.mock('../api/interviews', () => ({
  createInterview: vi.fn(),
  fetchCompanyResearch: vi.fn(),
  fetchMyResume: vi.fn(),
}));

import { createInterview, fetchCompanyResearch, fetchMyResume } from '../api/interviews';

describe('InterviewCreatePage', () => {
  beforeEach(() => {
    createInterview.mockResolvedValue({ id: 99 });
    fetchMyResume.mockRejectedValue(new Error('Resume not found'));
    fetchCompanyResearch.mockResolvedValue({
      cache_status: 'cached',
      researched_at: '2026-10-29T00:00:00Z',
      sources: [{ title: 'Careers', url: 'https://example.com/careers', retrieved_at: '2026-10-29T00:00:00Z' }],
    });
  });

  it('requests the correct payload when creating an interview', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <InterviewCreatePage />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: /create interview/i }));

    expect(createInterview).toHaveBeenCalledWith({
      role: 'Backend Engineer',
      difficulty: 'intermediate',
      interview_type: 'technical',
    });

  });

  it('shows company research status and sources', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <InterviewCreatePage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText(/company/i), 'Example Co');
    await waitFor(() => expect(fetchCompanyResearch).toHaveBeenCalled());
    expect(await screen.findByText(/loaded from cache/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Careers' })).toHaveAttribute('href', 'https://example.com/careers');
  });

  it('offers SDE and AI Engineer target roles', () => {
    render(
      <MemoryRouter>
        <InterviewCreatePage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('option', { name: /software development engineer \(sde\)/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'AI Engineer' })).toBeInTheDocument();
  });
});
