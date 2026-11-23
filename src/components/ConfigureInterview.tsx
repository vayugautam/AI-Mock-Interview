import React, { useState, useEffect, useRef } from 'react';
import {
  User,
  StoredDocument,
  JobDescriptionAnalysis,
  ResumeAnalysis,
  InterviewQuestion,
  DifficultyLevel,
  InterviewType,
  WebResearchSource,
} from '../types';
import { api } from '../lib/api';
import {
  FileText,
  Upload,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  RefreshCw,
  ExternalLink,
  Sliders,
  Sparkles,
  FileCheck2,
  ClipboardList,
} from 'lucide-react';

export interface GeneratedSessionPayload {
  interviewId: string;
  techField: string;
  jdTitle: string;
  companyName: string;
  resumeFileName?: string;
  jdMissingSkills: string[];
  webSources: WebResearchSource[];
  interviewType: 'technical' | 'behavioral' | 'mixed';
  difficulty: 'easy' | 'medium' | 'hard';
  questionCount: 5 | 10 | 15 | 20;
  questionGenerationSource?: 'gemini' | 'groq' | 'curated_fallback';
  questionPromptVersion?: string;
  questions: InterviewQuestion[];
}

interface ConfigureInterviewProps {
  user: User;
  onSessionGenerated: (session: GeneratedSessionPayload, updatedUser: User) => void;
}

const QUESTION_COUNTS: Array<5 | 10 | 15 | 20> = [5, 10, 15, 20];
const MAX_PDF_BYTES = 5 * 1024 * 1024;

export const ConfigureInterview: React.FC<ConfigureInterviewProps> = ({
  user,
  onSessionGenerated,
}) => {
  // Persisted JD & Resume Documents
  const [jdDoc, setJdDoc] = useState<StoredDocument | null>(null);
  const [resumeDoc, setResumeDoc] = useState<StoredDocument | null>(null);
  const [loadingSavedDocs, setLoadingSavedDocs] = useState(true);

  // JD Input State
  const [jdInputMode, setJdInputMode] = useState<'pdf' | 'text'>('pdf');
  const [jdPasteText, setJdPasteText] = useState('');
  const [jdLoading, setJdLoading] = useState(false);
  const [jdError, setJdError] = useState<string | null>(null);
  const [showJdPreview, setShowJdPreview] = useState(false);
  const [enableWebResearch, setEnableWebResearch] = useState(true);
  const jdFileInputRef = useRef<HTMLInputElement>(null);

  // Resume Input State
  const [resumeLoading, setResumeLoading] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [showResumePreview, setShowResumePreview] = useState(false);
  const resumeFileInputRef = useRef<HTMLInputElement>(null);

  // Interview Configuration
  const [questionCount, setQuestionCount] = useState<5 | 10 | 15 | 20>(10);
  const [interviewType, setInterviewType] = useState<'technical' | 'behavioral' | 'mixed'>('mixed');
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');

  // Generation Action
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  useEffect(() => {
    async function loadExisting() {
      try {
        const res = await api.getCurrentDocuments();
        if (res.jd) setJdDoc(res.jd);
        if (res.resume) setResumeDoc(res.resume);
      } catch (err) {
        console.warn('Could not load previously saved documents:', err);
      } finally {
        setLoadingSavedDocs(false);
      }
    }
    loadExisting();
  }, [user.id]);

  const validatePdfClient = (file: File, label: string): string | null => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      return `Invalid ${label} file format. Please upload a .pdf document.`;
    }
    if (file.size === 0) {
      return `The selected ${label} PDF file is empty.`;
    }
    if (file.size > MAX_PDF_BYTES) {
      return `${label} PDF exceeds the 5 MB limit (${(file.size / (1024 * 1024)).toFixed(2)} MB).`;
    }
    return null;
  };

  const handleJdPdfUpload = async (file: File) => {
    const clientErr = validatePdfClient(file, 'Job Description');
    if (clientErr) {
      setJdError(clientErr);
      return;
    }

    setJdError(null);
    setJdLoading(true);
    try {
      const res = await api.uploadJdPdf(file, enableWebResearch);
      setJdDoc(res.document);
    } catch (err: any) {
      setJdError(err.message || 'Failed to extract and analyze Job Description PDF.');
    } finally {
      setJdLoading(false);
      if (jdFileInputRef.current) jdFileInputRef.current.value = '';
    }
  };

  const handleJdTextSubmit = async () => {
    if (jdPasteText.trim().length < 40) {
      setJdError('Please paste a complete Job Description (at least 40 characters).');
      return;
    }
    setJdError(null);
    setJdLoading(true);
    try {
      const res = await api.submitJdText(jdPasteText.trim(), enableWebResearch);
      setJdDoc(res.document);
    } catch (err: any) {
      setJdError(err.message || 'Failed to analyze pasted Job Description.');
    } finally {
      setJdLoading(false);
    }
  };

  const handleResumePdfUpload = async (file: File) => {
    const clientErr = validatePdfClient(file, 'Resume');
    if (clientErr) {
      setResumeError(clientErr);
      return;
    }

    setResumeError(null);
    setResumeLoading(true);
    try {
      const res = await api.uploadResumePdf(file);
      setResumeDoc(res.document);
    } catch (err: any) {
      setResumeError(err.message || 'Failed to extract and analyze Resume PDF.');
    } finally {
      setResumeLoading(false);
      if (resumeFileInputRef.current) resumeFileInputRef.current.value = '';
    }
  };

  const handleGenerateInterview = async () => {
    if (!jdDoc || !resumeDoc || generating) return;
    setGenerateError(null);
    setGenerating(true);

    try {
      const res = await api.generateQuestions({
        jdId: jdDoc.id,
        resumeId: resumeDoc.id,
        questionCount,
        interviewType,
        difficulty,
      });

      const updatedUser: User = {
        ...user,
        targetField: res.jdTitle,
        difficulty: difficulty as DifficultyLevel,
        interviewType: interviewType as InterviewType,
        activeJdId: jdDoc.id,
        activeResumeId: resumeDoc.id,
      };

      onSessionGenerated(
        {
          interviewId: res.interviewId,
          techField: res.techField,
          jdTitle: res.jdTitle,
          companyName: res.companyName,
          resumeFileName: res.resumeFileName,
          jdMissingSkills: res.jdMissingSkills || [],
          webSources: res.webSources || [],
          interviewType,
          difficulty,
          questionCount,
          questionGenerationSource: res.questionGenerationSource,
          questionPromptVersion: res.questionPromptVersion,
          questions: res.questions,
        },
        updatedUser
      );
    } catch (err: any) {
      setGenerateError(
        err.message || 'Could not generate personalized interview questions. Please verify inputs and try again.'
      );
    } finally {
      setGenerating(false);
    }
  };

  const jdAnalysis = jdDoc?.analysis as JobDescriptionAnalysis | undefined;
  const resumeAnalysis = resumeDoc?.analysis as ResumeAnalysis | undefined;
  const isReadyToGenerate = Boolean(jdDoc && resumeDoc && !jdLoading && !resumeLoading);

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in pb-14">
      {/* Header */}
      <div className="space-y-1.5">
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white tracking-tight text-balance">
          JD-Driven & Resume-Aware Interview Setup
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 max-w-3xl leading-relaxed">
          Provide the target Job Description and upload your Resume PDF. Our RAG pipeline analyzes role requirements, verifies your project stack, identifies skill gaps, and builds a calibrated mock interview.
        </p>
      </div>

      {loadingSavedDocs && (
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
          Checking your previously uploaded Job Description and Resume...
        </div>
      )}

      {/* SECTION A: JOB DESCRIPTION */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-5 transition-colors">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
          <div className="space-y-0.5">
            <div className="flex items-center space-x-2 text-xs">
              <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">Section A</span>
              <span className="text-slate-400">·</span>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Job Description Input
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Upload a JD PDF or paste the complete job posting text
            </p>
          </div>

          {/* Input Mode Switcher */}
          <div className="inline-flex items-center p-1 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 self-start sm:self-auto">
            <button
              type="button"
              onClick={() => {
                setJdInputMode('pdf');
                setJdError(null);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                jdInputMode === 'pdf'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Upload JD PDF
            </button>
            <button
              type="button"
              onClick={() => {
                setJdInputMode('text');
                setJdError(null);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                jdInputMode === 'text'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Paste JD Text
            </button>
          </div>
        </div>

        {/* Optional Bounded Web Context Checkbox */}
        <label className="flex items-center space-x-2.5 text-xs text-slate-600 dark:text-slate-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={enableWebResearch}
            onChange={(e) => setEnableWebResearch(e.target.checked)}
            className="rounded border-slate-300 dark:border-slate-700 text-indigo-600 focus:ring-indigo-500"
          />
          <span>
            Enable optional bounded web research when a specific company or technology requires verified context
          </span>
        </label>

        {jdInputMode === 'pdf' ? (
          <div className="space-y-3">
            <input
              ref={jdFileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleJdPdfUpload(file);
              }}
            />
            <div
              onClick={() => !jdLoading && jdFileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-indigo-500 dark:hover:border-indigo-500 rounded-xl p-6 text-center cursor-pointer transition-colors bg-slate-50/70 dark:bg-slate-950/60 space-y-2"
            >
              {jdLoading ? (
                <div className="flex flex-col items-center space-y-2">
                  <RefreshCw className="w-6 h-6 text-indigo-600 dark:text-indigo-400 animate-spin" />
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Extracting PDF text, indexing RAG chunks & analyzing JD requirements...
                  </p>
                </div>
              ) : (
                <>
                  <Upload className="w-6 h-6 text-indigo-600 dark:text-indigo-400 mx-auto" />
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {jdDoc && jdDoc.sourceType === 'pdf'
                      ? 'Upload a different Job Description PDF'
                      : 'Click to select Job Description PDF'}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    PDF format only · Maximum 5 MB · Text-selectable PDF
                  </p>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <textarea
              rows={6}
              value={jdPasteText}
              onChange={(e) => setJdPasteText(e.target.value)}
              placeholder="Paste the complete Job Description here (title, responsibilities, required skills, tools, and qualifications)..."
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl p-3.5 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-600 outline-none leading-relaxed"
            />
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                {jdPasteText.trim().length} characters pasted
              </span>
              <button
                type="button"
                onClick={handleJdTextSubmit}
                disabled={jdLoading || jdPasteText.trim().length < 40}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer flex items-center space-x-1.5"
              >
                {jdLoading ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Analyzing JD...</span>
                  </>
                ) : (
                  <>
                    <ClipboardList className="w-3.5 h-3.5" />
                    <span>Analyze Job Description</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {jdError && (
          <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-500/30 text-xs text-red-700 dark:text-red-300 flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{jdError}</span>
          </div>
        )}

        {/* Active JD Status & Structured Extraction Summary */}
        {jdDoc && jdAnalysis && (
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center space-x-2 text-xs">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span className="font-bold text-slate-900 dark:text-white">
                  {jdAnalysis.jobTitle !== 'Unknown' ? jdAnalysis.jobTitle : 'Job Description Ready'}
                </span>
                <span className="text-slate-400">·</span>
                <span className="text-slate-600 dark:text-slate-300">
                  {jdDoc.sourceType === 'pdf' ? jdDoc.fileName : 'Pasted JD Text'}
                </span>
                <span className="text-slate-400">·</span>
                <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  {jdDoc.charCount} chars · {jdDoc.chunkCount} RAG chunks
                </span>
              </div>

              <button
                type="button"
                onClick={() => setShowJdPreview(!showJdPreview)}
                className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer self-start sm:self-auto"
              >
                {showJdPreview ? 'Hide Extracted Text' : 'Preview Extracted JD'}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs pt-2 border-t border-slate-200 dark:border-slate-800">
              <div>
                <span className="font-semibold text-slate-500 dark:text-slate-400 block mb-0.5">
                  Company & Required Experience
                </span>
                <p className="text-slate-800 dark:text-slate-200">
                  {jdAnalysis.companyName} · {jdAnalysis.requiredExperience}
                </p>
              </div>
              <div>
                <span className="font-semibold text-slate-500 dark:text-slate-400 block mb-0.5">
                  Required Technical Skills & Tools
                </span>
                <p className="text-slate-800 dark:text-slate-200">
                  {[...jdAnalysis.requiredTechnicalSkills, ...jdAnalysis.toolsAndTechnologies]
                    .slice(0, 10)
                    .join(' · ') || 'None explicitly listed'}
                </p>
              </div>
            </div>

            {jdDoc.webSources && jdDoc.webSources.length > 0 && (
              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 text-[11px] space-y-1">
                <span className="font-semibold text-indigo-600 dark:text-indigo-400 block">
                  Recent Interview Research Sources ({jdDoc.webSources.length})
                </span>
                <div className="flex flex-wrap gap-3">
                  {jdDoc.webSources.map((src, i) => (
                    <a
                      key={i}
                      href={src.uri}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center space-x-1 text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 underline"
                    >
                      <span className="truncate max-w-[220px]">{src.title}{src.publishedAt ? ` · ${src.publishedAt.slice(0, 10)}` : ''}</span>
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  ))}
                </div>
              </div>
            )}

            {showJdPreview && (
              <div className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 max-h-48 overflow-y-auto whitespace-pre-wrap font-mono">
                {jdDoc.previewText}
              </div>
            )}
          </div>
        )}
      </section>

      {/* SECTION B: RESUME UPLOAD */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-5 transition-colors">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
          <div className="space-y-0.5">
            <div className="flex items-center space-x-2 text-xs">
              <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">Section B</span>
              <span className="text-slate-400">·</span>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Candidate Resume PDF
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Upload your PDF resume so interview questions ground in your actual projects and skills
            </p>
          </div>

          {resumeDoc && (
            <button
              type="button"
              onClick={() => !resumeLoading && resumeFileInputRef.current?.click()}
              disabled={resumeLoading}
              className="px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-indigo-400 text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center space-x-1.5 cursor-pointer self-start sm:self-auto"
            >
              <RefreshCw className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>Replace Resume</span>
            </button>
          )}
        </div>

        <input
          ref={resumeFileInputRef}
          type="file"
          accept=".pdf,application/pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleResumePdfUpload(file);
          }}
        />

        {(!resumeDoc || resumeLoading) && (
          <div
            onClick={() => !resumeLoading && resumeFileInputRef.current?.click()}
            className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-indigo-500 dark:hover:border-indigo-500 rounded-xl p-6 text-center cursor-pointer transition-colors bg-slate-50/70 dark:bg-slate-950/60 space-y-2"
          >
            {resumeLoading ? (
              <div className="flex flex-col items-center space-y-2">
                <RefreshCw className="w-6 h-6 text-indigo-600 dark:text-indigo-400 animate-spin" />
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Parsing Resume PDF, extracting structured projects/experience & indexing chunks...
                </p>
              </div>
            ) : (
              <>
                <FileText className="w-6 h-6 text-indigo-600 dark:text-indigo-400 mx-auto" />
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  Click to upload your Resume PDF
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  PDF format only · Maximum 5 MB · Stored privately under your account
                </p>
              </>
            )}
          </div>
        )}

        {resumeError && (
          <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-500/30 text-xs text-red-700 dark:text-red-300 flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{resumeError}</span>
          </div>
        )}

        {resumeDoc && resumeAnalysis && !resumeLoading && (
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center space-x-2 text-xs">
                <FileCheck2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span className="font-bold text-slate-900 dark:text-white">
                  {resumeDoc.fileName || 'Resume.pdf'}
                </span>
                <span className="text-slate-400">·</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Verified</span>
                <span className="text-slate-400">·</span>
                <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  {resumeDoc.pageCount || 1} page{(resumeDoc.pageCount || 1) > 1 ? 's' : ''} · {resumeDoc.charCount} chars · {resumeDoc.chunkCount} chunks
                </span>
              </div>

              <button
                type="button"
                onClick={() => setShowResumePreview(!showResumePreview)}
                className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer self-start sm:self-auto"
              >
                {showResumePreview ? 'Hide Extracted Text' : 'Preview Extracted Resume'}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs pt-2 border-t border-slate-200 dark:border-slate-800">
              <div>
                <span className="font-semibold text-slate-500 dark:text-slate-400 block mb-0.5">
                  Extracted Candidate Skills
                </span>
                <p className="text-slate-800 dark:text-slate-200">
                  {[...resumeAnalysis.candidateSkills, ...resumeAnalysis.technologiesUsed]
                    .slice(0, 12)
                    .join(' · ') || 'None detected'}
                </p>
              </div>
              <div>
                <span className="font-semibold text-slate-500 dark:text-slate-400 block mb-0.5">
                  Work Experience & Projects Detected
                </span>
                <p className="text-slate-800 dark:text-slate-200">
                  {resumeAnalysis.workExperience.length} work role(s) · {resumeAnalysis.projects.length} project(s) · {resumeAnalysis.education.length} education entry(s)
                </p>
              </div>
            </div>

            {showResumePreview && (
              <div className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 max-h-48 overflow-y-auto whitespace-pre-wrap font-mono">
                {resumeDoc.previewText}
              </div>
            )}
          </div>
        )}
      </section>

      {/* SECTION C: INTERVIEW CONFIGURATION */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-6 transition-colors">
        <div className="space-y-0.5 border-b border-slate-200 dark:border-slate-800 pb-4">
          <div className="flex items-center space-x-2 text-xs">
            <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">Section C</span>
            <span className="text-slate-400">·</span>
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center space-x-1.5">
              <span>Interview Configuration</span>
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Choose exact question count, interview focus, and difficulty tier
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Number of Questions */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Number of Questions
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {QUESTION_COUNTS.map((cnt) => (
                <button
                  key={cnt}
                  type="button"
                  onClick={() => setQuestionCount(cnt)}
                  className={`py-2.5 rounded-xl text-xs font-mono font-bold tabular-nums transition-colors cursor-pointer border ${
                    questionCount === cnt
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-indigo-400'
                  }`}
                >
                  {cnt}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Supported lengths: 5, 10, 15, or 20 questions.
            </p>
          </div>

          {/* Interview Type */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Interview Type
            </label>
            <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800">
              {(['technical', 'behavioral', 'mixed'] as const).map((typeOpt) => (
                <button
                  key={typeOpt}
                  type="button"
                  onClick={() => setInterviewType(typeOpt)}
                  className={`py-2 px-2 rounded-lg text-xs font-semibold capitalize transition-colors cursor-pointer ${
                    interviewType === typeOpt
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {typeOpt}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {interviewType === 'mixed'
                ? 'Combines JD technical depth & STAR behavioral questions.'
                : interviewType === 'technical'
                ? 'Focuses exclusively on technical skills, tools & architecture.'
                : 'Focuses on STAR scenarios grounded in your projects.'}
            </p>
          </div>

          {/* Difficulty */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Difficulty Level
            </label>
            <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800">
              {(['easy', 'medium', 'hard'] as const).map((diffOpt) => (
                <button
                  key={diffOpt}
                  type="button"
                  onClick={() => setDifficulty(diffOpt)}
                  className={`py-2 px-2 rounded-lg text-xs font-semibold capitalize transition-colors cursor-pointer ${
                    difficulty === diffOpt
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {diffOpt}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Calibrates technical rigor and edge-case complexity.
            </p>
          </div>
        </div>

        {generateError && (
          <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-500/30 text-xs text-red-700 dark:text-red-300 flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{generateError}</span>
          </div>
        )}

        {/* Footer Readiness & Generate Interview CTA */}
        <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span
              className={`font-medium ${
                jdDoc ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'
              }`}
            >
              {jdDoc ? '✓ JD Analyzed' : '○ JD Required'}
            </span>
            <span className="text-slate-300 dark:text-slate-700">·</span>
            <span
              className={`font-medium ${
                resumeDoc ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'
              }`}
            >
              {resumeDoc ? '✓ Resume Analyzed' : '○ Resume PDF Required'}
            </span>
            <span className="text-slate-300 dark:text-slate-700">·</span>
            <span className="font-mono text-slate-600 dark:text-slate-300 tabular-nums flex items-center space-x-1">
              <Sliders className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>
                {questionCount} Questions · {interviewType} · {difficulty}
              </span>
            </span>
          </div>

          <button
            type="button"
            onClick={handleGenerateInterview}
            disabled={!isReadyToGenerate || generating}
            className="w-full sm:w-auto px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition-colors flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap shrink-0"
          >
            {generating ? (
              <>
                <Sparkles className="w-4 h-4 animate-spin" />
                <span>Generating {questionCount} Grounded Questions...</span>
              </>
            ) : (
              <>
                <span>Generate Interview</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </section>
    </div>
  );
};
