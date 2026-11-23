import React, { useEffect, useState } from 'react';
import {
  InterviewSession,
  FinalReport,
  IdealAnswer,
  PerformanceBand,
} from '../types';
import { api } from '../lib/api';
import confetti from 'canvas-confetti';
import {
  Award,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  Printer,
  RotateCcw,
  Sparkles,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  BookOpen,
  Briefcase,
  Cpu,
  Users,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';

interface InterviewReportProps {
  interviewId: string;
  onRetake: () => void;
  onGoToDashboard: () => void;
}

export const InterviewReport: React.FC<InterviewReportProps> = ({
  interviewId,
  onRetake,
  onGoToDashboard,
}) => {
  const [loading, setLoading] = useState(true);
  const [interview, setInterview] = useState<InterviewSession | null>(null);
  const [report, setReport] = useState<FinalReport | null>(null);
  const [expandedQuestion, setExpandedQuestion] = useState<number | null>(0);
  const [error, setError] = useState<string | null>(null);

  // On-demand reference answers
  const [idealAnswers, setIdealAnswers] = useState<Record<number, IdealAnswer>>({});
  const [loadingAiAnswerFor, setLoadingAiAnswerFor] = useState<number | null>(null);
  const [openAiAnswerIndex, setOpenAiAnswerIndex] = useState<number | null>(null);

  useEffect(() => {
    async function finalize() {
      try {
        setLoading(true);
        const res = await api.finalizeInterview({ interviewId });
        setInterview(res.interview);
        setReport(res.report);

        if (res.report && res.report.overallScoreOutOf10 >= 7.5) {
          confetti({
            particleCount: 70,
            spread: 65,
            origin: { y: 0.6 },
          });
        }
      } catch (err: any) {
        setError(err.message || 'Failed to synthesize interview report.');
      } finally {
        setLoading(false);
      }
    }

    finalize();
  }, [interviewId]);

  const handleFetchIdealAnswer = async (
    questionIdx: number,
    questionText: string,
    topic?: string,
    savedRef?: string
  ) => {
    if (idealAnswers[questionIdx]) {
      setOpenAiAnswerIndex(openAiAnswerIndex === questionIdx ? null : questionIdx);
      return;
    }

    setOpenAiAnswerIndex(questionIdx);
    setLoadingAiAnswerFor(questionIdx);

    try {
      const res = await api.generateIdealAnswer({
        questionText,
        topic,
        techField: interview?.jdTitle || interview?.techField,
        difficulty: interview?.difficulty,
        referenceAnswer: savedRef,
      });
      setIdealAnswers((prev) => ({ ...prev, [questionIdx]: res.idealAnswer }));
    } catch (err) {
      console.error('Failed to load reference answer:', err);
    } finally {
      setLoadingAiAnswerFor(null);
    }
  };

  const getBandStyles = (band: PerformanceBand) => {
    switch (band) {
      case 'Excellent':
        return {
          text: 'text-emerald-600 dark:text-emerald-400',
          border: 'border-emerald-200 dark:border-emerald-500/30',
          bg: 'bg-emerald-50/70 dark:bg-emerald-950/25',
        };
      case 'Good':
        return {
          text: 'text-indigo-600 dark:text-indigo-400',
          border: 'border-indigo-200 dark:border-indigo-500/30',
          bg: 'bg-indigo-50/70 dark:bg-indigo-950/25',
        };
      case 'Satisfactory':
        return {
          text: 'text-amber-600 dark:text-amber-400',
          border: 'border-amber-200 dark:border-amber-500/30',
          bg: 'bg-amber-50/70 dark:bg-amber-950/25',
        };
      default:
        return {
          text: 'text-rose-600 dark:text-rose-400',
          border: 'border-rose-200 dark:border-rose-500/30',
          bg: 'bg-rose-50/70 dark:bg-rose-950/25',
        };
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto min-h-[440px] flex flex-col items-center justify-center p-8 text-center space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
          <Sparkles className="w-7 h-7 animate-spin" />
        </div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">
          Synthesizing Personalized Interview Report...
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md">
          Computing technical & behavioral averages, skill-wise mastery, JD gap diagnostics, and per-question rubric feedback.
        </p>
      </div>
    );
  }

  if (error || !report || !interview) {
    return (
      <div className="max-w-2xl mx-auto p-6 rounded-2xl bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-500/30 text-center space-y-4">
        <AlertCircle className="w-8 h-8 text-rose-500 mx-auto" />
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Report Generation Issue</h2>
        <p className="text-xs text-rose-600 dark:text-rose-300">{error || 'Could not load interview report.'}</p>
        <button
          type="button"
          onClick={onRetake}
          className="px-4 py-2 rounded-xl bg-slate-900 dark:bg-slate-800 text-white text-xs font-semibold hover:bg-slate-800 dark:hover:bg-slate-700 cursor-pointer"
        >
          Return to Setup
        </button>
      </div>
    );
  }

  const bandStyle = getBandStyles(report.performanceBand);

  const rubricItems = [
    { key: 'technicalCorrectness', label: 'Technical / Conceptual Correctness', value: report.criteriaAverages.technicalCorrectness },
    { key: 'relevance', label: 'Relevance & JD Alignment', value: report.criteriaAverages.relevance },
    { key: 'clarity', label: 'Clarity & Structure', value: report.criteriaAverages.clarity },
    { key: 'completeness', label: 'Completeness & Key Concepts', value: report.criteriaAverages.completeness },
    { key: 'communication', label: 'Communication', value: report.criteriaAverages.communication },
  ];

  const totalQuestions = report.totalQuestions ?? interview.questionCount ?? interview.questions.length;
  const questionsAnswered = report.questionsAnswered ?? interview.answers.length;
  const skillPerfList = report.skillPerformance || [];
  const jdMissing = report.jdMissingSkills || interview.jdMissingSkills || [];

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in pb-16 print:p-0">
      {/* Top Action Bar */}
      <div className="flex items-center justify-between print:hidden">
        <button
          type="button"
          onClick={onGoToDashboard}
          className="text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors cursor-pointer"
        >
          ← Return to Analytics & History
        </button>

        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="px-3.5 py-1.5 rounded-xl bg-white hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 font-medium transition-colors flex items-center space-x-1.5 cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
            <span>Print / Save PDF</span>
          </button>
          <button
            type="button"
            onClick={onRetake}
            className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors flex items-center space-x-1.5 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>New Interview Setup</span>
          </button>
        </div>
      </div>

      {/* Header Summary Card */}
      <div className={`rounded-2xl border p-6 sm:p-8 ${bandStyle.bg} ${bandStyle.border} transition-colors`}>
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-2.5 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <span className={`font-bold flex items-center space-x-1.5 ${bandStyle.text}`}>
                <Award className="w-4 h-4" />
                <span>Band: {report.performanceBand}</span>
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-semibold text-slate-900 dark:text-white">
                {interview.jdTitle || interview.techField}
              </span>
              {interview.companyName && interview.companyName !== 'Unknown' && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{interview.companyName}</span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span className="capitalize">{interview.interviewType}</span>
              <span aria-hidden="true">·</span>
              <span className="capitalize">{interview.difficulty}</span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
              Final Mock Interview Report
            </h1>

            <p className="text-sm text-slate-700 dark:text-slate-300 max-w-2xl leading-relaxed">
              {report.detailedSummary}
            </p>
          </div>

          {/* Overall /10 Score Box */}
          <div className="shrink-0 flex flex-col items-center justify-center p-5 rounded-2xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 min-w-[175px]">
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              Overall Score
            </span>
            <div className="my-1 font-mono tabular-nums">
              <span className={`text-4xl font-bold ${bandStyle.text}`}>
                {report.overallScoreOutOf10.toFixed(1)}
              </span>
              <span className="text-base font-semibold text-slate-400 dark:text-slate-500"> / 10</span>
            </div>
            <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
              {questionsAnswered} / {totalQuestions} Questions Answered
            </span>
          </div>
        </div>
      </div>

      {/* KPI Split Row: Questions Answered, Technical Performance, Behavioral Performance */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span className="font-semibold">Completion Coverage</span>
            <Briefcase className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
            {questionsAnswered} <span className="text-xs font-normal text-slate-400">/ {totalQuestions}</span>
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {interview.resumeFileName ? `Resume: ${interview.resumeFileName}` : 'Total questions evaluated'}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span className="font-semibold">Technical Performance</span>
            <Cpu className="w-4 h-4 text-sky-600 dark:text-sky-400" />
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
            {report.technicalPerformance !== null && report.technicalPerformance !== undefined ? (
              <>
                {report.technicalPerformance.toFixed(1)}{' '}
                <span className="text-xs font-normal text-slate-400">/ 10</span>
              </>
            ) : (
              <span className="text-base text-slate-400">Not Applicable</span>
            )}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Average score across technical questions
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span className="font-semibold">Behavioral Performance</span>
            <Users className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
            {report.behavioralPerformance !== null && report.behavioralPerformance !== undefined ? (
              <>
                {report.behavioralPerformance.toFixed(1)}{' '}
                <span className="text-xs font-normal text-slate-400">/ 10</span>
              </>
            ) : (
              <span className="text-base text-slate-400">Not Applicable</span>
            )}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Average score across STAR behavioral questions
          </p>
        </div>
      </div>

      {/* Rubric Averages + Skill-wise Performance */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">
            5-Criterion Rubric Breakdown (0–10 Scale)
          </h3>
          <div className="space-y-3.5">
            {rubricItems.map((item) => {
              const pct = Math.min(100, Math.max(0, item.value * 10));
              return (
                <div key={item.key} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-700 dark:text-slate-300">{item.label}</span>
                    <span className="font-mono font-bold tabular-nums text-slate-900 dark:text-white">
                      {item.value.toFixed(1)} / 10
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className="h-2 rounded-full bg-indigo-600 dark:bg-indigo-500 transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">
            Skill-Wise Performance
          </h3>
          <div className="space-y-2.5">
            {(skillPerfList.length > 0 ? skillPerfList : report.categoryPerformance.map((c) => ({
              skill: c.topic,
              scoreOutOf10: c.scoreOutOf10,
              band: c.band,
              questionCount: 1,
            }))).map((sk, idx) => (
              <div
                key={idx}
                className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                    {sk.skill}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {sk.band} · {sk.questionCount} question{sk.questionCount === 1 ? '' : 's'}
                  </p>
                </div>
                <span className="text-sm font-mono font-bold tabular-nums text-indigo-600 dark:text-indigo-400 shrink-0">
                  {sk.scoreOutOf10.toFixed(1)}/10
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* JD Skill Gaps + Recommended Preparation Topics */}
      {(jdMissing.length > 0 || report.recommendedTopics.length > 0 || (interview.webSources && interview.webSources.length > 0)) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {jdMissing.length > 0 && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-2.5">
              <div className="flex items-center space-x-2 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="w-4 h-4" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  JD Skills Missing / Weak in Resume
                </h3>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                {jdMissing.join(' · ')}
              </p>
            </div>
          )}

          {report.recommendedTopics.length > 0 && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-2.5">
              <div className="flex items-center space-x-2 text-indigo-600 dark:text-indigo-400">
                <BookOpen className="w-4 h-4" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Recommended Preparation Topics
                </h3>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                {report.recommendedTopics.join(' · ')}
              </p>
              {interview.webSources && interview.webSources.length > 0 && (
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1">
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block">
                    Verified Web Sources Referenced
                  </span>
                  <div className="flex flex-wrap gap-3">
                    {interview.webSources.map((src, i) => (
                      <a
                        key={i}
                        href={src.uri}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center space-x-1 text-[11px] text-indigo-600 dark:text-indigo-400 underline"
                      >
                        <span className="truncate max-w-[200px]">{src.title}</span>
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Strong Areas & Weak Areas */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-3">
          <div className="flex items-center space-x-2 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="w-4 h-4" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Strong Areas</h3>
          </div>
          <ul className="space-y-2 text-xs text-slate-700 dark:text-slate-300">
            {report.strengths.map((str, idx) => (
              <li key={idx} className="flex items-start space-x-2">
                <span className="text-emerald-500 mt-0.5">•</span>
                <span className="leading-relaxed">{str}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-3">
          <div className="flex items-center space-x-2 text-amber-600 dark:text-amber-400">
            <TrendingUp className="w-4 h-4" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Weak Areas & Next Steps</h3>
          </div>
          <ul className="space-y-2 text-xs text-slate-700 dark:text-slate-300">
            {report.areasForImprovement.map((area, idx) => (
              <li key={idx} className="flex items-start space-x-2">
                <span className="text-amber-500 mt-0.5">•</span>
                <span className="leading-relaxed">{area}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Question-by-Question Breakdown */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-5">
        <div className="border-b border-slate-200 dark:border-slate-800 pb-4">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">
            Question-by-Question Evaluation Breakdown
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {interview.answers.length} evaluated response{interview.answers.length === 1 ? '' : 's'} with strengths, weaknesses, missing concepts, and suggested improvements
          </p>
        </div>

        <div className="space-y-3">
          {interview.answers.map((ans, idx) => {
            const isExpanded = expandedQuestion === idx;
            const hasAiAnswer = idealAnswers[idx] !== undefined;
            const isAiAnswerOpen = openAiAnswerIndex === idx;
            const isLoadingThisAiAnswer = loadingAiAnswerFor === idx;
            const ev = ans.evaluation;
            const matchingQuestion = interview.questions.find((q) => q.id === ans.questionId);

            return (
              <div
                key={idx}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-4 space-y-3"
              >
                <div
                  className="flex items-start justify-between cursor-pointer gap-4"
                  onClick={() => setExpandedQuestion(isExpanded ? null : idx)}
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">
                        Q{idx + 1}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{ans.skillBeingAssessed || ans.topic}</span>
                      <span aria-hidden="true">·</span>
                      <span className="capitalize">{ans.interviewType}</span>
                    </div>
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white leading-snug">
                      {ans.question}
                    </h4>
                  </div>

                  <div className="flex items-center space-x-3 shrink-0">
                    <div className="text-right">
                      <span className="text-sm font-mono font-bold tabular-nums text-indigo-600 dark:text-indigo-400 block">
                        {ev.overallScoreOutOf10.toFixed(1)}/10
                      </span>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400">
                        {ev.performanceBand}
                      </span>
                    </div>
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-400" />
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3 text-xs animate-fade-in">
                    <div>
                      <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block mb-1">
                        {ans.inputModality === 'voice' ? 'Cleaned voice transcript used for content scoring' : 'Your Submitted Answer'}
                      </span>
                      <p className="text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-800 leading-relaxed">
                        {ans.cleanedTranscript || ans.rawTranscript}
                      </p>
                    </div>

                    {ans.inputModality === 'voice' && ev.deliveryFeatures?.available && (
                      <div className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2">
                        <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Measured speech delivery</span>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px] tabular-nums text-slate-600 dark:text-slate-400">
                          <span>{ev.deliveryFeatures.speakingRateWpm} words/min</span>
                          <span>{ev.deliveryFeatures.pauseFrequencyPerMin.toFixed(1)} pauses/min</span>
                          <span>{ev.deliveryFeatures.fillerWordCount} filler words</span>
                          <span>{ev.deliveryFeatures.trimmedDurationSeconds.toFixed(1)}s spoken</span>
                        </div>
                        {ans.rawTranscript !== ans.cleanedTranscript && (
                          <details className="text-[11px] text-slate-500 dark:text-slate-400">
                            <summary className="cursor-pointer">Show original transcript</summary>
                            <p className="mt-1 leading-relaxed">{ans.rawTranscript}</p>
                          </details>
                        )}
                      </div>
                    )}

                    {/* 5 Rubric Scores Inline Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 font-mono text-[11px] tabular-nums bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                      <div>Correct: {ev.criteria.technicalCorrectness.toFixed(1)}/10</div>
                      <div>Relevant: {ev.criteria.relevance.toFixed(1)}/10</div>
                      <div>Clarity: {ev.criteria.clarity.toFixed(1)}/10</div>
                      <div>Complete: {ev.criteria.completeness.toFixed(1)}/10</div>
                      <div>Comm: {ev.criteria.communication.toFixed(1)}/10</div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400 block mb-1">
                          Strengths
                        </span>
                        <ul className="list-disc list-inside text-slate-600 dark:text-slate-400 space-y-0.5">
                          {ev.strengths.map((s, sIdx) => (
                            <li key={sIdx}>{s}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                        <span className="font-semibold text-amber-600 dark:text-amber-400 block mb-1">
                          Weaknesses & Missing Concepts
                        </span>
                        <ul className="list-disc list-inside text-slate-600 dark:text-slate-400 space-y-0.5">
                          {ev.weaknesses.map((w, wIdx) => (
                            <li key={wIdx}>{w}</li>
                          ))}
                          {ev.missingConcepts.length > 0 && (
                            <li className="font-mono text-[11px]">
                              Missing: {ev.missingConcepts.join(', ')}
                            </li>
                          )}
                        </ul>
                      </div>
                    </div>

                    <div className="p-3 rounded-lg bg-indigo-50/70 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-500/20 space-y-1">
                      <span className="font-semibold text-indigo-700 dark:text-indigo-300 block">
                        Suggested Improvement
                      </span>
                      <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                        {ev.suggestedImprovement}
                      </p>
                    </div>

                    <div className="pt-1 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() =>
                          handleFetchIdealAnswer(
                            idx,
                            ans.question,
                            ans.topic,
                            matchingQuestion?.referenceAnswer
                          )
                        }
                        disabled={isLoadingThisAiAnswer}
                        className="px-3 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 border border-indigo-200 dark:border-indigo-500/30 text-indigo-700 dark:text-indigo-300 font-medium text-xs flex items-center space-x-1.5 cursor-pointer"
                      >
                        <BookOpen className="w-3.5 h-3.5" />
                        <span>
                          {isLoadingThisAiAnswer
                            ? 'Loading Reference Answer...'
                            : hasAiAnswer
                            ? isAiAnswerOpen
                              ? 'Hide Reference Answer'
                              : 'View Reference Answer'
                            : 'View Reference Answer'}
                        </span>
                      </button>
                    </div>

                    {isAiAnswerOpen && idealAnswers[idx] && (
                      <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-500/30 space-y-2 animate-fade-in">
                        <div className="flex items-center space-x-1.5 font-bold text-slate-900 dark:text-white text-xs">
                          <MessageSquare className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                          <span>Reference Answer</span>
                        </div>
                        <p className="text-slate-800 dark:text-slate-200 leading-relaxed">
                          {idealAnswers[idx].fullIdealAnswer}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Academic Disclaimer */}
      <div className="text-center text-[11px] text-slate-500 dark:text-slate-400 pt-2">
        Academic placement practice evaluation on a 0–10 rubric scale. Designed for structured candidate preparation.
      </div>
    </div>
  );
};
