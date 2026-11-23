import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getApiErrorMessage, getSessionResult, type SessionResult } from '../api';
import { AppShell } from '../components/AppShell';
import { CriterionScoresList, getBandTextColor } from '../components/CriterionScoresList';

export function ResultPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [result, setResult] = useState<SessionResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setError('Missing interview session ID.');
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    getSessionResult(sessionId)
      .then((data) => {
        if (!cancelled) {
          setResult(data);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(getApiErrorMessage(err, 'Failed to load interview result.'));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (loading) {
    return (
      <AppShell>
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6 h-32 animate-pulse" />
          <div className="bg-white border border-slate-200 rounded-xl p-6 h-48 animate-pulse" />
          <div className="bg-white border border-slate-200 rounded-xl p-6 h-48 animate-pulse" />
        </div>
      </AppShell>
    );
  }

  if (error || !result) {
    return (
      <AppShell>
        <div className="max-w-2xl mx-auto bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h1 className="text-lg font-semibold text-slate-900">Result unavailable</h1>
          <p className="text-sm text-rose-700">{error || 'Could not find this session result.'}</p>
          <Link
            to="/dashboard"
            className="inline-block px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800"
          >
            Back to dashboard
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Session summary header */}
        <section className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                Interview Result
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                <span>{result.role}</span>
                <span aria-hidden="true">·</span>
                <span className="capitalize">{result.interview_type}</span>
                <span aria-hidden="true">·</span>
                <span className="capitalize">{result.difficulty}</span>
                {result.completed_at && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>
                      {new Date(result.completed_at).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-baseline gap-6 sm:text-right">
              <div>
                <span className="block text-xs text-slate-500">Session score</span>
                <span className="text-3xl font-mono font-bold text-slate-900 tabular-nums">
                  {result.session_score.toFixed(1)}
                  <span className="text-base font-normal text-slate-500"> / 10</span>
                </span>
              </div>
              <div>
                <span className="block text-xs text-slate-500">Band</span>
                <span className={`text-lg font-semibold ${getBandTextColor(result.band)}`}>
                  {result.band}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-500 tabular-nums">
              {result.questions.length} evaluated {result.questions.length === 1 ? 'question' : 'questions'}
            </span>
            <Link
              to="/dashboard"
              className="text-sm font-medium text-blue-700 hover:underline whitespace-nowrap shrink-0"
            >
              Back to dashboard
            </Link>
          </div>
        </section>

        {/* Per-question cards */}
        <div className="space-y-4">
          {result.questions.map((item) => (
            <article
              key={item.question_id}
              className="bg-white border border-slate-200 rounded-xl p-6 space-y-5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-4">
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <span className="font-semibold text-slate-900 tabular-nums">
                    Question {item.order_no}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="uppercase">{item.topic}</span>
                  <span aria-hidden="true">·</span>
                  <span className="capitalize">{item.input_mode}</span>
                </div>
                <span className="font-mono text-base font-bold text-slate-900 tabular-nums">
                  {item.answer_score.toFixed(1)} / 10
                </span>
              </div>

              <p className="text-base font-medium leading-relaxed text-slate-900">
                {item.question}
              </p>

              <CriterionScoresList scores={item.scores} />

              <div className="pt-4 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="block text-xs font-semibold text-emerald-800 mb-1">
                    Concepts covered
                  </span>
                  <p className="text-slate-700">
                    {item.concepts_covered.length > 0 ? item.concepts_covered.join(', ') : 'None'}
                  </p>
                </div>
                <div>
                  <span className="block text-xs font-semibold text-rose-800 mb-1">
                    Concepts missing
                  </span>
                  <p className="text-slate-700">
                    {item.concepts_missing.length > 0 ? item.concepts_missing.join(', ') : 'None'}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
