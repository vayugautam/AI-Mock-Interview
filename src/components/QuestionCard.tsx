import React, { useState } from 'react';
import { InterviewQuestion } from '../types';
import {
  HelpCircle,
  Volume2,
  Square,
} from 'lucide-react';

interface QuestionCardProps {
  question: InterviewQuestion;
  currentIndex: number;
  totalQuestions: number;
  difficulty?: string;
  canSpeakQuestion: boolean;
  isQuestionSpeaking: boolean;
  autoReadQuestions: boolean;
  questionSpeechError: string | null;
  onSpeakQuestion: () => void;
  onStopQuestionSpeech: () => void;
  onAutoReadChange: (enabled: boolean) => void;
  voicePersona: string;
  onVoicePersonaChange: (persona: string) => void;
}

export const QuestionCard: React.FC<QuestionCardProps> = ({
  question,
  currentIndex,
  totalQuestions,
  difficulty,
  canSpeakQuestion,
  isQuestionSpeaking,
  autoReadQuestions,
  questionSpeechError,
  onSpeakQuestion,
  onStopQuestionSpeech,
  onAutoReadChange,
  voicePersona,
  onVoicePersonaChange,
}) => {
  const [showHint, setShowHint] = useState(false);

  React.useEffect(() => {
    setShowHint(false);
  }, [question.id, question.question]);

  const alignmentLabel =
    question.resumeAlignment === 'resume_verified'
      ? 'Probes Resume Experience'
      : question.resumeAlignment === 'skill_gap'
      ? 'JD Skill Gap Probe'
      : 'Core JD Requirement';

  const alignmentColor =
    question.resumeAlignment === 'skill_gap'
      ? 'text-amber-600 dark:text-amber-400'
      : question.resumeAlignment === 'resume_verified'
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-indigo-600 dark:text-indigo-400';

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 lg:p-10 space-y-6 transition-colors">
      {/* Metadata Header (Zero-pill unboxed separators) */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span className="font-mono font-bold tabular-nums text-indigo-600 dark:text-indigo-400">
            Question {currentIndex + 1} of {totalQuestions}
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-semibold text-slate-700 dark:text-slate-300">{question.topic}</span>
          <span aria-hidden="true">·</span>
          <span className="capitalize">{question.questionType || question.interviewType}</span>
          <span aria-hidden="true">·</span>
          <span className="capitalize">{question.difficulty || difficulty}</span>
          <span aria-hidden="true">·</span>
          <span className={`font-semibold ${alignmentColor}`}>{alignmentLabel}</span>
        </div>

        <div className="flex items-center space-x-3 self-end sm:self-auto">
          <label className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
            Interviewer
            <select
              value={voicePersona}
              onChange={(event) => onVoicePersonaChange(event.target.value)}
              className="max-w-40 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5 text-[11px] text-slate-700 dark:text-slate-200 outline-none focus:border-indigo-500"
              aria-label="Interviewer voice persona"
            >
              <option value="calm_recruiter">Calm recruiter</option>
              <option value="technical_engineer">Technical engineer</option>
              <option value="supportive_coach">Supportive interviewer</option>
              <option value="direct_hiring_manager">Direct hiring manager</option>
              <option value="thoughtful_lead">Thoughtful interviewer</option>
              <option value="brisk_interviewer">Focused interviewer</option>
            </select>
          </label>
          <button
            type="button"
            onClick={isQuestionSpeaking ? onStopQuestionSpeech : onSpeakQuestion}
            disabled={!canSpeakQuestion}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer border border-indigo-200 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            aria-label={isQuestionSpeaking ? 'Stop reading question' : 'Read question aloud'}
          >
            {isQuestionSpeaking ? <Square className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            <span>{isQuestionSpeaking ? 'Stop' : 'Read aloud'}</span>
          </button>

          <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 cursor-pointer whitespace-nowrap">
            <input
              type="checkbox"
              checked={autoReadQuestions}
              onChange={(event) => onAutoReadChange(event.target.checked)}
              disabled={!canSpeakQuestion}
              className="accent-indigo-600"
            />
            Auto-read
          </label>

          {question.hint && (
            <button
              type="button"
              onClick={() => setShowHint(!showHint)}
              className="text-xs text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-300 flex items-center space-x-1 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>{showHint ? 'Hide Hint' : 'Hint'}</span>
            </button>
          )}

        </div>
      </div>

      {/* Question Prompt */}
      <h2 className="max-w-5xl text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white leading-snug">
        {question.question}
      </h2>
      {!canSpeakQuestion && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">Built-in question audio is unavailable in this browser. Try a browser with Speech Synthesis support.</p>
      )}
      {questionSpeechError && (
        <p role="status" className="text-[11px] text-amber-600 dark:text-amber-400">{questionSpeechError}</p>
      )}

      {/* JD Relevance & Skill Being Assessed */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs">
        <div>
          <span className="font-semibold text-slate-500 dark:text-slate-400 block mb-0.5">
            Skill Assessed & Key Concepts
          </span>
          <p className="text-slate-800 dark:text-slate-200">
            <strong className="font-semibold">{question.skillBeingAssessed || question.topic}</strong>
            {' · '}
            <span className="font-mono text-[11px] text-slate-600 dark:text-slate-400">
              {(question.expectedKeywords || []).join(', ')}
            </span>
          </p>
        </div>

        <div>
          <span className="font-semibold text-slate-500 dark:text-slate-400 block mb-0.5">
            Why Relevant to JD
          </span>
          <p className="text-slate-700 dark:text-slate-300">
            {question.jdRelevance || 'Directly aligned with target Job Description requirements.'}
          </p>
        </div>
      </div>

      {/* Hint Drawer */}
      {showHint && question.hint && (
        <div className="p-3.5 rounded-xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-500/30 text-xs text-amber-800 dark:text-amber-200 animate-fade-in">
          <span className="font-bold">Guidance: </span>
          {question.hint}
        </div>
      )}

    </div>
  );
};
