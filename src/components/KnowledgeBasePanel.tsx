import React, { useEffect, useState } from 'react';
import {
  KnowledgeChunk,
  TECH_FIELDS,
  DifficultyLevel,
} from '../types';
import { api } from '../lib/api';
import {
  Database,
  Search,
  Plus,
  RefreshCw,
  CheckCircle2,
  Sparkles,
  BookOpen,
  X,
} from 'lucide-react';

export const KnowledgeBasePanel: React.FC = () => {
  const [chunks, setChunks] = useState<KnowledgeChunk[]>([]);
  const [loading, setLoading] = useState(true);
  const [subjectFilter, setSubjectFilter] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [textQuery, setTextQuery] = useState('');

  // Vector Search tester
  const [semanticQuery, setSemanticQuery] = useState('');
  const [semanticResults, setSemanticResults] = useState<KnowledgeChunk[] | null>(null);
  const [searchingVector, setSearchingVector] = useState(false);

  // Reindex state
  const [reindexing, setReindexing] = useState(false);
  const [reindexStatus, setReindexStatus] = useState<string | null>(null);

  // Content Curator Add Form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newSubject, setNewSubject] = useState(TECH_FIELDS[0].id);
  const [newType, setNewType] = useState<'technical' | 'behavioural'>('technical');
  const [newDifficulty, setNewDifficulty] = useState<DifficultyLevel>('intermediate');
  const [newQuestion, setNewQuestion] = useState('');
  const [newReferenceAnswer, setNewReferenceAnswer] = useState('');
  const [newConcepts, setNewConcepts] = useState('');
  const [newRubricFocus, setNewRubricFocus] = useState('');
  const [addingChunk, setAddingChunk] = useState(false);
  const [formMessage, setFormMessage] = useState<string | null>(null);

  const loadChunks = async () => {
    setLoading(true);
    try {
      const res = await api.getKnowledgeChunks({
        subject: subjectFilter !== 'ALL' ? subjectFilter : undefined,
        interviewType: typeFilter !== 'ALL' ? typeFilter : undefined,
        q: textQuery.trim() || undefined,
      });
      setChunks(res.chunks || []);
    } catch (err) {
      console.error('Failed to fetch D1 chunks:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadChunks();
  }, [subjectFilter, typeFilter]);

  const handleVectorSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!semanticQuery.trim()) {
      setSemanticResults(null);
      return;
    }
    setSearchingVector(true);
    try {
      const res = await api.searchKnowledgeBase({
        query: semanticQuery.trim(),
        subject: subjectFilter !== 'ALL' ? subjectFilter : undefined,
        interviewType: typeFilter !== 'ALL' ? (typeFilter as 'technical' | 'behavioural') : undefined,
        topK: 4,
      });
      setSemanticResults(res.results || []);
    } catch (err) {
      console.error('Semantic search error:', err);
    } finally {
      setSearchingVector(false);
    }
  };

  const handleReindex = async () => {
    setReindexing(true);
    setReindexStatus(null);
    try {
      const res = await api.reindexKnowledgeBase();
      setReindexStatus(
        `Indexed ${res.total} chunks (${res.geminiEmbedded} Gemini vector embeddings, rest normalized projection).`
      );
      await loadChunks();
    } catch (err: any) {
      setReindexStatus(err.message || 'Re-indexing error');
    } finally {
      setReindexing(false);
    }
  };

  const handleCreateChunk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newQuestion.trim() || !newReferenceAnswer.trim()) return;
    setAddingChunk(true);
    setFormMessage(null);

    try {
      await api.addKnowledgeChunk({
        subject: newSubject,
        interviewType: newType,
        difficulty: newDifficulty,
        question: newQuestion.trim(),
        referenceAnswer: newReferenceAnswer.trim(),
        expectedConcepts: newConcepts
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean),
        rubricFocus: newRubricFocus.trim() || 'Technical accuracy and conceptual clarity',
      });

      setNewQuestion('');
      setNewReferenceAnswer('');
      setNewConcepts('');
      setNewRubricFocus('');
      setShowAddForm(false);
      setFormMessage('Curated Q&A chunk embedded and stored in D1 Knowledge Base.');
      await loadChunks();
    } catch (err: any) {
      setFormMessage(err.message || 'Failed to add chunk');
    } finally {
      setAddingChunk(false);
    }
  };

  const displayedChunks = semanticResults !== null ? semanticResults : chunks;

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center space-x-2">
            <Database className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            <span>Curated Question & Reference Knowledge Base (D1)</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Process 1.0 · Content Curator repository of cleaned Q&A chunks with cosine vector embeddings for RAG retrieval
          </p>
        </div>

        <div className="flex items-center flex-wrap gap-2">
          <button
            type="button"
            onClick={handleReindex}
            disabled={reindexing}
            className="px-3.5 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-indigo-400 text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 ${reindexing ? 'animate-spin' : ''}`} />
            <span>{reindexing ? 'Re-Indexing...' : 'Re-Index Embeddings'}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowAddForm(!showAddForm)}
            className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center space-x-1.5 cursor-pointer"
          >
            {showAddForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            <span>{showAddForm ? 'Close Curator Form' : 'Add Curated Chunk'}</span>
          </button>
        </div>
      </div>

      {reindexStatus && (
        <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-500/30 text-xs text-emerald-700 dark:text-emerald-300 flex items-center space-x-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{reindexStatus}</span>
        </div>
      )}

      {formMessage && (
        <div className="p-3 rounded-xl bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-500/30 text-xs text-indigo-700 dark:text-indigo-300 flex items-center space-x-2">
          <Sparkles className="w-4 h-4 shrink-0" />
          <span>{formMessage}</span>
        </div>
      )}

      {/* Content Curator Add Chunk Drawer */}
      {showAddForm && (
        <form
          onSubmit={handleCreateChunk}
          className="bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-500/30 rounded-2xl p-6 space-y-4 animate-fade-in"
        >
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Content Curator · Ingest & Embed New Q&A Chunk into D1
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                Placement Subject
              </label>
              <select
                value={newSubject}
                onChange={(e) => setNewSubject(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white outline-none"
              >
                {TECH_FIELDS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                Interview Type
              </label>
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value as 'technical' | 'behavioural')}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white outline-none"
              >
                <option value="technical">Technical</option>
                <option value="behavioural">Behavioural (STAR)</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                Difficulty Tier
              </label>
              <select
                value={newDifficulty}
                onChange={(e) => setNewDifficulty(e.target.value as DifficultyLevel)}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white outline-none"
              >
                <option value="junior">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="senior">Advanced</option>
                <option value="lead">Research Tier</option>
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400">
              Interview Question
            </label>
            <input
              type="text"
              required
              value={newQuestion}
              onChange={(e) => setNewQuestion(e.target.value)}
              placeholder="e.g. Explain how B+ Trees differ from standard Binary Search Trees in database indexing."
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-900 dark:text-white outline-none focus:border-indigo-500"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400">
              Ground-Truth Reference Answer
            </label>
            <textarea
              required
              rows={3}
              value={newReferenceAnswer}
              onChange={(e) => setNewReferenceAnswer(e.target.value)}
              placeholder="Provide the comprehensive reference answer used for RAG retrieval and semantic similarity scoring..."
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-900 dark:text-white outline-none focus:border-indigo-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                Expected Concepts (comma-separated)
              </label>
              <input
                type="text"
                value={newConcepts}
                onChange={(e) => setNewConcepts(e.target.value)}
                placeholder="e.g. high fanout, leaf linked list, range queries, disk blocks"
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-900 dark:text-white outline-none"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                Rubric Focus Note
              </label>
              <input
                type="text"
                value={newRubricFocus}
                onChange={(e) => setNewRubricFocus(e.target.value)}
                placeholder="e.g. Disk I/O minimization and sequential leaf scans"
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-900 dark:text-white outline-none"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={addingChunk}
              className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
            >
              {addingChunk ? 'Embedding & Storing...' : 'Save & Embed into D1'}
            </button>
          </div>
        </form>
      )}

      {/* Search & Filter Toolbar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-4">
            <select
              value={subjectFilter}
              onChange={(e) => {
                setSubjectFilter(e.target.value);
                setSemanticResults(null);
              }}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-200 outline-none cursor-pointer"
            >
              <option value="ALL">All Placement Subjects</option>
              {TECH_FIELDS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.title}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-3">
            <select
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value);
                setSemanticResults(null);
              }}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-200 outline-none cursor-pointer"
            >
              <option value="ALL">All Interview Types</option>
              <option value="technical">Technical Only</option>
              <option value="behavioural">Behavioural (STAR)</option>
            </select>
          </div>

          <div className="md:col-span-5 flex space-x-2">
            <input
              type="text"
              value={textQuery}
              onChange={(e) => setTextQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadChunks()}
              placeholder="Filter chunks by keyword..."
              className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white outline-none"
            />
            <button
              type="button"
              onClick={loadChunks}
              className="px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
            >
              Filter
            </button>
          </div>
        </div>

        {/* Cosine Similarity RAG Retrieval Tester */}
        <form
          onSubmit={handleVectorSearch}
          className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row gap-2"
        >
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-indigo-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={semanticQuery}
              onChange={(e) => setSemanticQuery(e.target.value)}
              placeholder="Test Semantic Cosine Similarity Retrieval (e.g. 'how does deadlock prevention work' or 'conflict resolution STAR')..."
              className="w-full bg-indigo-50/40 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-500/30 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-900 dark:text-white outline-none focus:border-indigo-500"
            />
          </div>
          <div className="flex items-center space-x-2">
            <button
              type="submit"
              disabled={searchingVector}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
            >
              {searchingVector ? 'Searching Vectors...' : 'Test Vector Retrieval (Top-4)'}
            </button>
            {semanticResults !== null && (
              <button
                type="button"
                onClick={() => {
                  setSemanticResults(null);
                  setSemanticQuery('');
                }}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300 cursor-pointer"
              >
                Reset
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Results Header */}
      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 px-1">
        <span>
          {semanticResults !== null
            ? `Showing Top-${semanticResults.length} cosine similarity matches from D1`
            : `Showing ${displayedChunks.length} indexed chunks in D1`}
        </span>
        <span className="font-mono">Process 1.0 · Embedding Index Active</span>
      </div>

      {/* Chunk Cards */}
      {loading ? (
        <div className="min-h-[240px] flex items-center justify-center text-xs text-slate-500">
          Loading D1 knowledge chunks...
        </div>
      ) : displayedChunks.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 text-center text-xs text-slate-500 dark:text-slate-400">
          No knowledge chunks match the current filters.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {displayedChunks.map((chunk) => (
            <div
              key={chunk.id}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-3 flex flex-col justify-between"
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <div className="flex items-center space-x-1.5 text-indigo-600 dark:text-indigo-400 font-semibold truncate">
                    <span className="font-mono">{chunk.id}</span>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">{chunk.subject}</span>
                  </div>
                  <div className="flex items-center space-x-2 shrink-0 text-slate-500 dark:text-slate-400 font-mono">
                    <span className="capitalize">{chunk.interviewType}</span>
                    <span>·</span>
                    <span className="capitalize">{chunk.difficulty}</span>
                  </div>
                </div>

                <h4 className="text-sm font-bold text-slate-900 dark:text-white leading-snug">
                  {chunk.question}
                </h4>

                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block mb-1">
                    Reference Answer
                  </span>
                  {chunk.referenceAnswer}
                </div>
              </div>

              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                <span className="truncate max-w-[70%]">
                  <BookOpen className="w-3 h-3 inline mr-1 text-indigo-500" />
                  Concepts: {chunk.expectedConcepts.join(' · ')}
                </span>
                <span className="font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                  {chunk.similarityScore !== undefined
                    ? `cos=${chunk.similarityScore.toFixed(3)}`
                    : `${chunk.embeddingDimensions || 64}d vec`}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
