import React, { useEffect, useState } from 'react';
import { ValidationSample, BenchmarkRunResult } from '../types';
import { api } from '../lib/api';
import {
  FlaskConical,
  Play,
  CheckCircle2,
  Award,
  Sparkles,
  AlertTriangle,
} from 'lucide-react';

export const ValidationBenchmarkPanel: React.FC = () => {
  const [samples, setSamples] = useState<ValidationSample[]>([]);
  const [loadingSamples, setLoadingSamples] = useState(true);
  const [running, setRunning] = useState(false);
  const [benchmark, setBenchmark] = useState<BenchmarkRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await api.getValidationSamples();
        setSamples(res.samples || []);
      } catch (err: any) {
        setError(err.message || 'Failed to load annotated evaluation samples');
      } finally {
        setLoadingSamples(false);
      }
    }
    load();
  }, []);

  const handleRunBenchmark = async () => {
    setRunning(true);
    setError(null);
    try {
      const result = await api.runValidationBenchmark();
      setBenchmark(result);
    } catch (err: any) {
      setError(err.message || 'Benchmark execution failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center space-x-2">
            <FlaskConical className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            <span>Semester 7 Empirical Validation & Fusion Benchmark</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Evaluates Question Generator schema validity and compares Content-Only, Delivery-Only, Feature-Level (Early), and Decision-Level (Late) Fusion against human-annotated scores.
          </p>
        </div>

        <button
          type="button"
          onClick={handleRunBenchmark}
          disabled={running || loadingSamples}
          className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center space-x-2 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0 self-start md:self-auto"
        >
          {running ? (
            <>
              <Sparkles className="w-4 h-4 animate-spin" />
              <span>Evaluating Annotated Dataset...</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              <span>Run Semester 7 Evaluation Benchmark</span>
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-500/30 text-xs text-rose-600 dark:text-rose-300 flex items-center space-x-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Benchmark Results Section */}
      {benchmark && (
        <div className="space-y-6 animate-fade-in">
          {/* Top Metrics Callout Row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-1">
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                Question Generator Schema Validity
              </span>
              <p className="text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                {benchmark.questionGeneratorValidityPct === null ? 'No data' : `${benchmark.questionGeneratorValidityPct.toFixed(1)}%`}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {benchmark.questionGeneratorAvgLatencyMs === null
                  ? 'No saved interview generations yet'
                  : `Mean Generation Latency: ${benchmark.questionGeneratorAvgLatencyMs} ms · ${benchmark.questionGeneratorSampleCount} runs`}
              </p>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-1">
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                Annotated Samples Benchmarked
              </span>
              <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                {benchmark.sampleCount}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Strong · Average · Weak · Off-Topic tiers
              </p>
            </div>

            <div className="bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-500/30 rounded-2xl p-4 space-y-1">
              <div className="flex items-center space-x-1.5 text-xs text-indigo-600 dark:text-indigo-400 font-semibold">
                <Award className="w-4 h-4" />
                <span>Recommended Fusion Strategy</span>
              </div>
              <p className="text-base font-bold text-slate-900 dark:text-white">
                {benchmark.recommendedStrategy}
              </p>
              <p className="text-[11px] text-slate-600 dark:text-slate-300">
                Highest agreement with human annotations & lowest MAE
              </p>
            </div>
          </div>

          {/* 4-Way Strategy Comparison Table */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Agreement with Human Evaluators Across 4 Scoring Pipelines
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Pearson correlation (r), Spearman rank correlation (ρ), Mean Absolute Error (MAE on 0–10 scale), Band Accuracy %, and Latency
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 pr-4 font-semibold">Scoring Strategy</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Pearson r</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Spearman ρ</th>
                    <th className="py-2.5 px-3 font-semibold text-right">MAE (/10)</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Band Accuracy</th>
                    <th className="py-2.5 pl-3 font-semibold text-right">Avg Latency</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {benchmark.strategies.map((row) => {
                    const isBest = row.strategy === benchmark.recommendedStrategy;
                    return (
                      <tr
                        key={row.strategy}
                        className={
                          isBest
                            ? 'bg-indigo-50/60 dark:bg-indigo-950/20 font-semibold'
                            : ''
                        }
                      >
                        <td className="py-3 pr-4 text-slate-900 dark:text-white flex items-center space-x-2">
                          <span>{row.strategy}</span>
                          {isBest && (
                            <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                          {row.pearsonR.toFixed(3)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                          {row.spearmanRho.toFixed(3)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                          {row.mae.toFixed(3)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-emerald-600 dark:text-emerald-400 font-bold">
                          {row.bandAccuracyPct.toFixed(1)}%
                        </td>
                        <td className="py-3 pl-3 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          {row.avgLatencyMs} ms
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Early-fusion rubric weights calibrated with leave-one-out validation and used for new answers: correctness {(benchmark.tunedEarlyFusionWeights.technicalCorrectness * 100).toFixed(0)}%, relevance {(benchmark.tunedEarlyFusionWeights.relevance * 100).toFixed(0)}%, completeness {(benchmark.tunedEarlyFusionWeights.completeness * 100).toFixed(0)}%, clarity {(benchmark.tunedEarlyFusionWeights.clarity * 100).toFixed(0)}%, communication {(benchmark.tunedEarlyFusionWeights.communication * 100).toFixed(0)}%.
            </p>
          </div>

          {/* Per-Sample Prediction Audit */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Per-Sample Validation Audit (Human vs. Automated Pipelines)
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                    <th className="py-2 pr-3 font-semibold">Sample</th>
                    <th className="py-2 px-2 font-semibold">Tier</th>
                    <th className="py-2 px-2 font-semibold text-right">Human</th>
                    <th className="py-2 px-2 font-semibold text-right">Content</th>
                    <th className="py-2 px-2 font-semibold text-right">Delivery</th>
                    <th className="py-2 px-2 font-semibold text-right">Early Fusion</th>
                    <th className="py-2 px-2 font-semibold text-right">Late Fusion</th>
                    <th className="py-2 pl-2 font-semibold">Predicted Band</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {benchmark.samplePredictions.map((sp) => (
                    <tr key={sp.sampleId}>
                      <td className="py-2.5 pr-3 font-mono text-indigo-600 dark:text-indigo-400">
                        {sp.sampleId}
                      </td>
                      <td className="py-2.5 px-2 text-slate-700 dark:text-slate-300">
                        {sp.qualityTier}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tabular-nums font-bold text-slate-900 dark:text-white">
                        {sp.humanScore.toFixed(1)}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                        {sp.contentOnlyScore.toFixed(1)}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                        {sp.deliveryOnlyScore.toFixed(1)}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        {sp.earlyFusionScore.toFixed(1)}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tabular-nums font-bold text-indigo-600 dark:text-indigo-400">
                        {sp.lateFusionScore.toFixed(1)}
                      </td>
                      <td className="py-2.5 pl-2 text-slate-700 dark:text-slate-300">
                        {sp.predictedBand}
                        {sp.isOffTopicFlagged && (
                          <span className="ml-1.5 text-rose-600 dark:text-rose-400 font-semibold">
                            (Off-Topic Flag)
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Human-Annotated Evaluation Dataset Preview */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Annotated Evaluation Corpus ({samples.length} Curated Samples)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Ground-truth answers spanning Strong, Average, Weak, and Off-Topic responses across technical & behavioural prompts
            </p>
          </div>
        </div>

        {loadingSamples ? (
          <p className="text-xs text-slate-500 py-6 text-center">Loading annotated evaluation set...</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {samples.map((s) => (
              <div
                key={s.id}
                className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2"
              >
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                    {s.id} · {s.subject}
                  </span>
                  <span className="font-mono tabular-nums font-bold text-slate-800 dark:text-slate-200">
                    Human: {s.humanScoreOutOf10.toFixed(1)}/10 ({s.qualityTier})
                  </span>
                </div>
                <p className="text-xs font-bold text-slate-900 dark:text-white leading-snug">
                  {s.question}
                </p>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 italic leading-relaxed">
                  "{s.candidateAnswer}"
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
