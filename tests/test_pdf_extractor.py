import io
import tempfile
import unittest
from pathlib import Path

from backend.services.pdf_extractor import (
    PdfExtractionError,
    clean_pdf_text,
    extract_job_description_pdf_text,
    extract_pdf,
    extract_resume_pdf_text,
    extract_text_from_pdf,
    extract_text_from_pdf_bytes,
    extract_text_from_pdf_file,
    extract_upload_file_text,
    extract_uploaded_pdf_text,
)


def build_multi_line_pdf(pages: list[list[str]]) -> bytes:
    """Construct a valid multi-page uncompressed PDF 1.4 document with accurate xref offsets."""
    objects: list[str] = [
        "",  # 1: Catalog
        "",  # 2: Pages
        "3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    ]
    page_obj_nums: list[int] = []
    next_obj = 4

    for lines in pages:
        content_obj_num = next_obj
        next_obj += 1
        page_obj_num = next_obj
        next_obj += 1
        page_obj_nums.append(page_obj_num)

        escaped_ops: list[str] = []
        for idx, line in enumerate(lines):
            safe = (
                line.replace("\\", "\\\\")
                .replace("(", "\\(")
                .replace(")", "\\)")
            )
            suffix = " 0 -16 Td" if idx < len(lines) - 1 else ""
            escaped_ops.append(f"({safe}) Tj{suffix}")

        stream = "BT\n/F1 12 Tf\n50 740 Td\n" + "\n".join(escaped_ops) + "\nET\n"
        stream_bytes_len = len(stream.encode("utf-8"))

        while len(objects) < page_obj_num:
            objects.append("")

        objects[content_obj_num - 1] = (
            f"{content_obj_num} 0 obj\n"
            f"<< /Length {stream_bytes_len} >>\n"
            f"stream\n{stream}endstream\nendobj\n"
        )
        objects[page_obj_num - 1] = (
            f"{page_obj_num} 0 obj\n"
            f"<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 3 0 R >> >> "
            f"/MediaBox [0 0 612 792] /Contents {content_obj_num} 0 R >>\n"
            f"endobj\n"
        )

    objects[0] = "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"
    kids = " ".join(f"{n} 0 R" for n in page_obj_nums)
    objects[1] = (
        f"2 0 obj\n<< /Type /Pages /Kids [{kids}] /Count {len(page_obj_nums)} >>\nendobj\n"
    )

    chunks: list[bytes] = [b"%PDF-1.4\n"]
    offsets: list[int] = [0]
    current_len = len(chunks[0])

    for obj in objects:
        offsets.append(current_len)
        encoded = obj.encode("utf-8")
        chunks.append(encoded)
        current_len += len(encoded)

    xref_start = current_len
    xref_lines = [
        f"xref\n0 {len(objects) + 1}\n",
        "0000000000 65535 f \n",
    ]
    for offset in offsets[1:]:
        xref_lines.append(f"{offset:010d} 00000 n \n")
    xref_lines.append(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_start}\n%%EOF\n"
    )
    chunks.append("".join(xref_lines).encode("utf-8"))
    return b"".join(chunks)


class _DummyAsyncUploadFile:
    def __init__(self, payload: bytes, filename: str, content_type: str) -> None:
        self._payload = payload
        self.filename = filename
        self.content_type = content_type

    async def read(self) -> bytes:
        return self._payload


class _DummySyncUploadFile:
    def __init__(self, payload: bytes, filename: str, content_type: str) -> None:
        self.file = io.BytesIO(payload)
        self.filename = filename
        self.content_type = content_type


class PdfExtractorTests(unittest.IsolatedAsyncioTestCase):
    def test_clean_pdf_text_normalizes_ligatures_hyphens_and_whitespace(self) -> None:
        raw = (
            "Senior   Engineer\x00\r\n\r\n"
            "Built   micro-\nservices  for   \ufb01nancial   work\ufb02ows.\n\n\n\n"
            "-- 1 of 2 --\n"
            "Experience:\u00a0\u200b 4 years"
        )
        cleaned = clean_pdf_text(raw)
        self.assertEqual(
            cleaned,
            "Senior Engineer\n\nBuilt microservices for financial workflows.\n\nExperience: 4 years",
        )

    def test_extracts_resume_and_jd_pdfs_cleanly(self) -> None:
        resume_pdf = build_multi_line_pdf(
            [
                [
                    "Jane Doe - Full Stack Engineer",
                    "Skills: TypeScript, React, Node.js, PostgreSQL, Docker",
                ],
                [
                    "Work Experience: Designed distributed REST APIs serving 100k requests/day.",
                    "Education: B.Tech Computer Science",
                ],
            ]
        )

        resume_result = extract_resume_pdf_text(
            resume_pdf,
            filename="jane_doe_resume.pdf",
            content_type="application/pdf",
        )
        self.assertEqual(resume_result.engine, "pdf-parse")
        self.assertEqual(resume_result.document_type, "resume")
        self.assertEqual(resume_result.page_count, 2)
        self.assertIn("Jane Doe - Full Stack Engineer", resume_result.text)
        self.assertIn("Designed distributed REST APIs", resume_result.text)
        self.assertEqual(resume_result.char_count, len(resume_result.text))
        self.assertGreater(resume_result.word_count, 10)

        jd_pdf = build_multi_line_pdf(
            [
                [
                    "Job Description: Senior Backend Developer",
                    "Required: PostgreSQL query optimization, Redis caching, microservices.",
                ]
            ]
        )
        jd_result = extract_job_description_pdf_text(
            jd_pdf,
            filename="senior_backend_jd.pdf",
            content_type="application/pdf; charset=binary",
        )
        self.assertEqual(jd_result.engine, "pdf-parse")
        self.assertEqual(jd_result.document_type, "job_description")
        self.assertEqual(jd_result.page_count, 1)
        self.assertIn("Senior Backend Developer", jd_result.text)
        self.assertIn("PostgreSQL query optimization", jd_result.text)

    def test_extract_text_from_pdf_file_and_missing_file(self) -> None:
        jd_pdf = build_multi_line_pdf(
            [
                [
                    "Backend Platform Engineer Job Description",
                    "Responsibilities: Build scalable APIs in Python and TypeScript.",
                ]
            ]
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            pdf_path = Path(tmpdir) / "platform_jd.pdf"
            pdf_path.write_bytes(jd_pdf)

            result = extract_text_from_pdf_file(
                pdf_path,
                document_type="job_description",
            )
            self.assertEqual(result.document_type, "job_description")
            self.assertIn("Backend Platform Engineer", result.text)

            with self.assertRaises(PdfExtractionError) as missing_ctx:
                extract_text_from_pdf_file(Path(tmpdir) / "does_not_exist.pdf")
            self.assertEqual(missing_ctx.exception.code, "EMPTY_FILE")
            self.assertEqual(missing_ctx.exception.status_code, 400)

    async def test_async_upload_adapters_work(self) -> None:
        resume_pdf = build_multi_line_pdf(
            [
                [
                    "Alex Rivera - Machine Learning Engineer",
                    "Experience: Built RAG pipelines, FastAPI services, and retrieval benchmarks.",
                ]
            ]
        )
        async_upload = _DummyAsyncUploadFile(
            resume_pdf, filename="alex_resume.pdf", content_type="application/pdf"
        )
        async_res = await extract_upload_file_text(async_upload, document_type="resume")
        self.assertIn("Alex Rivera", async_res.text)
        self.assertEqual(async_res.document_type, "resume")

        sync_upload = _DummySyncUploadFile(
            resume_pdf, filename="alex_resume_sync.pdf", content_type="application/octet-stream"
        )
        sync_res = await extract_upload_file_text(sync_upload, document_type="resume")
        self.assertIn("Machine Learning Engineer", sync_res.text)

    def test_error_handling_for_empty_invalid_oversized_corrupted_and_blank_pdfs(self) -> None:
        # 1. Empty payload
        with self.assertRaises(PdfExtractionError) as empty_ctx:
            extract_resume_pdf_text(b"", filename="empty.pdf", content_type="application/pdf")
        self.assertEqual(empty_ctx.exception.code, "EMPTY_FILE")
        self.assertEqual(empty_ctx.exception.status_code, 400)
        self.assertEqual(empty_ctx.exception.to_dict()["code"], "EMPTY_FILE")

        # 2. Invalid extension
        with self.assertRaises(PdfExtractionError) as ext_ctx:
            extract_resume_pdf_text(
                b"%PDF-1.4 sample",
                filename="resume.docx",
                content_type="application/pdf",
            )
        self.assertEqual(ext_ctx.exception.code, "INVALID_FILE_TYPE")
        self.assertEqual(ext_ctx.exception.status_code, 400)

        # 3. Invalid MIME type
        with self.assertRaises(PdfExtractionError) as mime_ctx:
            extract_uploaded_pdf_text(
                b"%PDF-1.4 sample",
                filename="jd.pdf",
                content_type="text/plain",
                document_type="job_description",
            )
        self.assertEqual(mime_ctx.exception.code, "INVALID_FILE_TYPE")
        self.assertEqual(mime_ctx.exception.status_code, 400)

        # 4. Oversized payload
        with self.assertRaises(PdfExtractionError) as size_ctx:
            extract_job_description_pdf_text(
                b"%PDF-1.4 " + b"a" * 512,
                filename="huge.pdf",
                content_type="application/pdf",
                max_bytes=200,
            )
        self.assertEqual(size_ctx.exception.code, "FILE_TOO_LARGE")
        self.assertEqual(size_ctx.exception.status_code, 400)

        # 5. Missing %PDF- header
        with self.assertRaises(PdfExtractionError) as magic_ctx:
            extract_text_from_pdf_bytes(
                b"NOT_A_VALID_PDF_PAYLOAD_000111222",
                document_type="resume",
            )
        self.assertEqual(magic_ctx.exception.code, "CORRUPTED_PDF")
        self.assertEqual(magic_ctx.exception.status_code, 400)

        # 6. Structurally corrupted PDF internal xref/objects
        corrupted_pdf = (
            b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 99 0 R >>\nendobj\n"
            b"trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n999999\n%%EOF"
        )
        with self.assertRaises(PdfExtractionError) as corrupt_ctx:
            extract_text_from_pdf_bytes(corrupted_pdf, document_type="job_description")
        self.assertIn(corrupt_ctx.exception.code, ("CORRUPTED_PDF", "PARSE_FAILED"))
        self.assertEqual(corrupt_ctx.exception.status_code, 422)

        # 7. Valid PDF structure with no selectable text (scanned/image-only simulation)
        blank_pdf = build_multi_line_pdf([["   "]])
        with self.assertRaises(PdfExtractionError) as blank_ctx:
            extract_resume_pdf_text(
                blank_pdf,
                filename="scanned.pdf",
                content_type="application/pdf",
            )
        self.assertEqual(blank_ctx.exception.code, "UNREADABLE_CONTENT")
        self.assertEqual(blank_ctx.exception.status_code, 422)

    def test_extract_text_from_pdf_accepts_file_like_objects_and_paths(self) -> None:
        sample_pdf = build_multi_line_pdf(
            [
                [
                    "   Jordan Lee - Cloud Security Engineer   ",
                    "Skills: Python, Kubernetes, Terraform, AWS IAM, Zero Trust",
                ]
            ]
        )

        # 1. File-like BytesIO even when positioned mid-stream
        stream = io.BytesIO(sample_pdf)
        stream.read(12)
        text_from_stream = extract_text_from_pdf(stream, document_type="resume")
        self.assertEqual(text_from_stream, text_from_stream.strip())
        self.assertIn("Jordan Lee - Cloud Security Engineer", text_from_stream)
        self.assertIn("Kubernetes, Terraform, AWS IAM", text_from_stream)

        # 2. Path string, Path object, and opened binary file handle
        with tempfile.TemporaryDirectory() as tmpdir:
            pdf_path = Path(tmpdir) / "jordan_resume.pdf"
            pdf_path.write_bytes(sample_pdf)

            self.assertIn("Jordan Lee", extract_text_from_pdf(str(pdf_path)))
            res_obj = extract_pdf(pdf_path, document_type="resume")
            self.assertEqual(res_obj.engine, "pdf-parse")
            self.assertEqual(res_obj.text, text_from_stream)

            with open(pdf_path, "rb") as fh:
                self.assertEqual(extract_text_from_pdf(fh), text_from_stream)

        # 3. Text-mode stream, closed stream, and corrupted BytesIO raise PdfExtractionError
        with self.assertRaises(PdfExtractionError) as text_stream_ctx:
            extract_text_from_pdf(io.StringIO("not binary"))  # type: ignore[arg-type]
        self.assertEqual(text_stream_ctx.exception.code, "INVALID_FILE_TYPE")

        closed_stream = io.BytesIO(sample_pdf)
        closed_stream.close()
        with self.assertRaises(PdfExtractionError) as closed_ctx:
            extract_text_from_pdf(closed_stream)
        self.assertEqual(closed_ctx.exception.code, "PARSE_FAILED")

        with self.assertRaises(PdfExtractionError) as corrupt_stream_ctx:
            extract_text_from_pdf(io.BytesIO(b"%PDF-1.4\ncorrupted-object-stream"))
        self.assertIn(corrupt_stream_ctx.exception.code, ("CORRUPTED_PDF", "PARSE_FAILED"))


if __name__ == "__main__":
    unittest.main()
