import React from 'react';
import { Volume2, VolumeX, RefreshCw } from 'lucide-react';

interface InterviewerStageProps {
  isAiSpeaking: boolean;
  ttsEnabled: boolean;
  onToggleTts: () => void;
  onReplayQuestion: () => void;
}

export const InterviewerStage: React.FC<InterviewerStageProps> = ({
  isAiSpeaking,
  ttsEnabled,
  onToggleTts,
  onReplayQuestion,
}) => {
  return (
    <div className="relative rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-sm dark:shadow-xl overflow-hidden transition-colors">
      {/* Top Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-2">
          <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 dark:bg-indigo-500 animate-pulse" />
          <span className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
            AI Lead Interviewer
          </span>
        </div>

        {/* Audio Controls */}
        <div className="flex items-center space-x-1.5">
          <button
            type="button"
            onClick={onToggleTts}
            title={ttsEnabled ? 'Mute AI Voice' : 'Unmute AI Voice'}
            className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
          >
            {ttsEnabled ? (
              <Volume2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            ) : (
              <VolumeX className="w-4 h-4 text-slate-400 dark:text-slate-500" />
            )}
          </button>
          <button
            type="button"
            onClick={onReplayQuestion}
            title="Replay Question Audio"
            className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
          >
            <RefreshCw className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          </button>
        </div>
      </div>

      {/* Interviewer Visual Presence */}
      <div className="flex flex-col items-center justify-center py-4">
        <div className="relative">
          {/* Animated pulse halo when talking */}
          {isAiSpeaking && (
            <div className="absolute inset-0 -m-3 rounded-full bg-indigo-500/25 animate-ping pointer-events-none" />
          )}

          <div
            className={`w-28 h-28 rounded-full overflow-hidden p-1 bg-gradient-to-tr from-indigo-500 via-violet-500 to-sky-400 shadow-xl transition-all duration-300 ${
              isAiSpeaking ? 'ring-4 ring-indigo-500/50 scale-105' : 'ring-1 ring-slate-300 dark:ring-slate-700'
            }`}
          >
            <img
              src="/src/assets/images/interviewer_avatar_1793375781956.jpg"
              alt="AI Interviewer Dr. Arthur Vance"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover rounded-full"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          </div>
        </div>

        <div className="mt-3 text-center">
          <h4 className="text-sm font-bold text-slate-900 dark:text-white">Dr. Arthur Vance</h4>
          <p className="text-xs text-slate-500 dark:text-slate-400">Principal Systems Evaluator · Gemini AI</p>
        </div>

        {/* Dynamic Voice Speech Visualizer */}
        <div className="flex items-center space-x-1 mt-3 h-5">
          {[10, 20, 16, 26, 14, 22, 12, 24, 18, 12].map((height, i) => (
            <div
              key={i}
              style={{ height: isAiSpeaking ? `${height}px` : '4px' }}
              className={`w-1 rounded-full transition-all duration-150 ${
                isAiSpeaking
                  ? 'bg-indigo-600 dark:bg-indigo-400'
                  : 'bg-slate-300 dark:bg-slate-700'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
