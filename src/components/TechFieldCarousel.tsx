import React, { useState } from 'react';
import { TECH_FIELDS } from '../types';
import {
  CheckCircle2,
  Code2,
  Database,
  Cpu,
  Globe,
  Network,
  Boxes,
  BrainCircuit,
  Users,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface TechFieldCarouselProps {
  selectedField: string;
  onSelectField: (fieldId: string) => void;
}

const FIELD_ICONS: Record<string, React.ElementType> = {
  'Data Structures & Algorithms': Code2,
  'Database Management Systems': Database,
  'Operating Systems': Cpu,
  'Computer Networks': Network,
  'Object-Oriented Programming': Boxes,
  'Web Development': Globe,
  'AI / ML Basics': BrainCircuit,
  'HR & Behavioural': Users,
  'Full Stack Development': Globe,
};

export const TechFieldCarousel: React.FC<TechFieldCarouselProps> = ({
  selectedField,
  onSelectField,
}) => {
  const [isOpen, setIsOpen] = useState(true);

  const currentField = TECH_FIELDS.find((f) => f.id === selectedField) || TECH_FIELDS[0];
  const CurrentIcon = FIELD_ICONS[currentField.id] || Code2;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <div className="flex items-center space-x-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400">Step 01</span>
            <span aria-hidden="true">·</span>
            <h3 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
              Subject / Target Role
            </h3>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Tap to open and scroll across placement subjects and specializations
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 flex items-center space-x-1 cursor-pointer whitespace-nowrap shrink-0"
        >
          <span>{isOpen ? 'Close List' : 'Browse Subjects'}</span>
          {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Tap-Trigger Card */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="p-4 rounded-xl border border-indigo-500/40 bg-indigo-50/40 dark:bg-indigo-950/20 hover:border-indigo-500 cursor-pointer transition-colors flex items-center justify-between gap-4"
      >
        <div className="flex items-center space-x-3.5 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0">
            <CurrentIcon className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center space-x-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-medium text-indigo-600 dark:text-indigo-400">Active Subject</span>
              <span aria-hidden="true">·</span>
              <span>{currentField.category}</span>
            </div>
            <h4 className="text-base font-bold text-slate-900 dark:text-white tracking-tight truncate">
              {currentField.title}
            </h4>
          </div>
        </div>

        <div className="flex items-center space-x-2 shrink-0 text-xs text-slate-500 dark:text-slate-400">
          <span className="hidden sm:inline">{isOpen ? 'Tap to collapse' : 'Tap to scroll'}</span>
          <div className="w-8 h-8 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300">
            {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </div>
      </div>

      {isOpen && (
        <div className="space-y-2 animate-fade-in">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 px-1">
            <span>Scroll and select a placement subject:</span>
            <span className="font-mono tabular-nums">{TECH_FIELDS.length} subjects</span>
          </div>

          <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1 border border-slate-200 dark:border-slate-800 rounded-xl p-2 bg-slate-50 dark:bg-slate-950">
            {TECH_FIELDS.map((field) => {
              const isSelected = selectedField === field.id;
              const Icon = FIELD_ICONS[field.id] || Code2;

              return (
                <div
                  key={field.id}
                  onClick={() => onSelectField(field.id)}
                  className={`p-3.5 rounded-xl border text-left cursor-pointer transition-colors flex flex-col md:flex-row md:items-center justify-between gap-3 ${
                    isSelected
                      ? 'bg-indigo-50/70 dark:bg-indigo-950/40 border-indigo-500'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center space-x-3 min-w-[220px]">
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                        isSelected
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white tracking-tight truncate">
                        {field.title}
                      </h4>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">{field.category}</span>
                    </div>
                  </div>

                  <div className="flex-1 min-w-0 text-xs text-slate-600 dark:text-slate-300 leading-relaxed md:px-2">
                    <p className="line-clamp-2">{field.description}</p>
                  </div>

                  <div className="flex items-center justify-between md:justify-end space-x-3 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-slate-200 dark:border-slate-800">
                    <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate max-w-[180px]">
                      {field.skills.slice(0, 3).join(' · ')}
                    </span>

                    <div className="w-5 h-5 flex items-center justify-center shrink-0">
                      {isSelected ? (
                        <CheckCircle2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
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
