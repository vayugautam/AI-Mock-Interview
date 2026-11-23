"""Unit tests for FastAPI JD & Resume upload routes, file integrity checks, and user isolation."""

from __future__ import annotations

import hashlib
import importlib
import sys
import tempfile
import types
import unittest
from pathlib import Path
from typing import Any

from tests.test_pdf_extractor import build_multi_line_pdf


def _install_fastapi_test_shims_if_missing() -> None:
    """Provide minimal FastAPI/Pydantic shims only when not installed in Python env."""
    if "fastapi" not in sys.modules:
        fastapi_mod = types.ModuleType("fastapi")

        class HTTPException(Exception):
            def __init__(
                self,
                status_code: int,
                detail: Any = None,
                headers: dict[str, str] | None = None,
            ) -> None:
                super().__init__(str(detail))
                self.status_code = status_code
                self.detail = detail
                self.headers = headers or {}

        class APIRouter:
            def __init__(self, prefix: str = "", tags: list[str] | None = None) -> None:
                self.prefix = prefix
                self.tags = tags or []
                self.routes: list[dict[str, Any]] = []

            def _add(self, method: str, path: str, **kwargs: Any):
                def decorator(fn):
                    self.routes.append(
                        {"method": method, "path": f"{self.prefix}{path}", "fn": fn, **kwargs}
                    )
                    return fn

                return decorator

            def post(self, path: str, **kwargs: Any):
                return self._add("POST", path, **kwargs)

            def get(self, path: str, **kwargs: Any):
                return self._add("GET", path, **kwargs)

            def delete(self, path: str, **kwargs: Any):
                return self._add("DELETE", path, **kwargs)

        class FastAPI:
            def __init__(self, **kwargs: Any) -> None:
                self.meta = kwargs
                self.state = types.SimpleNamespace()
                self.routes: list[dict[str, Any]] = []

            def include_router(self, router: APIRouter) -> None:
                self.routes.extend(router.routes)

            def get(self, path: str, **kwargs: Any):
                def decorator(fn):
                    self.routes.append({"method": "GET", "path": path, "fn": fn, **kwargs})
                    return fn

                return decorator

        class UploadFile:
            def __init__(
                self,
                *,
                filename: str | None = None,
                content_type: str | None = None,
                content: bytes = b"",
            ) -> None:
                self.filename = filename
                self.content_type = content_type
                self._content = content
                self._offset = 0

            async def read(self, size: int = -1) -> bytes:
                if size is None or size < 0:
                    chunk = self._content[self._offset :]
                    self._offset = len(self._content)
                    return chunk
                chunk = self._content[self._offset : self._offset + size]
                self._offset += len(chunk)
                return chunk

        class Request:
            def __init__(self, app: Any = None) -> None:
                self.app = app

        status_ns = types.SimpleNamespace(
            HTTP_200_OK=200,
            HTTP_201_CREATED=201,
            HTTP_400_BAD_REQUEST=400,
            HTTP_401_UNAUTHORIZED=401,
            HTTP_403_FORBIDDEN=403,
            HTTP_404_NOT_FOUND=404,
            HTTP_422_UNPROCESSABLE_ENTITY=422,
        )

        fastapi_mod.APIRouter = APIRouter  # type: ignore[attr-defined]
        fastapi_mod.FastAPI = FastAPI  # type: ignore[attr-defined]
        fastapi_mod.UploadFile = UploadFile  # type: ignore[attr-defined]
        fastapi_mod.Request = Request  # type: ignore[attr-defined]
        fastapi_mod.HTTPException = HTTPException  # type: ignore[attr-defined]
        fastapi_mod.Depends = lambda dep: dep  # type: ignore[attr-defined]
        fastapi_mod.File = lambda default=...: default  # type: ignore[attr-defined]
        fastapi_mod.Form = lambda default=...: default  # type: ignore[attr-defined]
        fastapi_mod.Header = lambda default=None: default  # type: ignore[attr-defined]
        fastapi_mod.Query = lambda default=None: default  # type: ignore[attr-defined]
        fastapi_mod.status = status_ns  # type: ignore[attr-defined]
        sys.modules["fastapi"] = fastapi_mod

    if "pydantic" not in sys.modules:
        pydantic_mod = types.ModuleType("pydantic")

        class BaseModel:
            def __init__(self, **kwargs: Any) -> None:
                for k, v in kwargs.items():
                    setattr(self, k, v)

        def Field(default: Any = ..., **_: Any) -> Any:
            if callable(default):
                return default()
            return None if default is ... else default

        pydantic_mod.BaseModel = BaseModel  # type: ignore[attr-defined]
        pydantic_mod.Field = Field  # type: ignore[attr-defined]
        sys.modules["pydantic"] = pydantic_mod


_install_fastapi_test_shims_if_missing()

from fastapi import HTTPException, UploadFile  # noqa: E402

auth_mod = importlib.import_module("backend.services.auth_dependency")
doc_service_mod = importlib.import_module("backend.services.document_service")
routes_mod = importlib.import_module("backend.routes.documents")
main_mod = importlib.import_module("backend.main")


class FastApiDocumentRoutesTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self.data_dir = Path(self._tmpdir.name)
        self.app = main_mod.create_fastapi_app(self.data_dir)
        self.session_store = self.app.state.session_store
        self.doc_repo = self.app.state.document_repo

        self.alice_token = self.session_store.issue_token_for_user(
            user_id="usr_alice",
            name="Alice Sharma",
            email="alice@example.edu",
        )
        self.bob_token = self.session_store.issue_token_for_user(
            user_id="usr_bob",
            name="Bob Patel",
            email="bob@example.edu",
        )

    async def asyncTearDown(self) -> None:
        self._tmpdir.cleanup()

    async def test_authentication_dependency_rejects_missing_or_invalid_bearer_tokens(self) -> None:
        with self.assertRaises(HTTPException) as missing_ctx:
            await auth_mod.get_current_user(authorization=None, session_store=self.session_store)
        self.assertEqual(missing_ctx.exception.status_code, 401)

        with self.assertRaises(HTTPException) as bad_scheme_ctx:
            await auth_mod.get_current_user(
                authorization="Basic abc123", session_store=self.session_store
            )
        self.assertEqual(bad_scheme_ctx.exception.status_code, 401)

        with self.assertRaises(HTTPException) as invalid_tok_ctx:
            await auth_mod.get_current_user(
                authorization="Bearer tok_nonexistent", session_store=self.session_store
            )
        self.assertEqual(invalid_tok_ctx.exception.status_code, 401)

        user = await auth_mod.get_current_user(
            authorization=f"Bearer {self.alice_token}", session_store=self.session_store
        )
        self.assertEqual(user.id, "usr_alice")
        self.assertEqual(user.email, "alice@example.edu")

    async def test_jd_and_resume_uploads_validate_integrity_and_bind_to_user(self) -> None:
        alice = await auth_mod.get_current_user(
            authorization=f"Bearer {self.alice_token}", session_store=self.session_store
        )
        bob = await auth_mod.get_current_user(
            authorization=f"Bearer {self.bob_token}", session_store=self.session_store
        )

        jd_bytes = build_multi_line_pdf(
            [
                [
                    "Job Title: Senior Backend Python Engineer",
                    "Required: 3+ years Python, FastAPI, PostgreSQL, Docker, REST API.",
                ]
            ]
        )
        resume_bytes = build_multi_line_pdf(
            [
                [
                    "Alice Sharma - Software Engineer",
                    "Skills: Python, FastAPI, PostgreSQL, Docker, React",
                    "Education: B.Tech Computer Science",
                ]
            ]
        )

        jd_upload = UploadFile(
            filename="backend_jd.pdf",
            content_type="application/pdf",
            content=jd_bytes,
        )
        jd_resp = await routes_mod.upload_jd_pdf(
            file=jd_upload,
            enableWebResearch=False,
            current_user=alice,
            doc_repo=self.doc_repo,
            session_store=self.session_store,
        )
        jd_doc = jd_resp["document"]
        self.assertEqual(jd_doc["userId"], "usr_alice")
        self.assertEqual(jd_doc["docType"], "jd")
        self.assertEqual(jd_doc["fileName"], "backend_jd.pdf")
        self.assertEqual(jd_doc["contentSha256"], hashlib.sha256(jd_bytes).hexdigest())
        self.assertIn("Senior Backend Python Engineer", jd_doc["normalizedText"])
        self.assertIn("FastAPI", jd_doc["analysis"]["requiredTechnicalSkills"])

        resume_upload = UploadFile(
            filename="alice_resume.pdf",
            content_type="application/pdf",
            content=resume_bytes,
        )
        res_resp = await routes_mod.upload_resume_pdf(
            file=resume_upload,
            current_user=alice,
            doc_repo=self.doc_repo,
            session_store=self.session_store,
        )
        res_doc = res_resp["document"]
        self.assertEqual(res_doc["userId"], "usr_alice")
        self.assertEqual(res_doc["docType"], "resume")
        self.assertEqual(res_doc["contentSha256"], hashlib.sha256(resume_bytes).hexdigest())
        self.assertIn("Python", res_doc["analysis"]["candidateSkills"])

        # Re-fetch Alice's current principal to confirm active pointers persisted
        alice_refreshed = await auth_mod.get_current_user(
            authorization=f"Bearer {self.alice_token}", session_store=self.session_store
        )
        self.assertEqual(alice_refreshed.active_jd_id, jd_doc["id"])
        self.assertEqual(alice_refreshed.active_resume_id, res_doc["id"])

        current = await routes_mod.get_current_documents(
            current_user=alice_refreshed, doc_repo=self.doc_repo
        )
        self.assertEqual(current["jd"]["id"], jd_doc["id"])
        self.assertEqual(current["resume"]["id"], res_doc["id"])

        # Cross-user isolation: Bob cannot view or delete Alice's documents
        bob_current = await routes_mod.get_current_documents(
            current_user=bob, doc_repo=self.doc_repo
        )
        self.assertIsNone(bob_current["jd"])
        self.assertIsNone(bob_current["resume"])

        with self.assertRaises(HTTPException) as forbidden_get:
            await routes_mod.get_document_by_id(
                document_id=res_doc["id"], current_user=bob, doc_repo=self.doc_repo
            )
        self.assertEqual(forbidden_get.exception.status_code, 403)

        with self.assertRaises(HTTPException) as forbidden_del:
            await routes_mod.delete_document_by_id(
                document_id=res_doc["id"],
                current_user=bob,
                doc_repo=self.doc_repo,
                session_store=self.session_store,
            )
        self.assertEqual(forbidden_del.exception.status_code, 403)

        # Alice can delete her own JD and her active pointer cleanly resets
        deleted = await routes_mod.delete_document_by_id(
            document_id=jd_doc["id"],
            current_user=alice_refreshed,
            doc_repo=self.doc_repo,
            session_store=self.session_store,
        )
        self.assertEqual(deleted["deletedId"], jd_doc["id"])
        with self.assertRaises(HTTPException) as missing_after_del:
            await routes_mod.get_document_by_id(
                document_id=jd_doc["id"], current_user=alice_refreshed, doc_repo=self.doc_repo
            )
        self.assertEqual(missing_after_del.exception.status_code, 404)

    async def test_file_integrity_validation_rejects_traversal_truncated_corrupted_and_invalid_text(self) -> None:
        alice = await auth_mod.get_current_user(
            authorization=f"Bearer {self.alice_token}", session_store=self.session_store
        )

        # 1. Path traversal filename
        traversal_file = UploadFile(
            filename="../../etc/passwd.pdf",
            content_type="application/pdf",
            content=b"%PDF-1.4\n%%EOF",
        )
        with self.assertRaises(HTTPException) as trav_ctx:
            await routes_mod.upload_resume_pdf(
                file=traversal_file,
                current_user=alice,
                doc_repo=self.doc_repo,
                session_store=self.session_store,
            )
        self.assertEqual(trav_ctx.exception.status_code, 400)
        self.assertEqual(trav_ctx.exception.detail["code"], "INVALID_FILENAME")

        # 2. Truncated PDF missing %%EOF trailer
        truncated_file = UploadFile(
            filename="truncated.pdf",
            content_type="application/pdf",
            content=b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n",
        )
        with self.assertRaises(HTTPException) as trunc_ctx:
            await routes_mod.upload_jd_pdf(
                file=truncated_file,
                enableWebResearch=False,
                current_user=alice,
                doc_repo=self.doc_repo,
                session_store=self.session_store,
            )
        self.assertEqual(trunc_ctx.exception.status_code, 422)
        self.assertEqual(trunc_ctx.exception.detail["code"], "CORRUPTED_PDF")

        # 3. Corrupted xref PDF containing %PDF- and %%EOF
        corrupted_file = UploadFile(
            filename="corrupted.pdf",
            content_type="application/pdf",
            content=b"%PDF-1.4\n1 0 obj\n<< /Pages 99 0 R >>\nendobj\nstartxref\n99999\n%%EOF",
        )
        with self.assertRaises(HTTPException) as corrupt_ctx:
            await routes_mod.upload_resume_pdf(
                file=corrupted_file,
                current_user=alice,
                doc_repo=self.doc_repo,
                session_store=self.session_store,
            )
        self.assertEqual(corrupt_ctx.exception.status_code, 422)

        # 4. Short JD text submission rejected
        with self.assertRaises(HTTPException) as short_text_ctx:
            await routes_mod.submit_jd_text(
                payload=routes_mod.JdTextUploadRequest(text="Too short", enableWebResearch=False),
                current_user=alice,
                doc_repo=self.doc_repo,
                session_store=self.session_store,
            )
        self.assertEqual(short_text_ctx.exception.status_code, 400)
        self.assertEqual(short_text_ctx.exception.detail["code"], "TEXT_TOO_SHORT")

        # 5. Valid JD text accepted and associated with Alice
        valid_text_resp = await routes_mod.submit_jd_text(
            payload=routes_mod.JdTextUploadRequest(
                text="Job Title: Full Stack Developer\nRequired: TypeScript, React, Python, PostgreSQL, Docker experience.",
                enableWebResearch=False,
            ),
            current_user=alice,
            doc_repo=self.doc_repo,
            session_store=self.session_store,
        )
        self.assertEqual(valid_text_resp["document"]["sourceType"], "text")
        self.assertEqual(valid_text_resp["document"]["userId"], "usr_alice")
        self.assertGreaterEqual(valid_text_resp["document"]["chunkCount"], 1)

        # Verify FastAPI router registered all expected endpoints
        route_signatures = {(r["method"], r["path"]) for r in self.app.routes}
        self.assertIn(("POST", "/api/documents/jd/upload-pdf"), route_signatures)
        self.assertIn(("POST", "/api/documents/jd/text"), route_signatures)
        self.assertIn(("POST", "/api/documents/resume/upload-pdf"), route_signatures)
        self.assertIn(("GET", "/api/documents/current"), route_signatures)
        self.assertIn(("GET", "/api/documents"), route_signatures)
        self.assertIn(("GET", "/api/documents/{document_id}"), route_signatures)
        self.assertIn(("DELETE", "/api/documents/{document_id}"), route_signatures)


if __name__ == "__main__":
    unittest.main()
