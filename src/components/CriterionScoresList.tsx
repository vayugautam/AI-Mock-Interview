import React from 'react';

const CRITERION_LABELS: Record<string, string> = {
  technical_correctness: 'Technical correctness',
  star_structure: 'STAR structure',
  relevance: 'Relevance',
  clarity: 'Clarity',
  completeness: 'Completeness',
  communication: 'Communication',
};

const PREFERRED_ORDER = [
  'technical_correctness',
  'star_structure',
  'relevance',
  'clarity',
  'completeness',
  'communication',
];

function formatCriterionLabel(key: string): string {
  if (CRITERION_LABELS[key]) {
    return CRITERION_LABELS[key];
  }
  return key
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function CriterionScoresList({ scores }: { scores: Record<string, number> }) {
  const orderedKeys = [
    ...PREFERRED_ORDER.filter((key) => key in scores),
    ...Object.keys(scores).filter((key) => !PREFERRED_ORDER.includes(key)),
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
      {orderedKeys.map((key) => {
        const value = Number(scores[key] ?? 0);
        const pct = Math.max(0, Math.min(100, (value / 10) * 100));
        return (
          <div key={key} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="text-slate-600 truncate">{formatCriterionLabel(key)}</span>
              <span className="font-mono font-semibold text-slate-900 tabular-nums shrink-0">
                {value}/10
              </span>
            </div>
            <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-slate-800 rounded-full transition-all duration-200"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function getBandTextColor(band: string | null | undefined): string {
  switch (band) {
    case 'Excellent':
      return 'text-emerald-700';
    case 'Good':
      return 'text-blue-700';
    case 'Satisfactory':
      return 'text-amber-700';
    case 'Needs Improvement':
      return 'text-rose-700';
    default:
      return 'text-slate-600';
  }
}
