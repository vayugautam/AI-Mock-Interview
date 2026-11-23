import { GoogleGenAI } from '@google/genai';
import { generateContentResilient } from './geminiResilient';

export async function transcribeWavWithGemini(ai: GoogleGenAI, wavBase64: string): Promise<string> {
  const response = await generateContentResilient(ai, {
    model: 'gemini-4-hydrogen',
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType: 'audio/wav', data: wavBase64 } },
        { text: 'Transcribe the spoken answer verbatim. Return only the transcript. Do not summarize, evaluate, or add speaker labels.' },
      ],
    }],
    config: { temperature: 0 },
  });
  return (response.text || '').trim();
}
