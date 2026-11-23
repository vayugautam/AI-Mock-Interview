// Client-side Web Audio preprocessing pipeline matching Synopsis Section 2.5 & Semester 7 Plan:
// 1. Decode recorded audio blob
// 2. Resample to 16,000 Hz mono (standard STT rate)
// 3. Trim leading and trailing silence below amplitude threshold
// 4. Normalize RMS / peak volume
// 5. Compute pause frequency from internal speech silence segments
// 6. Encode preprocessed 16-bit PCM WAV base64 for server STT upload

export interface PreprocessedAudioResult {
  wavBase64: string;
  mimeType: 'audio/wav';
  sampleRateHz: number;
  rawDurationSeconds: number;
  trimmedDurationSeconds: number;
  pauseCount: number;
  pauseFrequencyPerMin: number;
  normalizedGainDb: number;
}

export async function preprocessAudioBlob(blob: Blob): Promise<PreprocessedAudioResult> {
  const arrayBuffer = await blob.arrayBuffer();
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  const ctx = new AudioCtx();

  try {
    const decoded = await ctx.decodeAudioData(arrayBuffer);
    const rawDurationSeconds = decoded.duration;
    const targetSampleRate = 16000;

    // Resample to 16kHz mono using OfflineAudioContext
    const targetLength = Math.max(1, Math.ceil(decoded.duration * targetSampleRate));
    const offlineCtx = new OfflineAudioContext(1, targetLength, targetSampleRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = decoded;
    source.connect(offlineCtx.destination);
    source.start(0);

    const resampled = await offlineCtx.startRendering();
    const rawSamples = resampled.getChannelData(0);

    // Trim leading & trailing silence (threshold 0.015 amplitude)
    const silenceThreshold = 0.015;
    let startSample = 0;
    let endSample = rawSamples.length - 1;

    while (startSample < rawSamples.length && Math.abs(rawSamples[startSample]) < silenceThreshold) {
      startSample++;
    }
    while (endSample > startSample && Math.abs(rawSamples[endSample]) < silenceThreshold) {
      endSample--;
    }

    // Keep small 80ms padding around speech boundaries if valid audio exists
    const padSamples = Math.floor(targetSampleRate * 0.08);
    if (endSample > startSample) {
      startSample = Math.max(0, startSample - padSamples);
      endSample = Math.min(rawSamples.length - 1, endSample + padSamples);
    } else {
      startSample = 0;
      endSample = rawSamples.length - 1;
    }

    const trimmed = rawSamples.slice(startSample, endSample + 1);
    const trimmedDurationSeconds = Math.max(0.5, trimmed.length / targetSampleRate);

    // Measure peak & RMS for volume normalization
    let peak = 0;
    let sumSq = 0;
    for (let i = 0; i < trimmed.length; i++) {
      const absVal = Math.abs(trimmed[i]);
      if (absVal > peak) peak = absVal;
      sumSq += trimmed[i] * trimmed[i];
    }
    const rms = Math.sqrt(sumSq / Math.max(1, trimmed.length));
    const targetPeak = 0.85;
    const gain = peak > 0.01 ? Math.min(8.0, targetPeak / peak) : 1.0;
    const normalizedGainDb = gain > 0 ? 20 * Math.log10(gain) : 0;

    const normalized = new Float32Array(trimmed.length);
    for (let i = 0; i < trimmed.length; i++) {
      normalized[i] = Math.max(-1, Math.min(1, trimmed[i] * gain));
    }

    // Count internal speech pauses (> 650ms continuous frames where RMS < 0.018)
    const frameSize = Math.floor(targetSampleRate * 0.05); // 50ms windows
    const pauseMinFrames = 13; // 13 * 50ms = 650ms
    let silentRun = 0;
    let pauseCount = 0;
    let inSpeech = false;

    for (let i = 0; i < normalized.length; i += frameSize) {
      const end = Math.min(normalized.length, i + frameSize);
      let frameSum = 0;
      for (let j = i; j < end; j++) {
        frameSum += normalized[j] * normalized[j];
      }
      const frameRms = Math.sqrt(frameSum / Math.max(1, end - i));
      if (frameRms < Math.max(0.015, rms * 0.22)) {
        if (inSpeech) silentRun++;
      } else {
        if (silentRun >= pauseMinFrames) {
          pauseCount++;
        }
        silentRun = 0;
        inSpeech = true;
      }
    }

    const pauseFrequencyPerMin = (pauseCount / trimmedDurationSeconds) * 60;
    const wavBytes = encodeWavPcm16(normalized, targetSampleRate);
    const wavBase64 = uint8ToBase64(wavBytes);

    return {
      wavBase64,
      mimeType: 'audio/wav',
      sampleRateHz: targetSampleRate,
      rawDurationSeconds: Number(rawDurationSeconds.toFixed(1)),
      trimmedDurationSeconds: Number(trimmedDurationSeconds.toFixed(1)),
      pauseCount,
      pauseFrequencyPerMin: Number(pauseFrequencyPerMin.toFixed(1)),
      normalizedGainDb: Number(normalizedGainDb.toFixed(1)),
    };
  } finally {
    await ctx.close().catch(() => {});
  }
}

function encodeWavPcm16(samples: Float32Array, sampleRate: number): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM format chunk size
  view.setUint16(20, 1, true); // PCM linear
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Uint8Array(buffer);
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}
