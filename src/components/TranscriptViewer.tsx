import React, { useMemo } from 'react';
import { AnswerEvaluation, PerformanceBand } from '../types';
import { checkSpelling, replaceWord } from '../lib/spellChecker';
import {
  Send,
  ChevronRight,
  Award,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Wand2,
  RotateCcw,
  Lock,
} from 'lucide-react';

interface TranscriptViewerProps {
  questionText: string;
  candidateAnswer: string;
  setCandidateAnswer: (text: string) => void;
  isSubmittingAnswer: boolean;
  onSubmitAnswer: () => void;
  currentEvaluation: AnswerEvaluation | null;
  isLastQuestion: boolean;
  answeredCount: number;
  totalQuestions: number;
  onNextQuestion: () => void;
  onFinishInterview: () => void;
  onRequestReAnswer: () => void;
  errorMessage: string | null;
  canSubmitAnswer?: boolean;
  inputMode?: 'text' | 'voice';
  autoSubmit?: boolean;
}

const MAX_CHAR_LIMIT = 4000;

function getBandStyle(band: PerformanceBand, isOffTopic: boolean) {
  if (isOffTopic) {
    return 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30';
  }
  switch (band) {
    case 'Excellent':
      return 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30';
    case 'Good':
      return 'bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-500/30';
    case 'Satisfactory':
      return 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30';
    default:
      return 'bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-500/30';
  }
}

export const TranscriptViewer: React.FC<TranscriptViewerProps> = ({
  questionText,
  candidateAnswer,
  setCandidateAnswer,
  isSubmittingAnswer,
  onSubmitAnswer,
  currentEvaluation,
  isLastQuestion,
  answeredCount,
  totalQuestions,
  onNextQuestion,
  onFinishInterview,
  onRequestReAnswer,
  errorMessage,
  canSubmitAnswer,
  inputMode = 'text',
  autoSubmit = false,
}) => {
  const isBlockedOffTopic = Boolean(currentEvaluation?.isOffTopic);
  const isSubmittedLocked = currentEvaluation !== null && !isBlockedOffTopic;

  const wordCount = candidateAnswer.trim().split(/\s+/).filter(Boolean).length;
  const charCount = candidateAnswer.length;
  const remainingChars = MAX_CHAR_LIMIT - charCount;

  const spellingIssues = useMemo(() => {
    if (isSubmittedLocked) return [];
    return checkSpelling(candidateAnswer);
  }, [candidateAnswer, isSubmittedLocked]);

  const handleFixWord = (typo: string, correction: string) => {
    if (isSubmittedLocked) return;
    const updated = replaceWord(candidateAnswer, typo, correction);
    setCandidateAnswer(updated.slice(0, MAX_CHAR_LIMIT));
  };

  const handleFixAllWords = () => {
    if (isSubmittedLocked) return;
    let updated = candidateAnswer;
    for (const issue of spellingIssues) {
      updated = replaceWord(updated, issue.word, issue.suggestion);
    }
    setCandidateAnswer(updated.slice(0, MAX_CHAR_LIMIT));
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (isSubmittedLocked) return;
    setCandidateAnswer(e.target.value.slice(0, MAX_CHAR_LIMIT));
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-5 transition-colors">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center space-x-2">
          <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
            {inputMode === 'voice' ? 'Review Voice Transcript' : 'Your Written Response'}
          </span>
          <span aria-hidden="true" className="text-slate-400">·</span>
          <span className="text-xs font-mono text-indigo-600 dark:text-indigo-400">
            {inputMode === 'voice' ? 'Transcript used for content scoring' : 'Text Input Evaluation'}
          </span>
        </div>

        {isSubmittedLocked && (
          <div className="inline-flex items-center space-x-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            <Lock className="w-3.5 h-3.5" />
            <span>Submitted & Evaluated</span>
          </div>
        )}
      </div>

      {/* Textarea */}
      <div className="space-y-1.5">
        <textarea
          rows={6}
          value={candidateAnswer}
          onChange={handleTextChange}
          readOnly={isSubmittedLocked || autoSubmit}
          disabled={isSubmittingAnswer}
          maxLength={MAX_CHAR_LIMIT}
          spellCheck={true}
          placeholder={inputMode === 'voice'
            ? 'Your recognized transcript will appear here. You can correct it before submitting; the recorded audio remains available for transcription if this is blank.'
            : 'Write a clear, structured answer addressing key concepts, trade-offs, or specific metrics from your experience (STAR structure for behavioral prompts)...'}
          className={`w-full border rounded-xl p-4 text-sm outline-none resize-none leading-relaxed transition-colors ${
            isSubmittedLocked
              ? 'bg-slate-100/80 dark:bg-slate-950/70 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 cursor-default'
              : remainingChars <= 100
              ? 'bg-slate-50 dark:bg-slate-950 border-red-400 focus:border-red-500 focus:ring-1 focus:ring-red-500 text-slate-900 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-600'
              : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-900 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-600'
          }`}
        />

        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <div className="flex items-center space-x-2 font-mono tabular-nums">
            <span className="text-slate-500 dark:text-slate-400">{wordCount} words</span>
            <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
            <span
              className={
                remainingChars <= 100
                  ? 'text-red-600 dark:text-red-400 font-bold'
                  : remainingChars <= 400
                  ? 'text-amber-600 dark:text-amber-400 font-semibold'
                  : 'text-slate-500 dark:text-slate-400'
              }
            >
              {charCount} / {MAX_CHAR_LIMIT} chars
            </span>
          </div>

          {!isSubmittedLocked && candidateAnswer.trim().length > 10 && (
            <div>
              {spellingIssues.length > 0 ? (
                <span className="inline-flex items-center space-x-1 text-amber-600 dark:text-amber-400 font-medium">
                  <AlertTriangle className="w-3 h-3" />
                  <span>
                    {spellingIssues.length} {spellingIssues.length === 1 ? 'word' : 'words'} flagged
                  </span>
                </span>
              ) : (
                <span className="inline-flex items-center space-x-1 text-emerald-600 dark:text-emerald-400 font-medium">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>Spelling verified</span>
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Real-time Spell Checker Suggestions (editable mode only) */}
      {!isSubmittedLocked && spellingIssues.length > 0 && (
        <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-500/30 text-xs space-y-2 animate-fade-in">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-amber-800 dark:text-amber-300 flex items-center space-x-1.5">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <span>Spelling Check: {spellingIssues.length} word(s) need attention</span>
            </span>
            {spellingIssues.length > 1 && (
              <button
                type="button"
                onClick={handleFixAllWords}
                className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold text-[11px] flex items-center space-x-1 cursor-pointer"
              >
                <Wand2 className="w-3 h-3" />
                <span>Fix All</span>
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {spellingIssues.map((issue, idx) => (
              <div
                key={idx}
                className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-500/30 text-[11px]"
              >
                <span className="line-through text-red-500 font-mono">{issue.word}</span>
                <span className="text-slate-400">→</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold font-mono">
                  {issue.suggestion}
                </span>
                <button
                  type="button"
                  onClick={() => handleFixWord(issue.word, issue.suggestion)}
                  className="ml-1 px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 font-bold text-[10px] cursor-pointer"
                >
                  Fix
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* OFF-TOPIC RE-ANSWER GATE */}
      {isBlockedOffTopic && currentEvaluation && (
        <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-500/40 space-y-3 animate-fade-in">
          <div className="flex items-start space-x-3">
            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="text-sm font-bold text-red-800 dark:text-red-300">
                Off-Topic Response Detected (Relevance {currentEvaluation.criteria.relevance.toFixed(1)}/10)
              </h4>
              <p className="text-xs text-red-700 dark:text-red-200 leading-relaxed">
                {currentEvaluation.offTopicReason ||
                  'Your response did not directly address the prompt requirements. Please rewrite your answer before continuing.'}
              </p>
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onRequestReAnswer}
              className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold flex items-center space-x-1.5 cursor-pointer transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Clear & Re-Answer Question</span>
            </button>
          </div>
        </div>
      )}

      {currentEvaluation && (
        <section className="space-y-3 animate-fade-in" aria-label="Answer review">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">1. Question</h4>
            <p className="text-sm leading-relaxed text-slate-900 dark:text-white">{questionText}</p>
            <h4 className="pt-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">2. Your answer</h4>
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-slate-700 dark:text-slate-300">{candidateAnswer || 'No transcript was captured.'}</p>
          </div>
        </section>
      )}

      {/* GROUNDED RUBRIC SCORECARD (/10 scale) */}
      {currentEvaluation && !isBlockedOffTopic && (
        <div className="p-5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-5 animate-fade-in">
          {/* Top Summary Row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Award className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span className="text-sm font-bold text-slate-900 dark:text-white">
                  AI Rubric Evaluation
                </span>
                <span
                  className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${getBandStyle(
                    currentEvaluation.performanceBand,
                    false
                  )}`}
                >
                  {currentEvaluation.performanceBand}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                <span>Concept Coverage: {(currentEvaluation.contentFeatures.conceptCoverageRatio * 100).toFixed(0)}%</span>
                <span>·</span>
                <span>Ref Similarity: {(currentEvaluation.contentFeatures.semanticSimilarityToReference * 100).toFixed(0)}%</span>
                <span>·</span>
                <span>{currentEvaluation.latencyMs} ms</span>
              </div>
              {currentEvaluation.deliveryFeatures?.available && (
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 mt-1">
                  <span>Voice: {currentEvaluation.deliveryFeatures.speakingRateWpm} WPM</span>
                  <span>·</span>
                  <span>{currentEvaluation.deliveryFeatures.pauseFrequencyPerMin.toFixed(1)} pauses/min</span>
                  <span>·</span>
                  <span>{currentEvaluation.deliveryFeatures.fillerWordCount} fillers</span>
                  <span>·</span>
                  <span>{currentEvaluation.deliveryFeatures.trimmedDurationSeconds.toFixed(1)}s</span>
                </div>
              )}
            </div>

            <div className="text-left sm:text-right">
              <span className="text-2xl font-bold font-mono tabular-nums text-indigo-600 dark:text-indigo-400">
                {currentEvaluation.overallScoreOutOf10.toFixed(1)}
              </span>
              <span className="text-xs font-mono text-slate-500 dark:text-slate-400"> / 10</span>
            </div>
          </div>

          {/* 5 Fixed Rubric Criteria Bars (/10) */}
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
            {[
              { label: 'Correctness', val: currentEvaluation.criteria.technicalCorrectness },
              { label: 'Relevance', val: currentEvaluation.criteria.relevance },
              { label: 'Clarity', val: currentEvaluation.criteria.clarity },
              { label: 'Completeness', val: currentEvaluation.criteria.completeness },
              { label: 'Communication', val: currentEvaluation.criteria.communication },
            ].map((item) => (
              <div key={item.label} className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-600 dark:text-slate-400 font-medium">{item.label}</span>
                  <span className="font-mono font-bold tabular-nums text-slate-900 dark:text-white">
                    {item.val.toFixed(1)}
                  </span>
                </div>
                <div className="h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-600 rounded-full"
                    style={{ width: `${Math.min(100, item.val * 10)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Feedback, Strengths, Weaknesses, Missing Concepts & Suggested Improvement */}
          <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-800 text-xs">
            <p className="text-slate-800 dark:text-slate-200 leading-relaxed">
              {currentEvaluation.feedback}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">Strengths</span>
                <ul className="list-disc list-inside text-slate-600 dark:text-slate-400 mt-1 space-y-0.5">
                  {currentEvaluation.strengths.map((s, idx) => (
                    <li key={idx}>{s}</li>
                  ))}
                </ul>
              </div>
              <div>
                <span className="font-semibold text-amber-600 dark:text-amber-400">
                  Weaknesses & Missing Concepts
                </span>
                <ul className="list-disc list-inside text-slate-600 dark:text-slate-400 mt-1 space-y-0.5">
                  {currentEvaluation.weaknesses.map((w, idx) => (
                    <li key={idx}>{w}</li>
                  ))}
                  {currentEvaluation.missingConcepts.length > 0 && (
                    <li className="font-mono text-[11px]">
                      Missing Concepts: {currentEvaluation.missingConcepts.join(', ')}
                    </li>
                  )}
                </ul>
              </div>
            </div>

            <div className="p-3.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <span className="font-semibold text-indigo-600 dark:text-indigo-400 block mb-1">
                Suggested Improved Answer
              </span>
              <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                {currentEvaluation.suggestedImprovement}
              </p>
            </div>
          </div>
        </div>
      )}

      {errorMessage && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Action Footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
          {answeredCount} of {totalQuestions} questions answered
        </div>

        <div className="flex flex-wrap items-center gap-2.5 ml-auto">
          {!isSubmittedLocked && !autoSubmit ? (
            <button
              type="button"
              onClick={onSubmitAnswer}
              disabled={isSubmittingAnswer || !(canSubmitAnswer ?? Boolean(candidateAnswer.trim()))}
              className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs sm:text-sm transition-colors flex items-center justify-center space-x-2 disabled:opacity-50 cursor-pointer whitespace-nowrap"
            >
              {isSubmittingAnswer ? (
                <>
                  <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Evaluating Against JD & Rubric...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Submit Answer</span>
                </>
              )}
            </button>
          ) : isSubmittedLocked ? (
            <>
              {!isLastQuestion && (
                <button
                  type="button"
                  onClick={onNextQuestion}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs sm:text-sm transition-colors flex items-center justify-center space-x-2 cursor-pointer whitespace-nowrap"
                >
                  <span>Next Question</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              )}

              {(isLastQuestion || answeredCount >= totalQuestions) && (
                <button
                  type="button"
                  onClick={onFinishInterview}
                  className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs sm:text-sm transition-colors flex items-center justify-center space-x-2 cursor-pointer whitespace-nowrap"
                >
                  <Award className="w-4 h-4" />
                  <span>Complete Interview & View Report</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              )}
            </>
          ) : (
            <span className="text-xs text-slate-500 dark:text-slate-400">Your answer is evaluated automatically when you stop recording.</span>
          )}
        </div>
      </div>
    </div>
  );
};
