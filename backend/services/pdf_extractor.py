"""Backend PDF text extraction utility for uploaded Resumes and Job Descriptions.

Uses `pdf-parse` (via the workspace Node runtime when installed) with seamless
support for Python PDF equivalents (`pypdf`, `pdfplumber`) in pure-Python
environments. Provides strict file validation, corrupted/encrypted PDF error
handling, and whitespace/artifact cleanup for downstream LLM and RAG pipelines.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, BinaryIO, Literal, Optional, Union

DEFAULT_MAX_PDF_BYTES = 5 * 1024 * 1024  # 5 MB
DEFAULT_MIN_EXTRACTED_CHARS = 40
PDF_PARSE_TIMEOUT_SECONDS = 30

PdfDocumentType = Literal["resume", "job_description", "general"]

ALLOWED_PDF_MIME_TYPES = frozenset(
    {
        "application/pdf",
        "application/x-pdf",
        "application/octet-stream",
    }
)

PdfExtractionErrorCode = Literal[
    "EMPTY_FILE",
    "FILE_TOO_LARGE",
    "INVALID_FILE_TYPE",
    "CORRUPTED_PDF",
    "PASSWORD_PROTECTED",
    "UNREADABLE_CONTENT",
    "PARSER_UNAVAILABLE",
    "PARSE_FAILED",
]


class PdfExtractionError(Exception):
    """Typed domain exception raised when PDF validation or extraction fails."""

    def __init__(
        self,
        message: str,
        code: PdfExtractionErrorCode,
        status_code: int = 400,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code

    def to_dict(self) -> dict[str, Any]:
        return {
            "error": self.message,
            "code": self.code,
            "statusCode": self.status_code,
        }


@dataclass(frozen=True)
class PdfExtractionResult:
    """Normalized extraction payload returned to API handlers."""

    text: str
    raw_text: str
    page_count: int
    char_count: int
    word_count: int
    document_type: PdfDocumentType
    engine: str


_NODE_PDF_PARSE_SCRIPT = r"""
import fs from 'node:fs';
import {
  PDFParse,
  VerbosityLevel,
  InvalidPDFException,
  PasswordException,
  FormatError,
  UnknownErrorException,
} from 'pdf-parse';

// Prevent third-party debug logs from corrupting stdout JSON
console.log = (...args) => console.error(...args);

async function main() {
  let parser = null;
  try {
    const passwordEnv = process.env.PDF_EXTRACT_PASSWORD;
    const rawBuffer = fs.readFileSync(0);
    parser = new PDFParse({
      data: new Uint8Array(rawBuffer),
      verbosity: VerbosityLevel.ERRORS,
      password: passwordEnv || undefined,
      stopAtErrors: true,
    });

    const result = await parser.getText();
    const rawText = typeof result?.text === 'string' ? result.text : '';
    const pageCount = Number(result?.total || result?.pages?.length || 1);

    process.stdout.write(
      JSON.stringify({
        ok: true,
        rawText,
        pageCount,
      })
    );
  } catch (err) {
    let errorType = 'PARSE_FAILED';
    if (err instanceof PasswordException || err?.name === 'PasswordException') {
      errorType = 'PASSWORD_PROTECTED';
    } else if (
      err instanceof InvalidPDFException ||
      err instanceof FormatError ||
      err instanceof UnknownErrorException ||
      err?.name === 'InvalidPDFException' ||
      err?.name === 'FormatError' ||
      err?.name === 'UnknownErrorException'
    ) {
      errorType = 'CORRUPTED_PDF';
    }

    process.stdout.write(
      JSON.stringify({
        ok: false,
        errorType,
        message: err instanceof Error ? err.message : String(err),
      })
    );
    process.exitCode = 1;
  } finally {
    if (parser) {
      try {
        await parser.destroy();
      } catch {
        // Ignore parser teardown errors
      }
    }
  }
}

main();
"""


def _get_document_label(document_type: PdfDocumentType) -> str:
    if document_type == "resume":
        return "Resume"
    if document_type == "job_description":
        return "Job Description"
    return "PDF document"


def clean_pdf_text(raw_text: str) -> str:
    """Clean extracted raw PDF text into normalized paragraphs.

    - Expands Unicode ligatures (fi, fl, ff, ffi, ffl) and invisible spaces
    - Removes NUL bytes and non-printable control characters
    - Strips pdf-parse page footer dividers (-- 1 of 2 --)
    - Rejoins soft-hyphenated line wraps while preserving paragraph structure
    - Collapses repeated spaces and excessive blank lines
    """
    if not raw_text:
        return ""

    text = raw_text
    # Normalize Unicode ligatures and special whitespace
    ligatures = {
        "\ufb00": "ff",
        "\ufb01": "fi",
        "\ufb02": "fl",
        "\ufb03": "ffi",
        "\ufb04": "ffl",
    }
    for src, target in ligatures.items():
        text = text.replace(src, target)

    text = re.sub(r"[\u00a0\u2000-\u200b\ufeff]", " ", text)
    # Normalize line endings & strip control chars except \n and \t
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)
    # Remove pdf-parse default page separators such as "-- 1 of 3 --"
    text = re.sub(r"(?m)^\s*--\s*\d+\s+of\s+\d+\s*--\s*$", "", text)
    # Rejoin soft-hyphenated words broken across lines
    text = re.sub(r"([a-z])-\n([a-z])", r"\1\2", text)
    # Normalize horizontal whitespace per line
    cleaned_lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.split("\n")]
    text = "\n".join(cleaned_lines)
    # Collapse 3+ consecutive newlines down to one blank line
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _validate_pdf_bytes(
    data: bytes,
    *,
    label: str,
    max_bytes: int,
) -> None:
    if not isinstance(data, (bytes, bytearray, memoryview)):
        raise PdfExtractionError(
            f"Expected binary bytes for the {label} PDF.",
            code="EMPTY_FILE",
            status_code=400,
        )

    raw_bytes = bytes(data)
    if len(raw_bytes) == 0:
        raise PdfExtractionError(
            f"The uploaded {label} PDF file is empty.",
            code="EMPTY_FILE",
            status_code=400,
        )

    if len(raw_bytes) > max_bytes:
        limit_mb = f"{max_bytes / (1024 * 1024):.1f}"
        actual_mb = f"{len(raw_bytes) / (1024 * 1024):.2f}"
        raise PdfExtractionError(
            f"{label} PDF exceeds the {limit_mb} MB size limit ({actual_mb} MB uploaded).",
            code="FILE_TOO_LARGE",
            status_code=400,
        )

    # Standard PDFs contain the "%PDF-" magic signature within the first 1024 bytes
    header_window = raw_bytes[:1024]
    if b"%PDF-" not in header_window:
        raise PdfExtractionError(
            f"The uploaded {label} file is corrupted or not a valid PDF document (missing %PDF- header).",
            code="CORRUPTED_PDF",
            status_code=400,
        )


def _find_node_workspace_root() -> Optional[Path]:
    """Locate a parent directory containing `node_modules/pdf-parse`."""
    candidates = [
        Path(__file__).resolve().parents[2],
        Path.cwd(),
    ]
    for root in candidates:
        if (root / "node_modules" / "pdf-parse" / "package.json").is_file():
            return root
    return None


def _extract_with_node_pdf_parse(
    data: bytes,
    *,
    label: str,
    password: Optional[str] = None,
) -> tuple[str, int]:
    node_bin = shutil.which("node")
    workspace_root = _find_node_workspace_root()
    if not node_bin or not workspace_root:
        raise PdfExtractionError(
            "pdf-parse runtime is not installed on this server.",
            code="PARSER_UNAVAILABLE",
            status_code=500,
        )

    env = os.environ.copy()
    if password:
        env["PDF_EXTRACT_PASSWORD"] = password
    else:
        env.pop("PDF_EXTRACT_PASSWORD", None)

    try:
        proc = subprocess.run(
            [node_bin, "--input-type=module", "-e", _NODE_PDF_PARSE_SCRIPT],
            input=data,
            cwd=str(workspace_root),
            env=env,
            capture_output=True,
            timeout=PDF_PARSE_TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise PdfExtractionError(
            f"Timed out while parsing the {label} PDF. The file may be corrupted or overly complex.",
            code="CORRUPTED_PDF",
            status_code=422,
        ) from exc
    except OSError as exc:
        raise PdfExtractionError(
            f"Failed to launch pdf-parse process: {exc}",
            code="PARSE_FAILED",
            status_code=500,
        ) from exc

    stdout_text = proc.stdout.decode("utf-8", errors="replace").strip()
    stderr_text = proc.stderr.decode("utf-8", errors="replace").strip()

    try:
        payload = json.loads(stdout_text) if stdout_text else {}
    except json.JSONDecodeError:
        payload = {}

    if proc.returncode == 0 and payload.get("ok") is True:
        return str(payload.get("rawText") or ""), int(payload.get("pageCount") or 1)

    error_type = str(payload.get("errorType") or "")
    detail = str(payload.get("message") or stderr_text or "Malformed PDF structure")

    if error_type == "PASSWORD_PROTECTED" or "password" in detail.lower():
        raise PdfExtractionError(
            f"This {label} PDF is password-protected or encrypted. Please upload an unlocked PDF.",
            code="PASSWORD_PROTECTED",
            status_code=422,
        )

    if error_type == "CORRUPTED_PDF" or any(
        kw in detail.lower()
        for kw in ("invalid pdf", "corrupt", "xref", "trailer", "formaterror", "unexpected end")
    ):
        raise PdfExtractionError(
            f"The {label} PDF appears to be corrupted or structurally malformed and could not be parsed.",
            code="CORRUPTED_PDF",
            status_code=422,
        )

    raise PdfExtractionError(
        f"Failed to extract text from the {label} PDF: {detail}",
        code="PARSE_FAILED",
        status_code=422,
    )


def _extract_with_pypdf(
    data: bytes,
    *,
    label: str,
    password: Optional[str] = None,
) -> tuple[str, int]:
    from io import BytesIO
    import pypdf  # type: ignore[import-not-found]

    try:
        reader = pypdf.PdfReader(BytesIO(data), strict=False)
        if reader.is_encrypted:
            if not password or reader.decrypt(password) == 0:
                raise PdfExtractionError(
                    f"This {label} PDF is password-protected or encrypted. Please upload an unlocked PDF.",
                    code="PASSWORD_PROTECTED",
                    status_code=422,
                )
        pages_text = [page.extract_text() or "" for page in reader.pages]
        return "\n\n".join(pages_text), max(1, len(reader.pages))
    except PdfExtractionError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise PdfExtractionError(
            f"The {label} PDF appears to be corrupted or structurally malformed: {exc}",
            code="CORRUPTED_PDF",
            status_code=422,
        ) from exc


def _extract_with_pdfplumber(
    data: bytes,
    *,
    label: str,
    password: Optional[str] = None,
) -> tuple[str, int]:
    from io import BytesIO
    import pdfplumber  # type: ignore[import-not-found]

    try:
        with pdfplumber.open(BytesIO(data), password=password) as pdf:
            pages_text = [page.extract_text() or "" for page in pdf.pages]
            return "\n\n".join(pages_text), max(1, len(pdf.pages))
    except Exception as exc:  # noqa: BLE001
        msg = str(exc).lower()
        if "password" in msg or "encrypted" in msg:
            raise PdfExtractionError(
                f"This {label} PDF is password-protected or encrypted. Please upload an unlocked PDF.",
                code="PASSWORD_PROTECTED",
                status_code=422,
            ) from exc
        raise PdfExtractionError(
            f"The {label} PDF appears to be corrupted or structurally malformed: {exc}",
            code="CORRUPTED_PDF",
            status_code=422,
        ) from exc


def _has_python_module(name: str) -> bool:
    try:
        __import__(name)
        return True
    except ImportError:
        return False


def extract_text_from_pdf_bytes(
    data: bytes,
    *,
    document_type: PdfDocumentType = "general",
    max_bytes: int = DEFAULT_MAX_PDF_BYTES,
    min_chars: int = DEFAULT_MIN_EXTRACTED_CHARS,
    password: Optional[str] = None,
    prefer_engine: Optional[Literal["pdf-parse", "pypdf", "pdfplumber"]] = None,
) -> PdfExtractionResult:
    """Validate and extract clean text from raw PDF bytes.

    Prefers `pdf-parse` when available in the workspace and falls back cleanly
    to `pypdf` or `pdfplumber` in Python-only deployments.
    """
    label = _get_document_label(document_type)
    _validate_pdf_bytes(data, label=label, max_bytes=max_bytes)
    raw_bytes = bytes(data)

    engines: list[str] = []
    if prefer_engine:
        engines.append(prefer_engine)
    if shutil.which("node") and _find_node_workspace_root() and "pdf-parse" not in engines:
        engines.append("pdf-parse")
    if _has_python_module("pypdf") and "pypdf" not in engines:
        engines.append("pypdf")
    if _has_python_module("pdfplumber") and "pdfplumber" not in engines:
        engines.append("pdfplumber")

    if not engines:
        raise PdfExtractionError(
            "No PDF parsing engine available. Ensure `pdf-parse` (Node) or `pypdf`/`pdfplumber` is installed.",
            code="PARSER_UNAVAILABLE",
            status_code=500,
        )

    chosen_engine = engines[0]
    if chosen_engine == "pdf-parse":
        raw_text, page_count = _extract_with_node_pdf_parse(
            raw_bytes, label=label, password=password
        )
    elif chosen_engine == "pypdf":
        raw_text, page_count = _extract_with_pypdf(
            raw_bytes, label=label, password=password
        )
    else:
        raw_text, page_count = _extract_with_pdfplumber(
            raw_bytes, label=label, password=password
        )

    cleaned_text = clean_pdf_text(raw_text)
    if len(cleaned_text) < min_chars:
        raise PdfExtractionError(
            f"Could not extract readable text from the {label} PDF ({len(cleaned_text)} chars extracted). Ensure the PDF contains selectable text rather than scanned images.",
            code="UNREADABLE_CONTENT",
            status_code=422,
        )

    word_count = len(cleaned_text.split())
    return PdfExtractionResult(
        text=cleaned_text,
        raw_text=raw_text,
        page_count=page_count,
        char_count=len(cleaned_text),
        word_count=word_count,
        document_type=document_type,
        engine=chosen_engine,
    )


def extract_uploaded_pdf_text(
    file_bytes: bytes,
    *,
    filename: Optional[str] = None,
    content_type: Optional[str] = None,
    document_type: PdfDocumentType = "general",
    max_bytes: int = DEFAULT_MAX_PDF_BYTES,
    min_chars: int = DEFAULT_MIN_EXTRACTED_CHARS,
    password: Optional[str] = None,
) -> PdfExtractionResult:
    """Validate upload metadata (.pdf extension & MIME) and extract clean PDF text."""
    label = _get_document_label(document_type)

    if filename is not None:
        normalized_name = filename.strip().lower()
        if not normalized_name.endswith(".pdf"):
            raise PdfExtractionError(
                f"Invalid {label} file format. Only .pdf files are accepted.",
                code="INVALID_FILE_TYPE",
                status_code=400,
            )

    if content_type is not None and content_type.strip() != "":
        normalized_mime = content_type.split(";")[0].strip().lower()
        if normalized_mime not in ALLOWED_PDF_MIME_TYPES:
            raise PdfExtractionError(
                f"Invalid {label} MIME type ({normalized_mime}). Expected application/pdf.",
                code="INVALID_FILE_TYPE",
                status_code=400,
            )

    return extract_text_from_pdf_bytes(
        file_bytes,
        document_type=document_type,
        max_bytes=max_bytes,
        min_chars=min_chars,
        password=password,
    )


def extract_resume_pdf_text(
    file_bytes: bytes,
    *,
    filename: Optional[str] = None,
    content_type: Optional[str] = None,
    max_bytes: int = DEFAULT_MAX_PDF_BYTES,
    min_chars: int = DEFAULT_MIN_EXTRACTED_CHARS,
    password: Optional[str] = None,
) -> PdfExtractionResult:
    """Extract cleaned text content from a user-uploaded Resume PDF."""
    return extract_uploaded_pdf_text(
        file_bytes,
        filename=filename,
        content_type=content_type,
        document_type="resume",
        max_bytes=max_bytes,
        min_chars=min_chars,
        password=password,
    )


def extract_job_description_pdf_text(
    file_bytes: bytes,
    *,
    filename: Optional[str] = None,
    content_type: Optional[str] = None,
    max_bytes: int = DEFAULT_MAX_PDF_BYTES,
    min_chars: int = DEFAULT_MIN_EXTRACTED_CHARS,
    password: Optional[str] = None,
) -> PdfExtractionResult:
    """Extract cleaned text content from a user-uploaded Job Description PDF."""
    return extract_uploaded_pdf_text(
        file_bytes,
        filename=filename,
        content_type=content_type,
        document_type="job_description",
        max_bytes=max_bytes,
        min_chars=min_chars,
        password=password,
    )


def extract_text_from_pdf_file(
    file_path: Union[str, Path],
    *,
    document_type: PdfDocumentType = "general",
    max_bytes: int = DEFAULT_MAX_PDF_BYTES,
    min_chars: int = DEFAULT_MIN_EXTRACTED_CHARS,
    password: Optional[str] = None,
) -> PdfExtractionResult:
    """Read a PDF file from disk and extract cleaned text."""
    path = Path(file_path)
    label = _get_document_label(document_type)
    if not path.is_file():
        raise PdfExtractionError(
            f"{label} PDF file not found at path: {path}",
            code="EMPTY_FILE",
            status_code=400,
        )

    try:
        raw_bytes = path.read_bytes()
    except OSError as exc:
        raise PdfExtractionError(
            f"Unable to read {label} PDF file at {path}: {exc}",
            code="PARSE_FAILED",
            status_code=422,
        ) from exc

    return extract_uploaded_pdf_text(
        raw_bytes,
        filename=path.name,
        document_type=document_type,
        max_bytes=max_bytes,
        min_chars=min_chars,
        password=password,
    )


async def extract_upload_file_text(
    upload_file: Any,
    *,
    document_type: PdfDocumentType = "general",
    max_bytes: int = DEFAULT_MAX_PDF_BYTES,
    min_chars: int = DEFAULT_MIN_EXTRACTED_CHARS,
    password: Optional[str] = None,
) -> PdfExtractionResult:
    """Async adapter for FastAPI `UploadFile` or standard binary file-like objects."""
    filename = getattr(upload_file, "filename", None)
    content_type = getattr(upload_file, "content_type", None)

    read_fn = getattr(upload_file, "read", None)
    if callable(read_fn):
        maybe_coro = read_fn()
        raw_data = await maybe_coro if inspect.isawaitable(maybe_coro) else maybe_coro
    elif hasattr(upload_file, "file") and hasattr(upload_file.file, "read"):
        raw_data = upload_file.file.read()
    else:
        raise PdfExtractionError(
            "Unsupported upload object: expected an UploadFile or readable binary stream.",
            code="EMPTY_FILE",
            status_code=400,
        )

    return await asyncio.to_thread(
        extract_uploaded_pdf_text,
        raw_data,
        filename=filename,
        content_type=content_type,
        document_type=document_type,
        max_bytes=max_bytes,
        min_chars=min_chars,
        password=password,
    )


PdfSource = Union[str, os.PathLike[str], BinaryIO, bytes, bytearray, memoryview]


def _read_source_bytes(
    source: PdfSource,
    *,
    label: str,
) -> tuple[bytes, Optional[str], Optional[str]]:
    """Resolve bytes and optional filename/MIME metadata from a path, file-like object, or buffer."""
    if isinstance(source, (str, os.PathLike)):
        path = Path(source)
        if not path.is_file():
            raise PdfExtractionError(
                f"{label} PDF file not found at path: {path}",
                code="EMPTY_FILE",
                status_code=400,
            )
        try:
            return path.read_bytes(), path.name, None
        except OSError as exc:
            raise PdfExtractionError(
                f"Unable to read {label} PDF file at {path}: {exc}",
                code="PARSE_FAILED",
                status_code=422,
            ) from exc

    if isinstance(source, (bytes, bytearray, memoryview)):
        return bytes(source), None, None

    stream = getattr(source, "file", source)
    read_fn = getattr(stream, "read", None)
    if not callable(read_fn):
        raise PdfExtractionError(
            "Unsupported PDF source: expected a file path, binary file-like object, or bytes.",
            code="INVALID_FILE_TYPE",
            status_code=400,
        )

    try:
        seekable_fn = getattr(stream, "seekable", None)
        seek_fn = getattr(stream, "seek", None)
        if callable(seek_fn) and (not callable(seekable_fn) or seekable_fn()):
            seek_fn(0)
        raw_data = read_fn()
    except (OSError, ValueError) as exc:
        raise PdfExtractionError(
            f"Unable to read {label} PDF stream: {exc}",
            code="PARSE_FAILED",
            status_code=422,
        ) from exc

    if isinstance(raw_data, str):
        raise PdfExtractionError(
            f"Expected binary file-like object for {label} PDF (opened in 'rb' mode).",
            code="INVALID_FILE_TYPE",
            status_code=400,
        )
    if not isinstance(raw_data, (bytes, bytearray, memoryview)):
        raise PdfExtractionError(
            f"PDF stream read() returned unexpected type {type(raw_data).__name__}; expected bytes.",
            code="EMPTY_FILE",
            status_code=400,
        )

    filename: Optional[str] = getattr(source, "filename", None)
    if filename is None:
        stream_name = getattr(stream, "name", None)
        if isinstance(stream_name, str) and Path(stream_name).suffix:
            filename = Path(stream_name).name
    content_type: Optional[str] = getattr(source, "content_type", None)

    return bytes(raw_data), filename, content_type


def extract_pdf(
    source: PdfSource,
    *,
    document_type: PdfDocumentType = "general",
    max_bytes: int = DEFAULT_MAX_PDF_BYTES,
    min_chars: int = DEFAULT_MIN_EXTRACTED_CHARS,
    password: Optional[str] = None,
) -> PdfExtractionResult:
    """Extract cleaned text and metadata from a PDF file path, file-like object, or raw bytes."""
    label = _get_document_label(document_type)
    raw_bytes, filename, content_type = _read_source_bytes(source, label=label)
    return extract_uploaded_pdf_text(
        raw_bytes,
        filename=filename,
        content_type=content_type,
        document_type=document_type,
        max_bytes=max_bytes,
        min_chars=min_chars,
        password=password,
    )


def extract_text_from_pdf(
    source: PdfSource,
    *,
    document_type: PdfDocumentType = "general",
    max_bytes: int = DEFAULT_MAX_PDF_BYTES,
    min_chars: int = DEFAULT_MIN_EXTRACTED_CHARS,
    password: Optional[str] = None,
) -> str:
    """Extract and strip text from a PDF file-like object or path using `pdf-parse`."""
    return extract_pdf(
        source,
        document_type=document_type,
        max_bytes=max_bytes,
        min_chars=min_chars,
        password=password,
    ).text

