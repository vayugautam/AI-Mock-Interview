import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  createSession,
  getApiErrorMessage,
  listSessions,
  type DifficultyLevel,
  type InterviewType,
  type Session,
} from '../api';
import { AppShell } from '../components/AppShell';
import { getBandTextColor } from '../components/CriterionScoresList';

const ROLE_SUGGESTIONS = [
  'Backend Engineer',
  'Frontend Developer',
  'Full-Stack Engineer',
  'Data Analyst',
  'ML Engineer',
];

const EXPERIENCE_LEVELS = [
  'Fresher',
  'Intern',
  'Junior (1-2 years)',
  'Mid-Level (3-5 years)',
];

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function DashboardPage() {
  const navigate = useNavigate();

  // Form state
  const [role, setRole] = useState('Backend Engineer');
  const [experienceLevel, setExperienceLevel] = useState('Fresher');
  const [interviewType, setInterviewType] = useState<InterviewType>('technical');
  const [difficulty, setDifficulty] = useState<DifficultyLevel>('medium');
  const [totalQuestions, setTotalQuestions] = useState<number>(5);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Past sessions state
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  async function fetchSessions() {
    setLoadingSessions(true);
    setSessionsError(null);
    try {
      const data = await listSessions();
      setSessions(data);
    } catch (err) {
      setSessionsError(getApiErrorMessage(err, 'Failed to load past sessions.'));
    } finally {
      setLoadingSessions(false);
    }
  }

  useEffect(() => {
    fetchSessions();
  }, []);

  async function handleStartInterview(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const trimmedRole = role.trim();
    if (trimmedRole.length < 2) {
      setFormError('Please enter a target role (at least 2 characters).');
      return;
    }

    setCreating(true);
    try {
      const session = await createSession({
        role: trimmedRole,
        experience_level: experienceLevel,
        interview_type: interviewType,
        difficulty,
        total_questions: totalQuestions,
      });
      navigate(`/interview/${session.id}`);
    } catch (err) {
      setFormError(getApiErrorMessage(err, 'Could not start a new interview session.'));
      setCreating(false);
    }
  }

  return (
    <AppShell>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">
          Configure a new mock interview or review scores from past sessions.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Start new interview form */}
        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-5">Start new interview</h2>

          <form onSubmit={handleStartInterview} className="space-y-5">
            {formError && (
              <div
                role="alert"
                className="p-3.5 text-sm text-rose-800 bg-rose-50 border border-rose-200 rounded-lg"
              >
                {formError}
              </div>
            )}

            <div>
              <label htmlFor="role-input" className="block text-sm font-medium text-slate-700 mb-1.5">
                Target role
              </label>
              <input
                id="role-input"
                type="text"
                required
                minLength={2}
                maxLength={120}
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="e.g., Backend Engineer"
                className="w-full px-3.5 py-2.5 text-sm text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {ROLE_SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => setRole(suggestion)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      role.trim().toLowerCase() === suggestion.toLowerCase()
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label
                htmlFor="experience-select"
                className="block text-sm font-medium text-slate-700 mb-1.5"
              >
                Experience level
              </label>
              <select
                id="experience-select"
                value={experienceLevel}
                onChange={(e) => setExperienceLevel(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
              >
                {EXPERIENCE_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className="block text-sm font-medium text-slate-700 mb-1.5">Interview type</span>
              <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
                {(['technical', 'behavioural'] as const).map((typeOption) => (
                  <button
                    key={typeOption}
                    type="button"
                    onClick={() => setInterviewType(typeOption)}
                    className={`py-2 px-3 text-sm font-medium rounded-md capitalize transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      interviewType === typeOption
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {typeOption}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="block text-sm font-medium text-slate-700 mb-1.5">Difficulty</span>
              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg">
                {(['easy', 'medium', 'hard'] as const).map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setDifficulty(level)}
                    className={`py-2 px-3 text-sm font-medium rounded-md capitalize transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      difficulty === level
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="question-count" className="text-sm font-medium text-slate-700">
                  Number of questions
                </label>
                <span className="text-sm font-mono font-semibold text-slate-900 tabular-nums">
                  {totalQuestions}
                </span>
              </div>
              <input
                id="question-count"
                type="range"
                min={3}
                max={10}
                step={1}
                value={totalQuestions}
                onChange={(e) => setTotalQuestions(Number(e.target.value))}
                className="w-full accent-slate-900 cursor-pointer"
              />
              <div className="flex justify-between text-xs text-slate-500 font-mono tabular-nums mt-1">
                <span>3</span>
                <span>10</span>
              </div>
            </div>

            <button
              type="submit"
              disabled={creating}
              className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              {creating ? 'Starting session...' : 'Start interview'}
            </button>
          </form>
        </section>

        {/* Plain past sessions table */}
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-semibold text-slate-900">Past sessions</h2>
            <span className="text-sm text-slate-500 tabular-nums">
              {sessions.length} {sessions.length === 1 ? 'session' : 'sessions'}
            </span>
          </div>

          {sessionsError && (
            <div
              role="alert"
              className="p-4 text-sm text-rose-800 bg-rose-50 border border-rose-200 rounded-lg flex items-center justify-between gap-4"
            >
              <span>{sessionsError}</span>
              <button
                type="button"
                onClick={fetchSessions}
                className="px-3 py-1.5 text-xs font-semibold text-rose-900 bg-white border border-rose-300 rounded-md hover:bg-rose-100 whitespace-nowrap shrink-0 cursor-pointer"
              >
                Retry
              </button>
            </div>
          )}

          {loadingSessions ? (
            <div className="space-y-3 py-2" aria-label="Loading sessions">
              {[1, 2, 3, 4].map((row) => (
                <div key={row} className="h-10 bg-slate-100 rounded-md animate-pulse" />
              ))}
            </div>
          ) : !sessionsError && sessions.length === 0 ? (
            <div className="py-12 text-center border-t border-slate-100">
              <p className="text-sm font-medium text-slate-900">No interview sessions yet</p>
              <p className="mt-1 text-sm text-slate-500">
                Use the form on the left to start your first mock interview.
              </p>
            </div>
          ) : !sessionsError ? (
            <div className="overflow-x-auto -mx-6 px-6">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                    <th className="py-2.5 pr-4">Date</th>
                    <th className="py-2.5 pr-4">Role</th>
                    <th className="py-2.5 pr-4">Type</th>
                    <th className="py-2.5 pr-4 text-right">Score</th>
                    <th className="py-2.5 pr-4">Band</th>
                    <th className="py-2.5 text-right">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {sessions.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 pr-4 text-slate-600 whitespace-nowrap tabular-nums">
                        {formatDate(item.created_at)}
                      </td>
                      <td className="py-3 pr-4 font-medium text-slate-900">{item.role}</td>
                      <td className="py-3 pr-4 text-slate-600 capitalize whitespace-nowrap">
                        {item.interview_type}
                      </td>
                      <td className="py-3 pr-4 text-right font-mono font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                        {item.overall_score !== null ? `${item.overall_score.toFixed(1)}/10` : '—'}
                      </td>
                      <td
                        className={`py-3 pr-4 font-medium whitespace-nowrap ${getBandTextColor(
                          item.band
                        )}`}
                      >
                        {item.band || (item.status === 'in_progress' ? 'In progress' : '—')}
                      </td>
                      <td className="py-3 text-right whitespace-nowrap">
                        {item.status === 'completed' ? (
                          <Link
                            to={`/result/${item.id}`}
                            className="font-medium text-blue-700 hover:underline"
                          >
                            View result
                          </Link>
                        ) : (
                          <Link
                            to={`/interview/${item.id}`}
                            className="font-medium text-slate-700 hover:text-slate-900 hover:underline"
                          >
                            Continue
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </div>
    </AppShell>
  );
}
