import { GoogleGenAI } from '@google/genai';
import { generateTextWithGroq, transcribeAudioWithGroq } from './groqQuestionGenerator';

function normalizeSchemaTypes(value: any): any {
  if (Array.isArray(value)) return value.map(normalizeSchemaTypes);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    key === 'type' && typeof item === 'string' ? item.toLowerCase() : normalizeSchemaTypes(item),
  ]));
}

const FALLBACK_MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash'];

function isTransientModelError(error: unknown): boolean {
  const candidate = error as { status?: number; code?: number | string; message?: string };
  const status = Number(candidate?.status ?? candidate?.code);
  const message = String(candidate?.message || '').toLowerCase();
  return status === 429 || status === 503 || /unavailable|overloaded|high demand|resource exhausted/.test(message);
}

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** Retry transient Gemini capacity errors, then fall back while preserving the request schema. */
export async function generateContentResilient(ai: GoogleGenAI, request: any): Promise<any> {
  const primaryModel = request.model || 'gemini-4-hydrogen';
  const models = [primaryModel, ...FALLBACK_MODELS.filter((model) => model !== primaryModel)];
  let lastError: unknown;
  let stopGeminiAttempts = false;

  for (const model of (process.env.GEMINI_API_KEY ? models : [])) {
    if (model !== primaryModel) {
      console.warn(`Gemini model ${primaryModel} was unavailable; trying ${model}.`);
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await ai.models.generateContent({ ...request, model });
      } catch (error) {
        lastError = error;
        if (!isTransientModelError(error)) {
          stopGeminiAttempts = true;
          break;
        }
        if (attempt === 0) await delay(350);
      }
    }
    if (stopGeminiAttempts) break;
  }

  if (process.env.GROQ_API_KEY) {
    const contents = request.contents;
    const parts = (Array.isArray(contents) ? contents : [contents]).flatMap((content: any) =>
      typeof content === 'string' ? [content] : (content?.parts || []).map((part: any) => {
        if (part.text) return part.text;
        if (part.inlineData?.mimeType?.startsWith('audio/') && part.inlineData.data) return { audio: part.inlineData.data };
        return '';
      })
    );
    const audio = parts.find((part: any) => typeof part === 'object' && part.audio);
    try {
      const text = audio
        ? await transcribeAudioWithGroq(audio.audio)
        : await generateTextWithGroq(
            `${parts.filter((part: any) => typeof part === 'string').join('\n')}${request.config?.responseSchema ? `\n\nRequired output JSON schema:\n${JSON.stringify(normalizeSchemaTypes(request.config.responseSchema))}` : ''}${request.config?.tools?.some((tool: any) => tool.googleSearch) ? '\nUse current web search. Include a short Sources section with the exact URLs you relied on; do not invent sources.' : ''}`,
            request.config?.systemInstruction,
            Boolean(request.config?.responseMimeType === 'application/json'),
            Boolean(request.config?.tools?.some((tool: any) => tool.googleSearch))
          );
      return { text, provider: 'groq' };
    } catch (groqError) {
      if (lastError instanceof Error) throw new Error(`${lastError.message}; Groq fallback failed: ${groqError instanceof Error ? groqError.message : String(groqError)}`);
      throw groqError;
    }
  }

  throw lastError;
}
