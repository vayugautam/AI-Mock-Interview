import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import ResultsPage from './ResultsPage';

describe('ResultsPage', () => {
  it('renders unevaluated answers clearly', () => {
    const location = {
      state: {
        results: {
          role: 'Backend Engineer',
          difficulty: 'intermediate',
          questions: [
            {
              id: 1,
              sequence_number: 1,
              question_text: 'Tell me about your debugging process.',
              answer_text: 'I investigate logs first.',
              evaluation: null,
            },
          ],
        },
      },
    };

    render(
      <MemoryRouter initialEntries={['/results']}>
        <ResultsPage location={location} />
      </MemoryRouter>,
    );

    expect(screen.getByText(/Unevaluated/i)).toBeInTheDocument();
    expect(screen.getByText(/No score or feedback is available/i)).toBeInTheDocument();
  });

  it('renders structured persisted evaluation details', () => {
    render(
      <MemoryRouter initialEntries={['/results']}>
        <ResultsPage
          location={{
            state: {
              results: {
                role: 'Backend Engineer',
                difficulty: 'intermediate',
                questions: [{
                  id: 2,
                  sequence_number: 1,
                  question_text: 'Explain an API.',
                  answer_text: 'An API is a service contract.',
                  evaluation: {
                    correctness_score: 8,
                    relevance_score: 7,
                    clarity_score: 9,
                    completeness_score: 6,
                    overall_score: 7.4,
                    provider: 'deterministic_mock',
                    reasoning: 'Evidence-based reasoning.',
                    strengths: ['Clear definition'],
                    weaknesses: ['Needs an example'],
                    missing_concepts: ['Error handling'],
                    improvement_suggestions: ['Add a concrete example'],
                    is_off_topic: false,
                    feedback: 'Good starting point.',
                  },
                  topic: 'web development',
                  source_type: 'company/role',
                  source_references: ['https://example.com/careers'],
                }],
              },
            },
          }}
        />,
      </MemoryRouter>,
    );

    expect(screen.getByText(/Deterministic mock evaluation/i)).toBeInTheDocument();
    expect(screen.getByText(/Overall: 7.40 \/ 10/i)).toBeInTheDocument();
    expect(screen.getByText('Missing concepts:')).toBeInTheDocument();
    expect(screen.getByText('Error handling')).toBeInTheDocument();
    expect(screen.getByText(/company\/role/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /supporting source/i })).toHaveAttribute('href', 'https://example.com/careers');
  });
});
