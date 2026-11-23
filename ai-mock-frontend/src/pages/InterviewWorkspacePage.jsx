import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  completeInterview,
  createInterviewQuestions,
  evaluateQuestion,
  fetchQuestions,
  fetchResults,
  submitAnswer,
} from '../api/interviews';

export default function InterviewWorkspacePage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [evaluatedQuestionIds, setEvaluatedQuestionIds] = useState(new Set());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function loadInterview() {
      try {
        const [questionData, resultData] = await Promise.all([
          fetchQuestions(sessionId),
          fetchResults(sessionId),
        ]);
        if (!active) return;
        const resultQuestions = resultData.questions || [];
        const answerValues = Object.fromEntries(
          resultQuestions
            .filter((question) => question.answer_id && question.answer_text !== null)
            .map((question) => [question.id, question.answer_text]),
        );
        setQuestions(questionData.questions || []);
        setAnswers(answerValues);
        setEvaluatedQuestionIds(new Set(
          resultQuestions.filter((question) => question.evaluation).map((question) => question.id),
        ));
        setSession(resultData);
      } catch (err) {
        if (active) setError(err.message || 'Unable to load the interview.');
      } finally {
        if (active) setLoading(false);
      }
    }
    loadInterview();
    return () => { active = false; };
  }, [sessionId]);

  const question = questions[currentIndex];
  const answeredCount = useMemo(
    () => questions.filter((item) => answers[item.id]?.trim()).length,
    [answers, questions],
  );

  async function handleGenerateQuestions() {
    setGenerating(true);
    setError('');
    try {
      const data = await createInterviewQuestions(sessionId, { number_of_questions: 5 });
      setQuestions(data.questions || []);
    } catch (err) {
      setError(err.message || 'Unable to generate questions.');
    } finally {
      setGenerating(false);
    }
  }

  async function saveAnswer(questionToSave) {
    const answerText = answers[questionToSave.id]?.trim();
    if (!answerText) {
      throw new Error('Answer text is required before saving.');
    }
    await submitAnswer(sessionId, questionToSave.id, { answer_text: answerText });
  }

  async function saveCurrentAnswer() {
    if (!question) return;
    setSubmitting(true);
    setError('');
    try {
      await saveAnswer(question);
      if (currentIndex < questions.length - 1) {
        setCurrentIndex((value) => value + 1);
      }
    } catch (err) {
      setError(err.message || 'Unable to save answer.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCompleteInterview() {
    setSubmitting(true);
    setError('');
    try {
      const answeredQuestions = questions.filter((item) => answers[item.id]?.trim());
      for (const item of answeredQuestions) {
        await saveAnswer(item);
      }
      const evaluatedIds = new Set(evaluatedQuestionIds);
      for (const item of answeredQuestions) {
        if (!evaluatedIds.has(item.id)) {
          await evaluateQuestion(sessionId, item.id);
          evaluatedIds.add(item.id);
        }
      }
      setEvaluatedQuestionIds(evaluatedIds);
      await completeInterview(sessionId);
      navigate(`/results/${sessionId}`);
    } catch (err) {
      setError(err.message || 'Unable to complete interview.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="shell empty-state">Loading interview questions…</div>;
  if (error && !questions.length) return <div className="shell error-box">{error}</div>;

  if (!questions.length) {
    return (
      <div className="page-stack narrow-page">
        <div className="panel empty-state">
          <p>No questions have been generated for this session yet.</p>
          {error && <p className="error-text">{error}</p>}
          <button type="button" className="primary-button" disabled={generating} onClick={handleGenerateQuestions}>
            {generating ? 'Generating questions…' : 'Generate questions'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-stack narrow-page">
      <header className="panel hero-panel">
        <div>
          <p className="eyebrow">Interview session</p>
          <h2>Question {currentIndex + 1} of {questions.length}</h2>
          <p>{answeredCount} of {questions.length} answers saved · {session?.status || 'in progress'}</p>
        </div>
        <button type="button" className="secondary-button" disabled={submitting} onClick={handleCompleteInterview}>
          {submitting ? 'Finishing…' : 'Finish interview'}
        </button>
      </header>

      <div className="panel stacked-form">
        <p className="eyebrow">Interviewer note · Question {question.sequence_number || currentIndex + 1}</p>
        <p className="question-title">{question.question_text}</p>
        <div className="question-meta">
          {question.topic && <span>{question.topic}</span>}
          {question.difficulty && <span>{question.difficulty}</span>}
          {question.source_type && <span>{question.source_type.replaceAll('-', ' ')}</span>}
        </div>
        {question.model_answer && (
          <details className="model-answer">
            <summary>Model answer guidance</summary>
            <p>{question.model_answer}</p>
          </details>
        )}
        <label htmlFor="answer">
          <span>Your answer</span>
          <textarea
            id="answer"
            rows={10}
            value={answers[question.id] ?? ''}
            disabled={session?.status === 'completed'}
            onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
            placeholder="Write your answer here..."
          />
        </label>

        {error && <p className="error-text">{error}</p>}

        <div className="button-row">
          {currentIndex > 0 && (
            <button type="button" className="secondary-button" onClick={() => setCurrentIndex((value) => value - 1)}>
              Previous
            </button>
          )}
          {session?.status !== 'completed' && (
            <button type="button" className="primary-button" disabled={submitting} onClick={saveCurrentAnswer}>
              {submitting ? 'Saving…' : 'Save and continue'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
