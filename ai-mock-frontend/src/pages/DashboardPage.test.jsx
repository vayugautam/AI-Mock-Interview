import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardPage from './DashboardPage';
import { AuthProvider } from '../context/AuthContext';

const mockSummary = {
  total_interviews: 0,
  completed_interviews: 0,
  in_progress_interviews: 0,
  total_answered_questions: 0,
  average_overall_score: null,
  recent_interviews: [],
};

vi.mock('../api/interviews', () => ({
  fetchDashboardSummary: vi.fn(),
  fetchDashboardProgress: vi.fn(),
}));

import { fetchDashboardProgress, fetchDashboardSummary } from '../api/interviews';

beforeEach(() => {
  fetchDashboardSummary.mockResolvedValue(mockSummary);
  fetchDashboardProgress.mockResolvedValue({ progress: [] });
});

describe('DashboardPage', () => {
  it('shows the empty state when there are no interviews', async () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <DashboardPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/No interviews yet/i)).toBeInTheDocument();
    });
  });
});
