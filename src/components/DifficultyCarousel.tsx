import React, { useState } from 'react';
import { DIFFICULTY_LEVELS, DifficultyLevel } from '../types';
import { CheckCircle2, Shield, Zap, Sparkles, Trophy, ChevronDown, ChevronUp } from 'lucide-react';

interface DifficultyCarouselProps {
  difficulty: DifficultyLevel;
  onSelectDifficulty: (level: DifficultyLevel) => void;
}

const LEVEL_ICONS: Partial<Record<DifficultyLevel, React.ElementType>> = {
  easy: Zap,
  medium: Sparkles,
  hard: Shield,
  junior: Zap,
  intermediate: Sparkles,
  senior: Shield,
  lead: Trophy,
};

export const DifficultyCarousel: React.FC<DifficultyCarouselProps> = ({
  difficulty,
  onSelectDifficulty,
}) => {
  const [isOpen, setIsOpen] = useState(true);

  const currentLevel =
    DIFFICULTY_LEVELS.find((lvl) => lvl.id === difficulty) || DIFFICULTY_LEVELS[2];
  const CurrentIcon = LEVEL_ICONS[currentLevel.id] || Shield;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
              Step 02
            </span>
            <h3 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
              Interview Difficulty Level
            </h3>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Tap the difficulty tier to open and scroll all seniority levels
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 flex items-center space-x-1 cursor-pointer"
        >
          <span>{isOpen ? 'Close List' : 'Browse All Tiers'}</span>
          {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Tap-Trigger Active Level Card */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="p-4 rounded-2xl border border-indigo-500/40 bg-indigo-50/50 dark:bg-indigo-950/20 hover:border-indigo-500 cursor-pointer transition-all duration-200 flex items-center justify-between gap-4 shadow-sm"
      >
        <div className="flex items-center space-x-3.5 min-w-0">
          <div className="w-11 h-11 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-indigo-600/30">
            <CurrentIcon className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center space-x-2">
              <span className="text-[10px] uppercase font-bold tracking-wider text-indigo-600 dark:text-indigo-400">
                Active Seniority
              </span>
              <span className="text-slate-400">·</span>
              <span className="text-xs font-semibold px-1.5 py-0.2 rounded bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300">
                {currentLevel.badge}
              </span>
            </div>
            <h4 className="text-base font-bold text-slate-900 dark:text-white tracking-tight truncate">
              {currentLevel.label}
            </h4>
          </div>
        </div>

        <div className="flex items-center space-x-3 shrink-0">
          <div className="text-right hidden sm:block">
            <span className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 block">
              Focus
            </span>
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate max-w-[150px] block">
              {currentLevel.focus}
            </span>
          </div>

          <div className="w-8 h-8 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300">
            {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </div>
      </div>

      {/* Expandable Scroll Drawer with All Levels */}
      {isOpen && (
        <div className="space-y-2 animate-fade-in">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 px-1">
            <span>Scroll and tap to calibrate interview depth:</span>
            <span className="font-mono text-[11px]">{DIFFICULTY_LEVELS.length} levels</span>
          </div>

          <div className="space-y-2.5 max-h-[360px] overflow-y-auto pr-1 border border-slate-200 dark:border-slate-800/80 rounded-2xl p-2.5 bg-slate-50/50 dark:bg-slate-950/50 shadow-inner">
            {DIFFICULTY_LEVELS.map((lvl) => {
              const isSelected = difficulty === lvl.id;
              const Icon = LEVEL_ICONS[lvl.id] || Zap;

              return (
                <div
                  key={lvl.id}
                  onClick={() => {
                    onSelectDifficulty(lvl.id);
                  }}
                  className={`p-3.5 rounded-xl border text-left cursor-pointer transition-all duration-150 flex flex-col md:flex-row md:items-center justify-between gap-3 ${
                    isSelected
                      ? 'bg-indigo-50 dark:bg-indigo-950/50 border-indigo-500 ring-1 ring-indigo-500 shadow-sm'
                      : 'bg-white dark:bg-slate-900/90 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900'
                  }`}
                >
                  {/* Left Column: Icon & Level Name */}
                  <div className="flex items-start sm:items-center space-x-3 min-w-[200px]">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                        isSelected
                          ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white tracking-tight truncate">
                        {lvl.label}
                      </h4>
                      <span
                        className={`text-[10px] uppercase font-bold tracking-wider ${
                          isSelected ? 'text-indigo-600 dark:text-indigo-300' : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {lvl.badge}
                      </span>
                    </div>
                  </div>

                  {/* Middle: Scope Description */}
                  <div className="flex-1 min-w-0 text-xs text-slate-600 dark:text-slate-300 leading-relaxed md:px-2">
                    <p>{lvl.description}</p>
                  </div>

                  {/* Right: Focus & Check Indicator */}
                  <div className="flex items-center justify-between md:justify-end space-x-3 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-slate-200 dark:border-slate-800/60 min-w-[180px]">
                    <div className="text-right">
                      <span className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 block">
                        Focus
                      </span>
                      <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-300 truncate max-w-[160px] block">
                        {lvl.focus}
                      </span>
                    </div>

                    <div className="w-5 h-5 flex items-center justify-center shrink-0">
                      {isSelected ? (
                        <CheckCircle2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                      ) : (
                        <div className="w-4 h-4 rounded-full border border-slate-300 dark:border-slate-700" />
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
