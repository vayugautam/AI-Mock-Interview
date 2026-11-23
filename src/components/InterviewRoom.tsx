import React, { useState, useEffect, useRef } from 'react';
import { User, AnswerEvaluation } from '../types';
import { api } from '../lib/api';
import { GeneratedSessionPayload } from './ConfigureInterview';
import { QuestionCard } from './QuestionCard';
import { TranscriptViewer } from './TranscriptViewer';
import {
  Clock,
  AlertCircle,
  CheckCircle2,
  Sliders,
  Award,
  Mic,
  MicOff,
  Volume2,
} from 'lucide-react';
import { preprocessAudioBlob, PreprocessedAudioResult } from '../lib/audioProcessor';
import { SpeechHandler, TTSHandler } from '../lib/speech';

interface InterviewRoomProps {
  user: User;
  sessionPayload: GeneratedSessionPayload | null;
  onInterviewFinished: (interviewId: string) => void;
  onExit: () => void;
}

export const InterviewRoom: React.FC<InterviewRoomProps> = ({
  user,
  sessionPayload,
  onInterviewFinished,
  onExit,
}) => {
  const questions = sessionPayload?.questions || [];
  const interviewId = sessionPayload?.interviewId || null;

  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [draftsByQuestionId, setDraftsByQuestionId] = useState<Record<number, string>>({});
  const [evaluationsByQuestionId, setEvaluationsByQuestionId] = useState<
    Record<number, AnswerEvaluation>
  >({});
  const [inFlightQuestionId, setInFlightQuestionId] = useState<number | null>(null);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [inputMode, setInputMode] = useState<'text' | 'voice'>('voice');
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessingAudio, setIsProcessingAudio] = useState(false);
  const [voiceAudio, setVoiceAudio] = useState<PreprocessedAudioResult | null>(null);
  const [voicePreviewUrl, setVoicePreviewUrl] = useState<string | null>(null);
  const [autoReadQuestions, setAutoReadQuestions] = useState(true);
  const [voicePersona, setVoicePersona] = useState(() => {
    try { return localStorage.getItem('talentpulse_interviewer_voice') || 'calm_recruiter'; }
    catch { return 'calm_recruiter'; }
  });
  const [isQuestionSpeaking, setIsQuestionSpeaking] = useState(false);
  const [questionSpeechError, setQuestionSpeechError] = useState<string | null>(null);
  const speechRef = useRef<SpeechHandler | null>(null);
  const ttsRef = useRef<TTSHandler | null>(null);
  const questionAudioRef = useRef<HTMLAudioElement | null>(null);
  const questionAudioUrlsRef = useRef<string[]>([]);
  const speechRunRef = useRef(0);
  const speechApiUnavailableRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const autoSubmitQuestionRef = useRef<number | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const activeQuestion = questions[currentQuestionIndex] || questions[0];

  const releaseVoiceRecording = () => {
    speechRef.current?.reset();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.stop();
    }
    recorderRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  };

  const clearVoiceAudio = () => {
    setVoiceAudio(null);
    setVoicePreviewUrl(null);
  };

  // Reset room state cleanly whenever a new interview session is generated
  useEffect(() => {
    setCurrentQuestionIndex(0);
    setDraftsByQuestionId({});
    setEvaluationsByQuestionId({});
    setInFlightQuestionId(null);
    setTimerSeconds(0);
    setErrorMessage(null);
    setInputMode('voice');
    setIsRecording(false);
    setIsProcessingAudio(false);
    clearVoiceAudio();
    releaseVoiceRecording();
  }, [sessionPayload?.interviewId]);

  useEffect(() => {
    speechRef.current = new SpeechHandler();
    return () => {
      speechRef.current?.reset();
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.stop();
      }
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    ttsRef.current = new TTSHandler();
    return () => ttsRef.current?.cancel();
  }, []);

  useEffect(() => {
    const questionToRead = activeQuestion;
    if (!questionToRead || !autoReadQuestions) return;

    handleStopQuestionSpeech();
    setQuestionSpeechError(null);
    const timer = window.setTimeout(() => {
      void handleSpeakQuestion();
    }, 250);

    return () => {
      window.clearTimeout(timer);
      handleStopQuestionSpeech();
    };
  }, [sessionPayload?.interviewId, activeQuestion?.id, activeQuestion?.question, autoReadQuestions, voicePersona]);

  useEffect(() => () => {
    if (voicePreviewUrl) URL.revokeObjectURL(voicePreviewUrl);
  }, [voicePreviewUrl]);

  useEffect(() => {
    if (!sessionPayload) return;
    const timer = setInterval(() => {
      setTimerSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [sessionPayload?.interviewId]);

  if (!sessionPayload || !interviewId || questions.length === 0) {
    return (
      <div className="max-w-xl mx-auto min-h-[380px] flex flex-col items-center justify-center p-8 text-center space-y-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl">
        <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
          <Sliders className="w-6 h-6" />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            No Active Interview Session
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-md">
            Start in Interview Setup by providing a Job Description, uploading your Resume PDF, and clicking Generate Interview.
          </p>
        </div>
        <button
          type="button"
          onClick={onExit}
          className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer transition-colors"
        >
          Go to Interview Setup
        </button>
      </div>
    );
  }

  const currentQ = activeQuestion!;
  const canSpeakQuestion = true;
  const isLastQuestion = currentQuestionIndex >= questions.length - 1;
  const currentDraft = draftsByQuestionId[currentQ.id] || '';
  const currentEvaluation = evaluationsByQuestionId[currentQ.id] || null;
  const isSubmittingCurrent = inFlightQuestionId === currentQ.id;

  const answeredCount = questions.filter((q) => {
    const ev = evaluationsByQuestionId[q.id];
    return ev && !ev.isOffTopic;
  }).length;

  const progressPercent = Math.round((answeredCount / questions.length) * 100);

  const handleSetCandidateAnswer = (text: string) => {
    setDraftsByQuestionId((prev) => ({ ...prev, [currentQ.id]: text }));
  };

  const handleStartRecording = async () => {
    autoSubmitQuestionRef.current = null;
    ttsRef.current?.cancel();
    setIsQuestionSpeaking(false);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setErrorMessage('Voice recording is not supported by this browser. Try a current version of Chrome or Edge.');
      return;
    }
    try {
      clearVoiceAudio();
      setErrorMessage(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        setIsRecording(false);
        setIsProcessingAudio(true);
        try {
          const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
          if (!blob.size) throw new Error('No audio was captured. Please record your answer again.');
          const previewUrl = URL.createObjectURL(blob);
          setVoicePreviewUrl(previewUrl);
          const processed = await preprocessAudioBlob(blob);
          if (processed.wavBase64.length > 20_000_000) {
            throw new Error('This recording exceeds the 15 MB upload limit. Please record a shorter answer.');
          }
          setVoiceAudio(processed);
        } catch (err: any) {
          setErrorMessage(err.message || 'Could not process the recording. Please try again.');
        } finally {
          setIsProcessingAudio(false);
        }
      };
      recorder.start(250);
      setIsRecording(true);
      speechRef.current?.start(
        draftsByQuestionId[currentQ.id] || '',
        (text) => setDraftsByQuestionId((prev) => ({ ...prev, [currentQ.id]: text.slice(0, 4000) })),
        (error) => {
          if (['network', 'not-allowed', 'service-not-allowed'].includes(error)) {
            // Discard any partial browser transcript so evaluation uses the complete recorded audio.
            setDraftsByQuestionId((prev) => ({ ...prev, [currentQ.id]: '' }));
            setErrorMessage('Live transcription is unavailable. Your recording will be transcribed after you stop.');
          }
        }
      );
    } catch (err: any) {
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
      setIsRecording(false);
      setErrorMessage(err?.name === 'NotAllowedError'
        ? 'Microphone access was denied. Allow microphone access in your browser, then try again.'
        : err.message || 'Could not start microphone recording.');
    }
  };

  const handleStopRecording = () => {
    speechRef.current?.stop();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  };

  function handleStopQuestionSpeech() {
    speechRunRef.current += 1;
    ttsRef.current?.cancel();
    if (questionAudioRef.current) {
      questionAudioRef.current.onended = null;
      questionAudioRef.current.onerror = null;
      questionAudioRef.current.pause();
      questionAudioRef.current.src = '';
      questionAudioRef.current = null;
    }
    questionAudioUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    questionAudioUrlsRef.current = [];
    setIsQuestionSpeaking(false);
  }

  async function handleSpeakQuestion() {
    if (!currentQ) return;
    handleStopQuestionSpeech();
    const runId = ++speechRunRef.current;
    setQuestionSpeechError(null);
    setIsQuestionSpeaking(true);

    const fallbackToBrowser = () => {
      if (runId !== speechRunRef.current) return;
      if (!ttsRef.current?.isSupported()) {
        setIsQuestionSpeaking(false);
        setQuestionSpeechError('Question audio is unavailable. Check your connection or browser voice support.');
        return;
      }
      ttsRef.current.speak(
        currentQ.question,
        () => setIsQuestionSpeaking(true),
        () => setIsQuestionSpeaking(false),
        () => setQuestionSpeechError('Could not play the question audio. Try again.')
      );
    };

    if (speechApiUnavailableRef.current) {
      fallbackToBrowser();
      return;
    }

    try {
      const response = await api.synthesizeQuestionSpeech({ questionText: currentQ.question, persona: voicePersona });
      if (runId !== speechRunRef.current) return;
      let segmentIndex = 0;
      const playNext = () => {
        if (runId !== speechRunRef.current) return;
        if (segmentIndex >= response.audioSegments.length) {
          setIsQuestionSpeaking(false);
          return;
        }
        const binary = atob(response.audioSegments[segmentIndex]);
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        const objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
        questionAudioUrlsRef.current.push(objectUrl);
        const audio = new Audio(objectUrl);
        questionAudioRef.current = audio;
        audio.onended = () => {
          URL.revokeObjectURL(objectUrl);
          questionAudioUrlsRef.current = questionAudioUrlsRef.current.filter((url) => url !== objectUrl);
          segmentIndex += 1;
          playNext();
        };
        audio.onerror = fallbackToBrowser;
        void audio.play().catch(fallbackToBrowser);
      };
      if (response.audioSegments.length === 0) fallbackToBrowser();
      else playNext();
    } catch (error: any) {
      // A missing route means the browser is reaching an older server build. Avoid
      // sending the same failing request for every question in this page session.
      if (/\b(401|404)\b|unauthorized|session expired|invalid token/i.test(String(error?.message || ''))) {
        speechApiUnavailableRef.current = true;
      }
      fallbackToBrowser();
    }
  }

  const handleAutoReadChange = (enabled: boolean) => {
    setAutoReadQuestions(enabled);
    if (!enabled) handleStopQuestionSpeech();
  };

  const handleSubmitAnswer = async () => {
    if (!currentQ || inFlightQuestionId !== null) return;
    if (inputMode === 'voice' && !voiceAudio) return;
    if (inputMode === 'text' && !currentDraft.trim()) return;
    if (currentEvaluation && !currentEvaluation.isOffTopic) return;

    setInFlightQuestionId(currentQ.id);
    setErrorMessage(null);

    try {
      const res = await api.evaluateAnswer({
        interviewId,
        questionId: currentQ.id,
        candidateAnswer: currentDraft.trim(),
        rawTranscript: currentDraft.trim(),
        inputModality: inputMode,
        audioWavBase64: inputMode === 'voice' && !currentDraft.trim() ? voiceAudio?.wavBase64 : undefined,
        audioDurationSeconds: inputMode === 'voice' ? voiceAudio?.rawDurationSeconds : undefined,
        deliveryTelemetry: inputMode === 'voice' && voiceAudio
          ? {
              speakingRateWpm: Math.round(
                (currentDraft.trim().split(/\s+/).filter(Boolean).length / Math.max(1, voiceAudio.trimmedDurationSeconds)) * 60
              ),
              pauseFrequencyPerMin: voiceAudio.pauseFrequencyPerMin,
              trimmedDurationSeconds: voiceAudio.trimmedDurationSeconds,
              normalizedGainDb: voiceAudio.normalizedGainDb,
              sampleRateHz: voiceAudio.sampleRateHz,
            }
          : undefined,
        allowResubmit: Boolean(currentEvaluation?.isOffTopic),
      });

      const evaluatedTranscript = res.answerEntry?.rawTranscript || currentDraft.trim();
      setDraftsByQuestionId((prev) => ({ ...prev, [currentQ.id]: evaluatedTranscript }));
      setEvaluationsByQuestionId((prev) => ({
        ...prev,
        [currentQ.id]: res.evaluation,
      }));
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to evaluate answer. Please try again.');
    } finally {
      setInFlightQuestionId(null);
    }
  };

  useEffect(() => {
    if (inputMode === 'voice' && voiceAudio && !isProcessingAudio && !isSubmittingCurrent && !currentEvaluation && autoSubmitQuestionRef.current !== currentQ.id) {
      autoSubmitQuestionRef.current = currentQ.id;
      void handleSubmitAnswer();
    }
  }, [voiceAudio, inputMode, isProcessingAudio, isSubmittingCurrent, currentEvaluation, currentQ.id]);

  const handleRequestReAnswer = () => {
    autoSubmitQuestionRef.current = null;
    clearVoiceAudio();
    setEvaluationsByQuestionId((prev) => {
      const next = { ...prev };
      delete next[currentQ.id];
      return next;
    });
    setDraftsByQuestionId((prev) => ({ ...prev, [currentQ.id]: '' }));
    setErrorMessage(null);
  };

  const handleNextQuestion = () => {
    if (currentQuestionIndex < questions.length - 1) {
      clearVoiceAudio();
      setErrorMessage(null);
      setCurrentQuestionIndex((prev) => prev + 1);
    }
  };

  const handleFinishInterview = () => {
    onInterviewFinished(interviewId);
  };

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in pb-12">
      {/* Studio Header & Progress */}
      <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3 transition-colors">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-0.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="text-sm font-bold text-slate-900 dark:text-white truncate">
                {sessionPayload.jdTitle}
              </span>
              {sessionPayload.companyName && sessionPayload.companyName !== 'Unknown' && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{sessionPayload.companyName}</span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span className="capitalize font-medium text-indigo-600 dark:text-indigo-400">
                {sessionPayload.interviewType}
              </span>
              <span aria-hidden="true">·</span>
              <span className="capitalize">{sessionPayload.difficulty}</span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              Candidate: {user.name} · Question {currentQuestionIndex + 1} of {questions.length} · {answeredCount} Evaluated
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <div className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 font-mono tabular-nums">
              <Clock className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>{formatTimer(timerSeconds)}</span>
            </div>

            {answeredCount > 0 && (
              <button
                type="button"
                onClick={handleFinishInterview}
                className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center space-x-1.5 cursor-pointer transition-colors whitespace-nowrap"
              >
                <Award className="w-3.5 h-3.5" />
                <span>Complete & Report</span>
              </button>
            )}

            <button
              type="button"
              onClick={onExit}
              className="px-3 py-1.5 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
            >
              Exit to Setup
            </button>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-indigo-600 dark:bg-indigo-500 transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Aptitude-style horizontal question navigator */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl px-4 py-3 sm:px-5 sm:py-4 space-y-3">
        <div className="flex items-center justify-between gap-3 text-xs">
          <h2 className="font-bold text-slate-900 dark:text-white">Question Navigator</h2>
          <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
            {answeredCount}/{questions.length} Done
          </span>
        </div>
        <div className="overflow-x-auto pb-1" aria-label="Choose a question">
          <div className="flex w-max min-w-full gap-2">
            {questions.map((q, idx) => {
              const ev = evaluationsByQuestionId[q.id];
              const isDone = Boolean(ev && !ev.isOffTopic);
              const isOffTopic = Boolean(ev?.isOffTopic);
              const isCurrent = idx === currentQuestionIndex;

              return (
                <button
                  key={q.id}
                  type="button"
                  disabled={isRecording || isProcessingAudio}
                  onClick={() => {
                    if (idx !== currentQuestionIndex) clearVoiceAudio();
                    setErrorMessage(null);
                    setCurrentQuestionIndex(idx);
                  }}
                  className={`h-10 min-w-11 px-3 rounded-lg font-mono text-xs font-bold tabular-nums inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer border disabled:opacity-50 disabled:cursor-not-allowed ${
                    isCurrent
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : isDone
                      ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30'
                      : isOffTopic
                      ? 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30'
                      : 'bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-indigo-400'
                  }`}
                  title={`Question ${idx + 1}: ${q.topic}`}
                  aria-current={isCurrent ? 'step' : undefined}
                >
                  <span>{idx + 1}</span>
                  {isDone && !isCurrent && <CheckCircle2 className="w-3 h-3 shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Full-width interview stage; document context still informs question generation. */}
      <div className="space-y-4">
          <QuestionCard
            question={currentQ}
            currentIndex={currentQuestionIndex}
            totalQuestions={questions.length}
            difficulty={sessionPayload.difficulty}
            voicePersona={voicePersona}
            onVoicePersonaChange={(persona) => {
              setVoicePersona(persona);
              try { localStorage.setItem('talentpulse_interviewer_voice', persona); } catch { /* storage is optional */ }
            }}
            canSpeakQuestion={canSpeakQuestion}
            isQuestionSpeaking={isQuestionSpeaking}
            autoReadQuestions={autoReadQuestions}
            questionSpeechError={questionSpeechError}
            onSpeakQuestion={handleSpeakQuestion}
            onStopQuestionSpeech={handleStopQuestionSpeech}
            onAutoReadChange={handleAutoReadChange}
          />

          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Answer mode</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Type your response or record it with your microphone.</p>
              </div>
              <span className="text-xs text-indigo-600 dark:text-indigo-300 inline-flex items-center gap-1.5"><Mic className="w-3.5 h-3.5" /> Voice interview</span>
            </div>
            {inputMode === 'voice' && (
              <div className="space-y-3">
                <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                  Your recording is sent to this app’s server only when browser speech recognition does not provide a transcript. Audio is processed for transcription and is not saved with your interview.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {!isRecording ? (
                    <button type="button" onClick={handleStartRecording} disabled={isSubmittingCurrent || isProcessingAudio || Boolean(currentEvaluation && !currentEvaluation.isOffTopic)} className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-50">
                      <Mic className="w-4 h-4" /> {voiceAudio ? 'Record again' : 'Start recording'}
                    </button>
                  ) : (
                    <button type="button" onClick={handleStopRecording} className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold inline-flex items-center gap-2">
                      <MicOff className="w-4 h-4" /> Stop recording
                    </button>
                  )}
                  {isRecording && <span className="text-xs font-medium text-rose-600 dark:text-rose-400 animate-pulse">Recording…</span>}
                  {isProcessingAudio && <span className="text-xs text-slate-500 dark:text-slate-400">Preparing audio…</span>}
                  {voiceAudio && !isProcessingAudio && <span className="text-xs text-emerald-600 dark:text-emerald-400">Recording ready · {voiceAudio.rawDurationSeconds}s</span>}
                </div>
                {voicePreviewUrl && (
                  <audio controls src={voicePreviewUrl} className="w-full max-w-md h-9" aria-label="Preview recorded answer" />
                )}
                {isRecording && speechRef.current?.isSupported() && <p className="text-[11px] text-slate-500 dark:text-slate-400">Live transcript appears below. Review it before submitting.</p>}
                {isRecording && !speechRef.current?.isSupported() && <p className="text-[11px] text-amber-600 dark:text-amber-400">Live transcription is not available in this browser; the server will transcribe the recording when you submit.</p>}
                {voiceAudio && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 inline-flex items-center gap-1.5">
                    <Volume2 className="w-3.5 h-3.5" /> {voiceAudio.pauseCount} long pause{voiceAudio.pauseCount === 1 ? '' : 's'} detected · audio normalized to 16 kHz mono
                  </p>
                )}
              </div>
            )}
          </section>

          <TranscriptViewer
            questionText={currentQ.question}
            candidateAnswer={currentDraft}
            setCandidateAnswer={handleSetCandidateAnswer}
            isSubmittingAnswer={isSubmittingCurrent}
            onSubmitAnswer={handleSubmitAnswer}
            currentEvaluation={currentEvaluation}
            isLastQuestion={isLastQuestion}
            answeredCount={answeredCount}
            totalQuestions={questions.length}
            onNextQuestion={handleNextQuestion}
            onFinishInterview={handleFinishInterview}
            onRequestReAnswer={handleRequestReAnswer}
            errorMessage={errorMessage}
            canSubmitAnswer={inputMode === 'voice' ? Boolean(voiceAudio) : Boolean(currentDraft.trim())}
            inputMode={inputMode}
            autoSubmit
          />
      </div>
    </div>
  );
};
