import React, { useEffect, useState } from 'react';
import { InterviewSession, PerformanceBand, User } from '../types';
import { api } from '../lib/api';
import { exportAnalyticsSummaryPdf } from '../lib/analyticsPdfExport';
import {
  BarChart3,
  TrendingUp,
  Mic,
  ArrowRight,
  Clock,
  Sparkles,
  BookOpen,
  Sliders,
  FileDown,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

interface AnalyticsDashboardProps {
  user?: Pick<User, 'name' | 'email' | 'targetField'>;
  onSelectInterview: (id: string) => void;
  onConfigureNew: () => void;
}

export const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({
  user,
  onSelectInterview,
  onConfigureNew,
}) => {
  const [interviews, setInterviews] = useState<InterviewSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [subjectFilter, setSubjectFilter] = useState<string>('ALL');
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [exportSuccessMessage, setExportSuccessMessage] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await api.getHistory();
        setInterviews(res.interviews || []);
      } catch (err) {
        console.error('Failed to load analytics history:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const completedSessions = interviews.filter((s) => s.report);
  const filteredSessions =
    subjectFilter === 'ALL'
      ? completedSessions
      : completedSessions.filter((s) => s.techField === subjectFilter);

  const avgScore =
    completedSessions.length > 0
      ? completedSessions.reduce((acc, s) => acc + (s.report?.overallScoreOutOf10 || 0), 0) /
        completedSessions.length
      : 0;

  const latestBand: PerformanceBand | string =
    completedSessions[0]?.report?.performanceBand || 'No sessions yet';

  // Collect voice delivery telemetry across all voice answers
  const voiceAnswers = completedSessions.flatMap((s) =>
    s.answers.filter((a) => a.evaluation?.deliveryFeatures?.available)
  );
  const avgWpm =
    voiceAnswers.length > 0
      ? Math.round(
          voiceAnswers.reduce(
            (acc, a) => acc + (a.evaluation.deliveryFeatures.speakingRateWpm || 0),
            0
          ) / voiceAnswers.length
        )
      : null;

  // Subject-wise averages
  const subjectMap = new Map<string, { sum: number; count: number }>();
  completedSessions.forEach((s) => {
    const score = s.report?.overallScoreOutOf10 || 0;
    const prev = subjectMap.get(s.techField) || { sum: 0, count: 0 };
    subjectMap.set(s.techField, { sum: prev.sum + score, count: prev.count + 1 });
  });
  const subjectAverages = Array.from(subjectMap.entries()).map(([subject, stat]) => ({
    subject,
    avg: Number((stat.sum / stat.count).toFixed(2)),
    count: stat.count,
  }));

  // Chronological trend points for SVG chart (oldest -> newest)
  const trendSessions = [...completedSessions].reverse().slice(-12);

  const getBandTextColor = (band?: PerformanceBand) => {
    if (band === 'Excellent') return 'text-emerald-600 dark:text-emerald-400';
    if (band === 'Good') return 'text-indigo-600 dark:text-indigo-400';
    if (band === 'Satisfactory') return 'text-amber-600 dark:text-amber-400';
    return 'text-rose-600 dark:text-rose-400';
  };

  const handleExportPdf = () => {
    if (filteredSessions.length === 0 || isExportingPdf) return;
    setIsExportingPdf(true);
    setExportError(null);
    setExportSuccessMessage(null);

    try {
      const result = exportAnalyticsSummaryPdf({
        sessions: completedSessions,
        subjectFilter,
        candidateName: user?.name,
        candidateEmail: user?.email,
      });
      setExportSuccessMessage(
        `Exported ${result.sessionCount} session${result.sessionCount === 1 ? '' : 's'} (${result.pageCount} page${result.pageCount === 1 ? '' : 's'}) as ${result.filename}.`
      );
      setTimeout(() => {
        setExportSuccessMessage(null);
      }, 4500);
    } catch (err: any) {
      setExportError(err?.message || 'Failed to generate analytics PDF summary.');
    } finally {
      setIsExportingPdf(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto min-h-[380px] flex flex-col items-center justify-center text-slate-500 dark:text-slate-400 space-y-3">
        <Sparkles className="w-7 h-7 text-indigo-500 animate-spin" />
        <p className="text-xs font-medium">Loading placement session analytics...</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
            Analytics & Practice Session History
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Process 5.0 · Longitudinal /10 score trends, subject mastery, and speech fluency telemetry
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 self-start sm:self-auto shrink-0">
          <button
            type="button"
            onClick={handleExportPdf}
            disabled={filteredSessions.length === 0 || isExportingPdf}
            title={
              filteredSessions.length === 0
                ? 'Complete at least one session in the current filter to export a PDF'
                : subjectFilter === 'ALL'
                ? 'Export complete performance summary as PDF'
                : `Export ${subjectFilter} performance summary as PDF`
            }
            className="px-4 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 disabled:opacity-45 disabled:cursor-not-allowed text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer whitespace-nowrap"
          >
            <FileDown className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
            <span>
              {isExportingPdf
                ? 'Generating PDF...'
                : subjectFilter !== 'ALL'
                ? `Export ${subjectFilter} PDF`
                : 'Export PDF Summary'}
            </span>
          </button>

          <button
            type="button"
            onClick={onConfigureNew}
            className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>New Practice Session</span>
          </button>
        </div>
      </div>

      {exportSuccessMessage && (
        <div className="flex items-center space-x-2.5 px-4 py-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 text-xs text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{exportSuccessMessage}</span>
        </div>
      )}

      {exportError && (
        <div className="flex items-center space-x-2.5 px-4 py-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/60 text-xs text-rose-700 dark:text-rose-300">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{exportError}</span>
        </div>
      )}

      {/* KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Completed Sessions</span>
            <BarChart3 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
            {completedSessions.length}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Recorded in candidate profile
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Mean Score (/10)</span>
            <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
            {completedSessions.length > 0 ? avgScore.toFixed(2) : '—'}
            {completedSessions.length > 0 && (
              <span className="text-xs font-normal text-slate-400"> / 10</span>
            )}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Across all fusion-evaluated rounds
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Latest Performance Band</span>
            <BookOpen className="w-4 h-4 text-sky-600 dark:text-sky-400" />
          </div>
          <p
            className={`text-xl font-bold truncate ${
              completedSessions.length > 0
                ? getBandTextColor(completedSessions[0]?.report?.performanceBand)
                : 'text-slate-400'
            }`}
          >
            {latestBand}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {completedSessions[0]?.techField || 'Complete a round to calibrate'}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Avg Speech Fluency</span>
            <Mic className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
            {avgWpm !== null ? `${avgWpm} WPM` : 'Text Mode'}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {voiceAnswers.length > 0
              ? `Measured across ${voiceAnswers.length} voice answers`
              : 'Use voice capture to track WPM'}
          </p>
        </div>
      </div>

      {/* Empty State or Visualizations */}
      {completedSessions.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-12 text-center space-y-4">
          <BarChart3 className="w-10 h-10 text-indigo-600 dark:text-indigo-400 mx-auto" />
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              No Completed Practice Sessions Yet
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              Complete a Technical or Behavioural STAR interview round to unlock score trend charts, subject mastery bars, and detailed question breakdowns.
            </p>
          </div>
          <button
            type="button"
            onClick={onConfigureNew}
            className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer"
          >
            Configure & Launch Interview
          </button>
        </div>
      ) : (
        <>
          {/* Charts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* SVG Trend Line Chart */}
            <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Session Score Progression (0–10)
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Overall fusion score across recent practice sessions
                  </p>
                </div>
                <span className="text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                  {trendSessions.length} session{trendSessions.length === 1 ? '' : 's'}
                </span>
              </div>

              <div className="w-full overflow-x-auto">
                <svg viewBox="0 0 520 190" className="w-full h-44 text-slate-400">
                  {/* Horizontal Grid Lines (0, 2.5, 5, 7.5, 10) */}
                  {[0, 2.5, 5, 7.5, 10].map((val) => {
                    const y = 160 - (val / 10) * 140;
                    return (
                      <g key={val}>
                        <line
                          x1="36"
                          y1={y}
                          x2="500"
                          y2={y}
                          stroke="currentColor"
                          strokeOpacity="0.18"
                          strokeDasharray="3 3"
                        />
                        <text
                          x="28"
                          y={y + 3}
                          textAnchor="end"
                          fontSize="10"
                          fill="currentColor"
                        >
                          {val}
                        </text>
                      </g>
                    );
                  })}

                  {/* Polyline connecting scores */}
                  {trendSessions.length > 1 && (
                    <polyline
                      fill="none"
                      stroke="#4f46e5"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      points={trendSessions
                        .map((s, idx) => {
                          const x =
                            55 +
                            (idx / Math.max(1, trendSessions.length - 1)) * 425;
                          const score = s.report?.overallScoreOutOf10 || 0;
                          const y = 160 - (score / 10) * 140;
                          return `${x},${y}`;
                        })
                        .join(' ')}
                    />
                  )}

                  {/* Data Points */}
                  {trendSessions.map((s, idx) => {
                    const x =
                      trendSessions.length === 1
                        ? 270
                        : 55 + (idx / (trendSessions.length - 1)) * 425;
                    const score = s.report?.overallScoreOutOf10 || 0;
                    const y = 160 - (score / 10) * 140;
                    return (
                      <g key={s.id}>
                        <circle
                          cx={x}
                          cy={y}
                          r="5"
                          fill="#4f46e5"
                          stroke="#ffffff"
                          strokeWidth="2"
                        />
                        <text
                          x={x}
                          y={y - 10}
                          textAnchor="middle"
                          fontSize="10"
                          fontWeight="bold"
                          fill="#6366f1"
                        >
                          {score.toFixed(1)}
                        </text>
                        <text
                          x={x}
                          y="178"
                          textAnchor="middle"
                          fontSize="9"
                          fill="currentColor"
                        >
                          S{idx + 1}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>

            {/* Subject-wise Average Bars */}
            <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Subject Mastery Breakdown
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Average /10 score per placement subject
                </p>
              </div>

              <div className="space-y-3">
                {subjectAverages.map((item) => (
                  <div key={item.subject} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-800 dark:text-slate-200 truncate pr-2">
                        {item.subject}{' '}
                        <span className="text-slate-400 dark:text-slate-500">({item.count})</span>
                      </span>
                      <span className="font-mono font-bold tabular-nums text-indigo-600 dark:text-indigo-400">
                        {item.avg.toFixed(1)}/10
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className="h-2 rounded-full bg-indigo-600 dark:bg-indigo-500"
                        style={{ width: `${Math.min(100, item.avg * 10)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Filterable Session Table */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Recorded Session Reports
              </h3>

              <select
                value={subjectFilter}
                onChange={(e) => setSubjectFilter(e.target.value)}
                className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300 outline-none cursor-pointer"
              >
                <option value="ALL">All Subjects ({completedSessions.length})</option>
                {subjectAverages.map((s) => (
                  <option key={s.subject} value={s.subject}>
                    {s.subject} ({s.count})
                  </option>
                ))}
              </select>
            </div>

            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {filteredSessions.map((session) => {
                const report = session.report!;
                return (
                  <div
                    key={session.id}
                    onClick={() => onSelectInterview(session.id)}
                    className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-950/60 px-2 rounded-xl cursor-pointer transition-colors"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-bold text-slate-900 dark:text-white">
                          {session.techField}
                        </span>
                        <span className="text-slate-400">·</span>
                        <span className="capitalize text-slate-600 dark:text-slate-400">
                          {session.interviewType}
                        </span>
                        <span className="text-slate-400">·</span>
                        <span className="capitalize text-slate-600 dark:text-slate-400">
                          {session.difficulty}
                        </span>
                        <span className="text-slate-400">·</span>
                        <span className={`font-semibold ${getBandTextColor(report.performanceBand)}`}>
                          {report.performanceBand}
                        </span>
                      </div>
                      <div className="flex items-center space-x-3 text-[11px] text-slate-500 dark:text-slate-400">
                        <span className="flex items-center space-x-1">
                          <Clock className="w-3 h-3" />
                          <span>
                            {new Date(session.completedAt || session.createdAt).toLocaleString()}
                          </span>
                        </span>
                        <span>·</span>
                        <span>{session.answers.length} answers evaluated</span>
                        <span>·</span>
                        <span>{session.ragEnabled ? 'RAG D1' : 'Zero-Shot'}</span>
                      </div>
                    </div>

                    <div className="flex items-center space-x-4 shrink-0">
                      <div className="text-right font-mono tabular-nums">
                        <span className="text-lg font-bold text-indigo-600 dark:text-indigo-400">
                          {report.overallScoreOutOf10.toFixed(1)}
                        </span>
                        <span className="text-xs text-slate-400"> / 10</span>
                      </div>
                      <ArrowRight className="w-4 h-4 text-slate-400" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
