import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Mic, RotateCcw, Square } from 'lucide-react';
import {
  completeSession,
  generateNextQuestion,
  getApiErrorMessage,
  getApiErrorStatus,
  getSession,
  retryEvaluation,
  submitAnswer,
  type AnswerResponse,
  type InputMode,
  type Question,
  type Session,
} from '../api';
import { AppShell } from '../components/AppShell';
import { CriterionScoresList } from '../components/CriterionScoresList';

// Prevents React StrictMode double-effect from generating two questions on initial mount.
const inflightSessionInit = new Map<string, Promise<{ session: Session; question: Question | null }>>();

function formatTimer(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function InterviewPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  const [session, setSession] = useState<Session | null>(null);
  const [question, setQuestion] = useState<Question | null>(null);
  const [loadingPage, setLoadingPage] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  // Answer mode & input state
  const [inputMode, setInputMode] = useState<InputMode>('text');
  const [answerText, setAnswerText] = useState('');
  const questionStartRef = useRef<number>(Date.now());

  // Voice recording state
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const timerIntervalRef = useRef<number | null>(null);

  // Submission & evaluation state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [needsEvalRetry, setNeedsEvalRetry] = useState(false);
  const [submittedResponse, setSubmittedResponse] = useState<AnswerResponse | null>(null);
  const [advancing, setAdvancing] = useState(false);

  function stopMediaResources() {
    if (timerIntervalRef.current !== null) {
      window.clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // Ignore stop errors if recorder already closed.
      }
    }
    mediaRecorderRef.current = null;
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    setRecording(false);
  }

  function resetAnswerState() {
    stopMediaResources();
    setAnswerText('');
    setAudioBlob(null);
    setRecordSeconds(0);
    setMicError(null);
    setSubmitError(null);
    setNeedsEvalRetry(false);
    setSubmittedResponse(null);
    setAudioUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    questionStartRef.current = Date.now();
  }

  useEffect(() => {
    return () => {
      stopMediaResources();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  useEffect(() => {
    if (!sessionId) {
      setPageError('Missing interview session ID.');
      setLoadingPage(false);
      return;
    }

    let cancelled = false;
    setLoadingPage(true);
    setPageError(null);

    let initPromise = inflightSessionInit.get(sessionId);
    if (!initPromise) {
      initPromise = (async () => {
        const fetchedSession = await getSession(sessionId);
        if (fetchedSession.status === 'completed') {
          return { session: fetchedSession, question: null };
        }
        try {
          const nextQ = await generateNextQuestion(sessionId);
          return { session: fetchedSession, question: nextQ };
        } catch (err) {
          // If all questions were already generated (409), allow user to finish session
          if (getApiErrorStatus(err) === 409) {
            return { session: fetchedSession, question: null };
          }
          throw err;
        }
      })();
      inflightSessionInit.set(sessionId, initPromise);
      initPromise.finally(() => {
        window.setTimeout(() => inflightSessionInit.delete(sessionId), 500);
      });
    }

    initPromise
      .then(({ session: loadedSession, question: loadedQuestion }) => {
        if (cancelled) return;
        if (loadedSession.status === 'completed') {
          navigate(`/result/${loadedSession.id}`, { replace: true });
          return;
        }
        setSession(loadedSession);
        setQuestion(loadedQuestion);
        questionStartRef.current = Date.now();
      })
      .catch((err) => {
        if (!cancelled) {
          setPageError(getApiErrorMessage(err, 'Unable to load this interview session.'));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingPage(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, navigate]);

  async function startRecording() {
    setMicError(null);
    setSubmitError(null);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setMicError('Your browser does not support microphone recording. Switch to Text mode to continue.');
      return;
    }
    if (typeof MediaRecorder === 'undefined') {
      setMicError('MediaRecorder is unavailable in this browser. Switch to Text mode to continue.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : '';

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      audioChunksRef.current = [];
      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: mimeType || 'audio/webm' });
        setAudioBlob(blob);
        setAudioUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(blob);
        });
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((track) => track.stop());
          mediaStreamRef.current = null;
        }
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setAudioBlob(null);
      setAudioUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setRecordSeconds(0);
      setRecording(true);

      timerIntervalRef.current = window.setInterval(() => {
        setRecordSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      const domError = err as DOMException;
      if (domError?.name === 'NotAllowedError' || domError?.name === 'PermissionDeniedError') {
        setMicError(
          'Microphone permission was denied. Allow microphone access in your browser settings or switch to Text mode.'
        );
      } else if (domError?.name === 'NotFoundError') {
        setMicError('No microphone was detected on this device. Switch to Text mode to continue.');
      } else {
        setMicError('Could not start audio recording. Check your microphone or switch to Text mode.');
      }
      stopMediaResources();
    }
  }

  function stopRecording() {
    if (timerIntervalRef.current !== null) {
      window.clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
  }

  function handleReRecord() {
    stopMediaResources();
    setAudioBlob(null);
    setRecordSeconds(0);
    setMicError(null);
    setSubmitError(null);
    setAudioUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }

  async function handleSubmitAnswer(e: React.FormEvent) {
    e.preventDefault();
    if (!session || !question) return;

    setSubmitError(null);
    setNeedsEvalRetry(false);

    if (inputMode === 'text' && !answerText.trim()) {
      setSubmitError('Please write your answer before submitting.');
      return;
    }
    if (inputMode === 'voice' && !audioBlob) {
      setSubmitError('Please record an audio answer before submitting.');
      return;
    }

    const elapsedSec =
      inputMode === 'voice'
        ? Math.max(1, recordSeconds)
        : Math.max(1, Math.round((Date.now() - questionStartRef.current) / 1000));

    setSubmitting(true);
    try {
      const response = await submitAnswer(session.id, question.id, {
        input_mode: inputMode,
        text: inputMode === 'text' ? answerText.trim() : undefined,
        audio: inputMode === 'voice' && audioBlob ? audioBlob : undefined,
        filename: 'answer.webm',
        time_taken_sec: elapsedSec,
      });
      setSubmittedResponse(response);
    } catch (err) {
      const status = getApiErrorStatus(err);
      if (status === 502) {
        setNeedsEvalRetry(true);
        setSubmitError(
          'Your answer was saved, but the evaluation service failed (502). Click Retry evaluation to try again.'
        );
      } else {
        setSubmitError(getApiErrorMessage(err, 'Failed to submit your answer.'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRetryEvaluation() {
    if (!session || !question) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const response = await retryEvaluation(session.id, question.id);
      setNeedsEvalRetry(false);
      setSubmittedResponse(response);
    } catch (err) {
      const status = getApiErrorStatus(err);
      if (status === 502) {
        setNeedsEvalRetry(true);
        setSubmitError(
          'Evaluation failed again (502). Your answer is still saved—please retry in a moment.'
        );
      } else {
        setSubmitError(getApiErrorMessage(err, 'Retry failed.'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleNextQuestion() {
    if (!session) return;
    setAdvancing(true);
    setSubmitError(null);
    try {
      const nextQ = await generateNextQuestion(session.id);
      setQuestion(nextQ);
      resetAnswerState();
    } catch (err) {
      setSubmitError(getApiErrorMessage(err, 'Could not load the next question.'));
    } finally {
      setAdvancing(false);
    }
  }

  async function handleFinishInterview() {
    if (!session) return;
    setAdvancing(true);
    setSubmitError(null);
    try {
      await completeSession(session.id);
      navigate(`/result/${session.id}`);
    } catch (err) {
      setSubmitError(getApiErrorMessage(err, 'Could not complete this interview session.'));
      setAdvancing(false);
    }
  }

  if (loadingPage) {
    return (
      <AppShell>
        <div className="max-w-3xl mx-auto space-y-6">
          <div className="h-6 w-48 bg-slate-200 rounded animate-pulse" />
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="h-5 w-32 bg-slate-100 rounded animate-pulse" />
            <div className="h-7 w-full bg-slate-200 rounded animate-pulse" />
            <div className="h-7 w-3/4 bg-slate-200 rounded animate-pulse" />
          </div>
        </div>
      </AppShell>
    );
  }

  if (pageError || !session) {
    return (
      <AppShell>
        <div className="max-w-2xl mx-auto bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h1 className="text-lg font-semibold text-slate-900">Unable to load interview</h1>
          <p className="text-sm text-rose-700">{pageError || 'Session not found.'}</p>
          <Link
            to="/dashboard"
            className="inline-block px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800"
          >
            Back to dashboard
          </Link>
        </div>
      </AppShell>
    );
  }

  // Edge case: all questions already generated when reopening an in-progress session
  if (!question) {
    return (
      <AppShell>
        <div className="max-w-2xl mx-auto bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h1 className="text-lg font-semibold text-slate-900">All questions have been asked</h1>
          <p className="text-sm text-slate-600">
            Finish this session to compute your overall score and performance band.
          </p>
          {submitError && (
            <div
              role="alert"
              className="p-3.5 text-sm text-rose-800 bg-rose-50 border border-rose-200 rounded-lg"
            >
              {submitError}
            </div>
          )}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleFinishInterview}
              disabled={advancing}
              className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60 cursor-pointer"
            >
              {advancing ? 'Finishing...' : 'Finish interview'}
            </button>
            <Link
              to="/dashboard"
              className="px-4 py-2 text-sm font-medium text-slate-700 hover:text-slate-900"
            >
              Back to dashboard
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  const isLastQuestion = question.order_no >= session.total_questions;
  const evaluation = submittedResponse?.evaluation ?? null;

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Progress & unboxed metadata header */}
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h1 className="text-xl font-bold tracking-tight text-slate-900 tabular-nums">
            Question {question.order_no} of {session.total_questions}
          </h1>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <span>{session.role}</span>
            <span aria-hidden="true">·</span>
            <span className="capitalize">{question.type}</span>
            <span aria-hidden="true">·</span>
            <span className="capitalize">{question.difficulty}</span>
            <span aria-hidden="true">·</span>
            <span className="uppercase">{question.topic}</span>
          </div>
        </div>

        {/* Question prompt */}
        <section className="bg-white border border-slate-200 rounded-xl p-6">
          <p className="text-lg font-medium leading-relaxed text-slate-900">{question.text}</p>
        </section>

        {/* Answer input area (hidden once evaluated) */}
        {!evaluation ? (
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm font-medium text-slate-700">Your answer</span>
              <div className="inline-flex p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  disabled={submitting || recording || needsEvalRetry}
                  onClick={() => {
                    setInputMode('text');
                    setMicError(null);
                  }}
                  className={`px-3.5 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 ${
                    inputMode === 'text'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Text
                </button>
                <button
                  type="button"
                  disabled={submitting || needsEvalRetry}
                  onClick={() => setInputMode('voice')}
                  className={`px-3.5 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 ${
                    inputMode === 'voice'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Voice
                </button>
              </div>
            </div>

            {submitError && (
              <div
                role="alert"
                className="p-4 text-sm text-rose-800 bg-rose-50 border border-rose-200 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <span>{submitError}</span>
                {needsEvalRetry && (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={handleRetryEvaluation}
                    className="px-3.5 py-1.5 text-xs font-semibold text-white bg-rose-700 rounded-md hover:bg-rose-800 disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {submitting ? 'Retrying...' : 'Retry evaluation'}
                  </button>
                )}
              </div>
            )}

            <form onSubmit={handleSubmitAnswer} className="space-y-4">
              {inputMode === 'text' ? (
                <div>
                  <textarea
                    rows={7}
                    value={answerText}
                    onChange={(e) => setAnswerText(e.target.value)}
                    disabled={submitting || needsEvalRetry}
                    placeholder="Write a clear, structured response..."
                    className="w-full px-3.5 py-3 text-sm leading-relaxed text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 disabled:bg-slate-50 disabled:text-slate-500"
                  />
                  <div className="mt-1.5 flex justify-between text-xs text-slate-500 tabular-nums">
                    <span>Typed answers are evaluated on written clarity and content.</span>
                    <span>{countWords(answerText)} words</span>
                  </div>
                </div>
              ) : (
                <div className="space-y-4 py-2">
                  {micError && (
                    <div
                      role="alert"
                      className="p-3.5 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <span>{micError}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setInputMode('text');
                          setMicError(null);
                        }}
                        className="px-3 py-1.5 text-xs font-semibold text-amber-950 bg-white border border-amber-300 rounded-md hover:bg-amber-100 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Switch to Text
                      </button>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-4 py-4 border-y border-slate-100">
                    <div className="flex items-center gap-3">
                      {!recording ? (
                        <button
                          type="button"
                          disabled={submitting || needsEvalRetry}
                          onClick={startRecording}
                          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <Mic className="w-4 h-4" />
                          <span>{audioBlob ? 'Record again' : 'Record'}</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={stopRecording}
                          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-rose-600 rounded-lg hover:bg-rose-700 whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <Square className="w-4 h-4 fill-current" />
                          <span>Stop</span>
                        </button>
                      )}

                      {audioBlob && !recording && (
                        <button
                          type="button"
                          disabled={submitting || needsEvalRetry}
                          onClick={handleReRecord}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <RotateCcw className="w-4 h-4" />
                          <span>Re-record</span>
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2.5 text-sm">
                      {recording && (
                        <span className="text-rose-700 font-medium">Recording</span>
                      )}
                      <span className="font-mono text-base font-semibold text-slate-900 tabular-nums">
                        {formatTimer(recordSeconds)}
                      </span>
                    </div>
                  </div>

                  {audioUrl && !recording && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-slate-600">Recording preview</p>
                      <audio controls src={audioUrl} className="w-full" />
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <div className="text-sm text-slate-600">
                  {submitting && (
                    <span>
                      {inputMode === 'voice'
                        ? 'Transcribing audio and evaluating answer...'
                        : 'Evaluating your answer...'}
                    </span>
                  )}
                </div>
                {!needsEvalRetry && (
                  <button
                    type="submit"
                    disabled={
                      submitting ||
                      recording ||
                      (inputMode === 'text' ? !answerText.trim() : !audioBlob)
                    }
                    className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {submitting ? 'Submitting...' : 'Submit'}
                  </button>
                )}
              </div>
            </form>
          </section>
        ) : (
          /* Per-answer score feedback */
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-6 animate-fade-in">
            <div className="flex flex-wrap items-baseline justify-between gap-4 pb-4 border-b border-slate-100">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Answer evaluation</h2>
                {submittedResponse?.input_mode === 'voice' && submittedResponse.cleaned_text && (
                  <p className="mt-1 text-xs text-slate-500">
                    Transcribed from voice recording
                  </p>
                )}
              </div>
              <div className="text-right">
                <span className="text-xs text-slate-500 block">Answer score</span>
                <span className="text-2xl font-mono font-bold text-slate-900 tabular-nums">
                  {evaluation.fused_score.toFixed(1)}
                  <span className="text-base font-normal text-slate-500"> / 10</span>
                </span>
              </div>
            </div>

            <CriterionScoresList scores={evaluation.scores} />

            {submitError && (
              <div
                role="alert"
                className="p-3.5 text-sm text-rose-800 bg-rose-50 border border-rose-200 rounded-lg"
              >
                {submitError}
              </div>
            )}

            <div className="flex justify-end pt-2 border-t border-slate-100">
              {!isLastQuestion ? (
                <button
                  type="button"
                  disabled={advancing}
                  onClick={handleNextQuestion}
                  className="px-5 py-2.5 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {advancing ? 'Loading next question...' : 'Next question'}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={advancing}
                  onClick={handleFinishInterview}
                  className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {advancing ? 'Finalizing interview...' : 'Finish interview'}
                </button>
              )}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
