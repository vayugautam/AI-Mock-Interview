import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import InterviewWorkspacePage from './InterviewWorkspacePage';

vi.mock('../api/interviews', () => ({
  fetchQuestions: vi.fn(),
  createInterviewQuestions: vi.fn(),
  submitAnswer: vi.fn(),
  evaluateQuestion: vi.fn(),
  completeInterview: vi.fn(),
  fetchResults: vi.fn(),
}));

import {
  completeInterview,
  evaluateQuestion,
  fetchQuestions,
  fetchResults,
  submitAnswer,
} from '../api/interviews';

describe('InterviewWorkspacePage', () => {
  beforeEach(() => {
    fetchQuestions.mockResolvedValue({ questions: [{ id: 1, question_text: 'Explain your process', sequence_number: 1 }] });
    fetchResults.mockResolvedValue({
      id: 7,
      status: 'created',
      questions: [{ id: 1, question_text: 'Explain your process', sequence_number: 1, answer_id: null, answer_text: null, evaluation: null }],
    });
    submitAnswer.mockResolvedValue({ id: 1 });
    evaluateQuestion.mockResolvedValue({ id: 10 });
    completeInterview.mockResolvedValue({ id: 7, status: 'completed' });
  });

  it('submits an answer for the current question', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/interview/7']}>
        <Routes>
          <Route path="/interview/:sessionId" element={<InterviewWorkspacePage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText(/Explain your process/i)).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText(/Write your answer here/i), 'I start with requirements.');
    await user.click(screen.getByRole('button', { name: /save and continue/i }));

    await waitFor(() => {
      expect(submitAnswer).toHaveBeenCalledWith('7', 1, { answer_text: 'I start with requirements.' });
    });
  });

  it('evaluates saved answers before completing the interview', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/interview/7']}>
        <Routes>
          <Route path="/interview/:sessionId" element={<InterviewWorkspacePage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText(/Explain your process/i)).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText(/Write your answer here/i), 'I start with requirements.');
    await user.click(screen.getByRole('button', { name: /finish interview/i }));

    await waitFor(() => expect(completeInterview).toHaveBeenCalledWith('7'));
    expect(evaluateQuestion).toHaveBeenCalledWith('7', 1);
    expect(evaluateQuestion.mock.invocationCallOrder[0]).toBeLessThan(
      completeInterview.mock.invocationCallOrder[0],
    );
  });
});
