import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { fetchResults } from '../api/interviews';
import { formatDate, formatScore } from '../lib/utils';

export default function ResultsPage({ location: locationOverride }) {
  const routerLocation = useLocation();
  const location = locationOverride || routerLocation;
  const { sessionId } = useParams();
  const [results, setResults] = useState(location.state?.results || null);
  const [loading, setLoading] = useState(!location.state?.results && Boolean(sessionId));
  const [error, setError] = useState('');

  useEffect(() => {
    if (results || !sessionId) return undefined;
    let active = true;
    fetchResults(sessionId)
      .then((data) => {
        if (active) setResults(data);
      })
      .catch((err) => {
        if (active) setError(err.message || 'Unable to load interview results.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [results, sessionId]);

  if (loading) {
    return <div className="shell empty-state">Loading interview results…</div>;
  }

  if (error) {
    return <div className="shell error-box">{error}</div>;
  }

  if (!results) {
    return (
      <div className="page-stack narrow-page">
        <div className="panel empty-state">
          No result data available yet. Please complete an interview to view the analysis.
        </div>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <header className="panel hero-panel">
        <div>
          <p className="eyebrow">Interview results</p>
          <h2>{results.role} • {results.difficulty}</h2>
          <p>Status: {results.status}</p>
        </div>
        <Link to="/dashboard" className="primary-button">Back to dashboard</Link>
      </header>

      <section className="panel results-stack">
        {results.questions?.length ? results.questions.map((question) => (
          <article key={question.id} className="result-card">
            <div className="result-header">
              <h3>Question {question.sequence_number}</h3>
              {question.evaluation ? (
                <span className="status-badge success">Evaluated</span>
              ) : (
                <span className="status-badge muted">Unanswered or unevaluated</span>
              )}
            </div>

            <p className="question-text">{question.question_text}</p>
            {(question.source_type || question.topic || question.model_answer) && (
              <div className="question-meta">
                {question.topic && <span>{question.topic}</span>}
                {question.source_type && <span>{question.source_type.replaceAll('-', ' ')}</span>}
                {question.model_answer && (
                  <details className="model-answer">
                    <summary>Model answer guidance</summary>
                    <p>{question.model_answer}</p>
                  </details>
                )}
                {question.source_references?.filter((reference) => /^https?:\/\//i.test(reference)).map((reference) => (
                  <a key={reference} href={reference} target="_blank" rel="noreferrer">Supporting source</a>
                ))}
              </div>
            )}

            <div className="result-grid">
              <div>
                <p className="eyebrow">Submitted answer</p>
                <p>{question.answer_text || 'No answer recorded for this question.'}</p>
              </div>

              {question.evaluation ? (
                <div>
                  <p className="eyebrow">
                    {question.evaluation.provider === 'groq'
                      ? 'Groq text evaluation'
                      : 'Deterministic mock evaluation'}
                  </p>
                  <ul className="score-list">
                    <li>Correctness: {formatScore(question.evaluation.correctness_score)} / 10</li>
                    <li>Relevance: {formatScore(question.evaluation.relevance_score)} / 10</li>
                    <li>Clarity: {formatScore(question.evaluation.clarity_score)} / 10</li>
                    <li>Completeness: {formatScore(question.evaluation.completeness_score)} / 10</li>
                    <li>Overall: {formatScore(question.evaluation.overall_score)} / 10</li>
                  </ul>
                  {question.evaluation.is_off_topic && (
                    <p className="error-text">This answer appears to be off-topic.</p>
                  )}
                  {question.evaluation.reasoning && <p>{question.evaluation.reasoning}</p>}
                  {question.evaluation.strengths?.length > 0 && (
                    <p><strong>Strengths:</strong> {question.evaluation.strengths.join(' ')}</p>
                  )}
                  {question.evaluation.weaknesses?.length > 0 && (
                    <p><strong>Weaknesses:</strong> {question.evaluation.weaknesses.join(' ')}</p>
                  )}
                  {question.evaluation.missing_concepts?.length > 0 && (
                    <p><strong>Missing concepts:</strong> {question.evaluation.missing_concepts.join(', ')}</p>
                  )}
                  {question.evaluation.improvement_suggestions?.length > 0 && (
                    <p><strong>Suggestions:</strong> {question.evaluation.improvement_suggestions.join(' ')}</p>
                  )}
                  {question.evaluation.feedback && <p>{question.evaluation.feedback}</p>}
                  <small>
                    Provider: {question.evaluation.provider || 'legacy evaluation'}
                    {question.evaluation.model ? ` • Model: ${question.evaluation.model}` : ''}
                    {' • '}
                    {formatDate(question.evaluation.created_at)}
                  </small>
                </div>
              ) : (
                <div>
                  <p className="eyebrow">Evaluation status</p>
                  <p>No score or feedback is available for this answer yet.</p>
                </div>
              )}
            </div>
          </article>
        )) : (
          <div className="empty-state">This interview has no recorded questions yet.</div>
        )}
      </section>
    </div>
  );
}
