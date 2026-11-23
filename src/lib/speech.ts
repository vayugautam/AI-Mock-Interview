// Web Speech API Types
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

export class SpeechHandler {
  private recognition: any = null;
  private isListening = false;
  private onTranscriptCallback: ((transcript: string, isFinal: boolean) => void) | null = null;
  private onErrorCallback: ((error: string) => void) | null = null;
  private accumulatedText = '';

  constructor() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = 'en-US';

      this.recognition.onresult = (event: any) => {
        let interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const item = event.results[i];
          if (item.isFinal) {
            this.accumulatedText += (this.accumulatedText ? ' ' : '') + item[0].transcript.trim();
            if (this.onTranscriptCallback) {
              this.onTranscriptCallback(this.accumulatedText, true);
            }
          } else {
            interimTranscript += item[0].transcript;
          }
        }

        if (interimTranscript && this.onTranscriptCallback) {
          const combined = this.accumulatedText
            ? `${this.accumulatedText} ${interimTranscript.trim()}`
            : interimTranscript.trim();
          this.onTranscriptCallback(combined, false);
        }
      };

      this.recognition.onerror = (event: any) => {
        console.warn('Speech recognition error:', event.error);
        if (['network', 'not-allowed', 'service-not-allowed'].includes(event.error)) {
          // SpeechRecognition may rely on a browser-vendor network service.
          // Stop retrying it and let the recorded audio use server transcription.
          this.isListening = false;
          try {
            this.recognition.stop();
          } catch {
            // The recognizer may already have stopped after the error.
          }
        }
        if (this.onErrorCallback) {
          this.onErrorCallback(event.error);
        }
      };

      this.recognition.onend = () => {
        if (this.isListening) {
          try {
            this.recognition.start();
          } catch (e) {
            // Already started or terminated
          }
        }
      };
    }
  }

  public isSupported(): boolean {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  public start(
    initialText = '',
    onTranscript: (text: string, isFinal: boolean) => void,
    onError?: (err: string) => void
  ) {
    if (!this.recognition) {
      onError?.('Speech recognition is not supported in this browser.');
      return;
    }

    this.accumulatedText = initialText;
    this.onTranscriptCallback = onTranscript;
    this.onErrorCallback = onError || null;
    this.isListening = true;

    try {
      this.recognition.start();
    } catch (err: any) {
      // If already started, ignore
      console.warn('Speech start warning:', err);
    }
  }

  public stop() {
    this.isListening = false;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (err) {
        // ignore
      }
    }
  }

  public reset() {
    this.stop();
    this.accumulatedText = '';
  }
}

// Text to Speech
export class TTSHandler {
  private synth: SpeechSynthesis | null = null;
  private currentUtterance: SpeechSynthesisUtterance | null = null;

  constructor() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.synth = window.speechSynthesis;
    }
  }

  public isSupported(): boolean {
    return !!this.synth;
  }

  public speak(
    text: string,
    onStart?: () => void,
    onEnd?: () => void,
    onError?: (err: any) => void
  ) {
    if (!this.synth) {
      onEnd?.();
      return;
    }

    this.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    this.currentUtterance = utterance;

    // Pick a natural English voice if possible
    const voices = this.synth.getVoices();
    const preferredVoice =
      voices.find((v) => v.lang.startsWith('en') && (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Samantha') || v.name.includes('Daniel'))) ||
      voices.find((v) => v.lang.startsWith('en')) ||
      voices[0];

    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }

    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    utterance.onstart = () => {
      onStart?.();
    };

    utterance.onend = () => {
      this.currentUtterance = null;
      onEnd?.();
    };

    utterance.onerror = (e) => {
      this.currentUtterance = null;
      console.warn('TTS error:', e);
      onError?.(e);
      onEnd?.();
    };

    this.synth.speak(utterance);
  }

  public cancel() {
    if (this.synth) {
      if (this.currentUtterance) {
        this.currentUtterance.onstart = null;
        this.currentUtterance.onend = null;
        this.currentUtterance.onerror = null;
      }
      this.synth.cancel();
      this.currentUtterance = null;
    }
  }

  public isSpeaking(): boolean {
    return !!this.synth && this.synth.speaking;
  }
}

// Audio Stream Analyser for live visualizer
export function createAudioAnalyser(stream: MediaStream) {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const audioCtx = new AudioContextClass();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.8;

    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    return {
      getVolume: (): number => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;
        return Math.min(1, average / 128); // 0.0 to 1.0
      },
      close: () => {
        try {
          source.disconnect();
          audioCtx.close();
        } catch (e) {
          // ignore
        }
      },
    };
  } catch (err) {
    console.warn('Web Audio API not initialized:', err);
    return null;
  }
}
