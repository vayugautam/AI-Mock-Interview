import { describe, it, expect } from 'vitest';
import {
  cleanExtractedPdfText,
  extractCleanTextFromPdf,
  extractUploadedPdfText,
  PdfExtractionError,
} from '../backend/services/pdfTextExtractor';

function buildMultiLinePdf(pages: string[][]): Buffer {
  const objects: string[] = [];
  const pageObjNums: number[] = [];

  // Reserve obj 1 (Catalog) and obj 2 (Pages) and obj 3 (Helvetica font)
  objects.push(''); // 1
  objects.push(''); // 2
  objects.push('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');

  let nextObj = 4;
  for (const lines of pages) {
    const contentObjNum = nextObj++;
    const pageObjNum = nextObj++;
    pageObjNums.push(pageObjNum);

    const escaped = lines
      .map((line) => line.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'))
      .map((line, i) => `(${line}) Tj ${i < lines.length - 1 ? '0 -16 Td' : ''}`)
      .join('\n');

    const stream = `BT\n/F1 12 Tf\n50 740 Td\n${escaped}\nET\n`;
    objects[contentObjNum - 1] =
      `${contentObjNum} 0 obj\n<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}endstream\nendobj\n`;
    objects[pageObjNum - 1] =
      `${pageObjNum} 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 3 0 R >> >> /MediaBox [0 0 612 792] /Contents ${contentObjNum} 0 R >>\nendobj\n`;
  }

  objects[0] = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  objects[1] =
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageObjNums.length} >>\nendobj\n`;

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj;
  }

  const xrefStart = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(pdf, 'utf8');
}

describe('backend/services/pdfTextExtractor (pdf-parse)', () => {
  it('cleans ligatures, hyphenated line wraps, control chars, and extra whitespace', () => {
    const raw =
      'Senior   Engineer\u0000\r\n\r\nBuilt   micro-\nservices  for   \uFB01nancial   work\uFB02ows.\n\n\n\n-- 1 of 2 --\nExperience:   4 years';
    const cleaned = cleanExtractedPdfText(raw);

    expect(cleaned).toBe(
      'Senior Engineer\n\nBuilt microservices for financial workflows.\n\nExperience: 4 years'
    );
  });

  it('extracts clean text from uploaded multi-page resume and JD PDFs', async () => {
    const resumePdf = buildMultiLinePdf([
      [
        'Jane Doe - Full Stack Engineer',
        'Skills: TypeScript, React, Node.js, PostgreSQL, Docker',
      ],
      [
        'Work Experience: Designed distributed REST APIs serving 100k requests/day.',
        'Education: B.Tech Computer Science',
      ],
    ]);

    const result = await extractUploadedPdfText({
      buffer: resumePdf,
      originalName: 'jane_doe_resume.pdf',
      mimeType: 'application/pdf',
      documentType: 'resume',
    });

    expect(result.pageCount).toBe(2);
    expect(result.text).toContain('Jane Doe - Full Stack Engineer');
    expect(result.text).toContain('Designed distributed REST APIs');
    expect(result.charCount).toBe(result.text.length);
    expect(result.wordCount).toBeGreaterThan(10);

    const jdPdf = buildMultiLinePdf([
      [
        'Job Description: Senior Backend Developer',
        'Required: PostgreSQL query optimization, Redis caching, microservices.',
      ],
    ]);

    const jdResult = await extractUploadedPdfText({
      buffer: jdPdf,
      originalName: 'senior_backend_jd.pdf',
      mimeType: 'application/pdf',
      documentType: 'job_description',
    });

    expect(jdResult.pageCount).toBe(1);
    expect(jdResult.text).toContain('Senior Backend Developer');
    expect(jdResult.text).toContain('PostgreSQL query optimization');
  });

  it('throws descriptive PdfExtractionError for corrupted, empty, oversized, blank, and non-PDF files', async () => {
    // 1. Empty buffer
    await expect(
      extractUploadedPdfText({
        buffer: Buffer.alloc(0),
        originalName: 'empty.pdf',
        mimeType: 'application/pdf',
        documentType: 'resume',
      })
    ).rejects.toMatchObject({
      name: 'PdfExtractionError',
      code: 'EMPTY_FILE',
      statusCode: 400,
    });

    // 2. Non-PDF extension / MIME
    await expect(
      extractUploadedPdfText({
        buffer: Buffer.from('%PDF-1.4 sample', 'utf8'),
        originalName: 'resume.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        documentType: 'resume',
      })
    ).rejects.toMatchObject({
      name: 'PdfExtractionError',
      code: 'INVALID_FILE_TYPE',
      statusCode: 400,
    });

    // 3. Oversized buffer
    await expect(
      extractUploadedPdfText({
        buffer: Buffer.from('%PDF-1.4 ' + 'a'.repeat(512), 'utf8'),
        originalName: 'huge.pdf',
        mimeType: 'application/pdf',
        maxBytes: 200,
        documentType: 'job_description',
      })
    ).rejects.toMatchObject({
      name: 'PdfExtractionError',
      code: 'FILE_TOO_LARGE',
      statusCode: 400,
    });

    // 4. Missing %PDF- header (corrupted / renamed binary)
    await expect(
      extractCleanTextFromPdf(Buffer.from('NOT_A_VALID_PDF_PAYLOAD_000111222', 'utf8'), {
        documentType: 'resume',
      })
    ).rejects.toMatchObject({
      name: 'PdfExtractionError',
      code: 'CORRUPTED_PDF',
      statusCode: 400,
    });

    // 5. Truncated / corrupted internal PDF structure starting with %PDF-
    const corruptedPdf = Buffer.from(
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 99 0 R >>\nendobj\ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n999999\n%%EOF',
      'utf8'
    );
    await expect(
      extractCleanTextFromPdf(corruptedPdf, { documentType: 'job_description' })
    ).rejects.toBeInstanceOf(PdfExtractionError);

    // 6. Valid PDF structure with no selectable text (simulating scanned image-only PDF)
    const blankPdf = buildMultiLinePdf([['   ']]);
    await expect(
      extractUploadedPdfText({
        buffer: blankPdf,
        originalName: 'scanned.pdf',
        mimeType: 'application/pdf',
        documentType: 'resume',
      })
    ).rejects.toMatchObject({
      name: 'PdfExtractionError',
      code: 'UNREADABLE_CONTENT',
      statusCode: 422,
    });
  });
});
