import {
  cleanExtractedPdfText,
  DEFAULT_MAX_PDF_BYTES,
  DEFAULT_MIN_EXTRACTED_CHARS,
  extractUploadedPdfText,
  PdfExtractionError,
} from '../backend/services/pdfTextExtractor';

export const MAX_PDF_SIZE_BYTES = DEFAULT_MAX_PDF_BYTES; // 5 MB
export const MIN_DOCUMENT_CHARS = DEFAULT_MIN_EXTRACTED_CHARS;

export class DocumentValidationError extends Error {
  public statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'DocumentValidationError';
    this.statusCode = statusCode;
  }
}

export function normalizeDocumentText(rawText: string): string {
  return cleanExtractedPdfText(rawText);
}

export async function validateAndExtractPdf(params: {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  docLabel: 'Job Description' | 'Resume';
}): Promise<{ normalizedText: string; pageCount: number }> {
  const { buffer, originalName, mimeType, docLabel } = params;

  try {
    const extracted = await extractUploadedPdfText({
      buffer,
      originalName,
      mimeType,
      documentType: docLabel === 'Resume' ? 'resume' : 'job_description',
      maxBytes: MAX_PDF_SIZE_BYTES,
      minChars: MIN_DOCUMENT_CHARS,
    });

    return {
      normalizedText: extracted.text,
      pageCount: extracted.pageCount,
    };
  } catch (err: unknown) {
    if (err instanceof PdfExtractionError) {
      throw new DocumentValidationError(err.message, err.statusCode);
    }
    const detail = err instanceof Error ? err.message : 'corrupted or unsupported PDF structure';
    throw new DocumentValidationError(`Failed to parse the ${docLabel} PDF: ${detail}.`, 422);
  }
}

export function validatePastedText(rawText: string, docLabel = 'Job Description'): string {
  const normalized = normalizeDocumentText(rawText);
  if (normalized.length < MIN_DOCUMENT_CHARS) {
    throw new DocumentValidationError(
      `${docLabel} text is too short or empty. Please provide at least ${MIN_DOCUMENT_CHARS} characters describing the role and requirements.`,
      400
    );
  }
  if (normalized.length > 50000) {
    return normalized.slice(0, 50000);
  }
  return normalized;
}

export function splitIntoSemanticChunks(
  text: string,
  maxChunkChars = 550,
  overlapChars = 80
): string[] {
  const cleaned = normalizeDocumentText(text);
  if (!cleaned) return [];

  const paragraphs = cleaned.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let buffer = '';

  for (const para of paragraphs) {
    if (para.length > maxChunkChars) {
      // Flush current buffer
      if (buffer) {
        chunks.push(buffer.trim());
        buffer = '';
      }
      // Split long paragraph by sentence or fixed window
      const sentences = para.split(/(?<=[.!?])\s+/);
      let sentBuf = '';
      for (const s of sentences) {
        if ((sentBuf + ' ' + s).trim().length <= maxChunkChars) {
          sentBuf = (sentBuf + ' ' + s).trim();
        } else {
          if (sentBuf) chunks.push(sentBuf);
          if (s.length > maxChunkChars) {
            for (let i = 0; i < s.length; i += maxChunkChars - overlapChars) {
              chunks.push(s.slice(i, i + maxChunkChars).trim());
            }
            sentBuf = '';
          } else {
            sentBuf = s;
          }
        }
      }
      if (sentBuf) chunks.push(sentBuf);
    } else if ((buffer + '\n' + para).trim().length <= maxChunkChars) {
      buffer = buffer ? `${buffer}\n${para}` : para;
    } else {
      if (buffer) chunks.push(buffer.trim());
      buffer = para;
    }
  }

  if (buffer.trim()) {
    chunks.push(buffer.trim());
  }

  return chunks.filter((c) => c.length >= 20);
}
