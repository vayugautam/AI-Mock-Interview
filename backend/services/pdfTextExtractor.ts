import {
  FormatError,
  InvalidPDFException,
  PDFParse,
  PasswordException,
  UnknownErrorException,
  VerbosityLevel,
} from 'pdf-parse';

export const DEFAULT_MAX_PDF_BYTES = 5 * 1024 * 1024; // 5 MB
export const DEFAULT_MIN_EXTRACTED_CHARS = 40;

export type PdfDocumentCategory = 'resume' | 'job_description';

export type PdfExtractionErrorCode =
  | 'EMPTY_FILE'
  | 'FILE_TOO_LARGE'
  | 'INVALID_FILE_TYPE'
  | 'CORRUPTED_PDF'
  | 'PASSWORD_PROTECTED'
  | 'UNREADABLE_CONTENT'
  | 'PARSE_FAILED';

export class PdfExtractionError extends Error {
  public readonly code: PdfExtractionErrorCode;
  public readonly statusCode: number;

  constructor(
    message: string,
    code: PdfExtractionErrorCode,
    statusCode = 400,
    cause?: unknown
  ) {
    super(message);
    this.name = 'PdfExtractionError';
    this.code = code;
    this.statusCode = statusCode;
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

export interface ExtractPdfOptions {
  documentType?: PdfDocumentCategory;
  maxBytes?: number;
  minChars?: number;
  password?: string;
}

export interface UploadedPdfInput {
  buffer: Buffer | Uint8Array;
  originalName?: string;
  mimeType?: string;
  documentType?: PdfDocumentCategory;
  maxBytes?: number;
  minChars?: number;
  password?: string;
}

export interface ExtractedPdfContent {
  text: string;
  rawText: string;
  pageCount: number;
  charCount: number;
  wordCount: number;
}

function getDocumentLabel(documentType?: PdfDocumentCategory): string {
  if (documentType === 'resume') return 'Resume';
  if (documentType === 'job_description') return 'Job Description';
  return 'PDF document';
}

/**
 * Normalizes raw text extracted from a PDF into clean, readable paragraphs
 * suitable for LLM analysis and RAG chunking.
 */
export function cleanExtractedPdfText(rawText: string): string {
  if (!rawText) return '';

  return rawText
    // Replace common Unicode ligatures and invisible spaces
    .replace(/\uFB00/g, 'ff')
    .replace(/\uFB01/g, 'fi')
    .replace(/\uFB02/g, 'fl')
    .replace(/\uFB03/g, 'ffi')
    .replace(/\uFB04/g, 'ffl')
    .replace(/[\u00A0\u2000-\u200B\uFEFF]/g, ' ')
    // Normalize line endings and strip NUL / non-printable control characters
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Remove pdf-parse page footer dividers like "-- 1 of 2 --"
    .replace(/^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/gm, '')
    // Join hyphenated words broken across line wraps (e.g. "micro-\nservices" -> "microservices")
    .replace(/([a-z])-\n([a-z])/g, '$1$2')
    // Trim whitespace per line and collapse internal runs of spaces/tabs
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    // Collapse 3+ consecutive newlines down to a single paragraph break
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function toUint8Array(input: Buffer | Uint8Array): Uint8Array {
  if (!input) {
    return new Uint8Array(0);
  }
  // Ensure an isolated copy/view compatible with pdfjs worker transfers
  return input instanceof Buffer
    ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
    : input;
}

function validatePdfMagicBytes(bytes: Uint8Array, label: string): void {
  if (bytes.byteLength === 0) {
    throw new PdfExtractionError(
      `The uploaded ${label} PDF file is empty.`,
      'EMPTY_FILE',
      400
    );
  }

  // Standard PDFs begin with "%PDF-" (allowing optional leading UTF-8 BOM or whitespace within first 1024 bytes)
  const searchWindow = Buffer.from(bytes.subarray(0, Math.min(bytes.byteLength, 1024))).toString('latin1');
  if (!searchWindow.includes('%PDF-')) {
    throw new PdfExtractionError(
      `The uploaded ${label} file is corrupted or not a valid PDF document (missing %PDF- header).`,
      'CORRUPTED_PDF',
      400
    );
  }
}

/**
 * Extracts and cleans text from a raw PDF buffer using `pdf-parse`.
 * Distinguishes corrupted headers/structures, encrypted PDFs, and image-only/empty PDFs.
 */
export async function extractCleanTextFromPdf(
  input: Buffer | Uint8Array,
  options: ExtractPdfOptions = {}
): Promise<ExtractedPdfContent> {
  const label = getDocumentLabel(options.documentType);
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_PDF_BYTES;
  const minChars = options.minChars ?? DEFAULT_MIN_EXTRACTED_CHARS;

  if (!input || !(input instanceof Uint8Array)) {
    throw new PdfExtractionError(
      `No valid binary buffer was provided for the ${label}.`,
      'EMPTY_FILE',
      400
    );
  }

  const bytes = toUint8Array(input);

  if (bytes.byteLength === 0) {
    throw new PdfExtractionError(
      `The uploaded ${label} PDF file is empty.`,
      'EMPTY_FILE',
      400
    );
  }

  if (bytes.byteLength > maxBytes) {
    const limitMb = (maxBytes / (1024 * 1024)).toFixed(1);
    const actualMb = (bytes.byteLength / (1024 * 1024)).toFixed(2);
    throw new PdfExtractionError(
      `${label} PDF exceeds the ${limitMb} MB size limit (${actualMb} MB uploaded).`,
      'FILE_TOO_LARGE',
      400
    );
  }

  validatePdfMagicBytes(bytes, label);

  let parser: PDFParse | null = null;
  try {
    parser = new PDFParse({
      data: new Uint8Array(bytes),
      verbosity: VerbosityLevel.ERRORS,
      password: options.password,
      stopAtErrors: true,
    });

    const result = await parser.getText();
    const rawText = result?.text ?? '';
    const cleaned = cleanExtractedPdfText(rawText);

    if (cleaned.length < minChars) {
      throw new PdfExtractionError(
        `Could not extract readable text from the ${label} PDF (${cleaned.length} chars extracted). Ensure the PDF contains selectable text rather than scanned images.`,
        'UNREADABLE_CONTENT',
        422
      );
    }

    const wordCount = cleaned.split(/\s+/).filter(Boolean).length;

    return {
      text: cleaned,
      rawText,
      pageCount: result?.total || result?.pages?.length || 1,
      charCount: cleaned.length,
      wordCount,
    };
  } catch (err: unknown) {
    if (err instanceof PdfExtractionError) {
      throw err;
    }

    if (err instanceof PasswordException) {
      throw new PdfExtractionError(
        `This ${label} PDF is password-protected or encrypted. Please upload an unlocked PDF.`,
        'PASSWORD_PROTECTED',
        422,
        err
      );
    }

    if (err instanceof InvalidPDFException || err instanceof FormatError) {
      throw new PdfExtractionError(
        `The ${label} PDF appears to be corrupted or structurally malformed and could not be parsed.`,
        'CORRUPTED_PDF',
        422,
        err
      );
    }

    if (err instanceof UnknownErrorException) {
      throw new PdfExtractionError(
        `Unable to read the ${label} PDF due to an unexpected file corruption or unsupported PDF encoding.`,
        'CORRUPTED_PDF',
        422,
        err
      );
    }

    const detail = err instanceof Error ? err.message : 'Unexpected PDF parsing failure';
    const lowerDetail = detail.toLowerCase();
    const isCorruptedOrInvalid =
      lowerDetail.includes('invalid pdf') ||
      lowerDetail.includes('corrupt') ||
      lowerDetail.includes('xref') ||
      lowerDetail.includes('trailer') ||
      lowerDetail.includes('bad encoding') ||
      lowerDetail.includes('unexpected end');

    throw new PdfExtractionError(
      isCorruptedOrInvalid
        ? `The ${label} PDF file is corrupted or malformed (${detail}).`
        : `Failed to extract text from the ${label} PDF: ${detail}`,
      isCorruptedOrInvalid ? 'CORRUPTED_PDF' : 'PARSE_FAILED',
      422,
      err
    );
  } finally {
    if (parser) {
      try {
        await parser.destroy();
      } catch {
        // Ignore cleanup errors after parse failure
      }
    }
  }
}

/**
 * Full validation + extraction entrypoint for user-uploaded PDF resumes and job descriptions.
 * Checks filename extension, MIME type, binary size, PDF magic header, and structural integrity.
 */
export async function extractUploadedPdfText(
  input: UploadedPdfInput
): Promise<ExtractedPdfContent> {
  const label = getDocumentLabel(input.documentType);

  if (input.originalName !== undefined) {
    const lowerName = input.originalName.trim().toLowerCase();
    if (!lowerName.endsWith('.pdf')) {
      throw new PdfExtractionError(
        `Invalid ${label} file format. Only .pdf files are supported.`,
        'INVALID_FILE_TYPE',
        400
      );
    }
  }

  if (input.mimeType !== undefined && input.mimeType.trim() !== '') {
    const normalizedMime = input.mimeType.split(';')[0].trim().toLowerCase();
    const allowedMimes = new Set([
      'application/pdf',
      'application/x-pdf',
      'application/octet-stream',
    ]);
    if (!allowedMimes.has(normalizedMime)) {
      throw new PdfExtractionError(
        `Invalid ${label} MIME type (${normalizedMime}). Expected application/pdf.`,
        'INVALID_FILE_TYPE',
        400
      );
    }
  }

  return extractCleanTextFromPdf(input.buffer, {
    documentType: input.documentType,
    maxBytes: input.maxBytes,
    minChars: input.minChars,
    password: input.password,
  });
}
