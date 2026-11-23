from types import SimpleNamespace

from pypdf.errors import PdfReadError

from app.services import resume_service


def auth_headers(client, email: str) -> dict[str, str]:
    payload = {"email": email, "password": "Correct Horse Battery Staple"}
    assert client.post("/api/v1/auth/register", json=payload).status_code == 201
    token = client.post("/api/v1/auth/login", json=payload).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_uploads_valid_pdf_and_returns_metadata(client, tmp_path, monkeypatch):
    class Page:
        def extract_text(self):
            return "Candidate experience and skills"

    class Reader:
        is_encrypted = False
        pages = [Page()]

    monkeypatch.setattr(resume_service, "PdfReader", lambda path, strict=True: Reader())
    settings = SimpleNamespace(resume_storage_dir=str(tmp_path), resume_max_size_bytes=1024)
    monkeypatch.setattr("app.api.routes.resumes.get_settings", lambda: settings)
    headers = auth_headers(client, "candidate@example.com")

    response = client.post(
        "/api/v1/resumes/upload",
        headers=headers,
        files={"file": ("resume.pdf", b"%PDF-1.7\ncontent", "application/pdf")},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["original_filename"] == "resume.pdf"
    assert body["content_type"] == "application/pdf"
    assert body["processing_status"] == "ready"
    assert body["file_size_bytes"] == len(b"%PDF-1.7\ncontent")
    assert len(list(tmp_path.glob("*.pdf"))) == 1


def test_rejects_invalid_pdf_signature(client, tmp_path, monkeypatch):
    settings = SimpleNamespace(resume_storage_dir=str(tmp_path), resume_max_size_bytes=1024)
    monkeypatch.setattr("app.api.routes.resumes.get_settings", lambda: settings)
    headers = auth_headers(client, "candidate@example.com")

    response = client.post(
        "/api/v1/resumes/upload",
        headers=headers,
        files={"file": ("resume.pdf", b"not a pdf", "application/pdf")},
    )

    assert response.status_code == 400
    assert "valid PDF" in response.json()["detail"]
    assert list(tmp_path.iterdir()) == []


def test_rejects_malformed_pdf(client, tmp_path, monkeypatch):
    def raise_pdf_error(path, strict=True):
        raise PdfReadError("malformed")

    monkeypatch.setattr(resume_service, "PdfReader", raise_pdf_error)
    settings = SimpleNamespace(resume_storage_dir=str(tmp_path), resume_max_size_bytes=1024)
    monkeypatch.setattr("app.api.routes.resumes.get_settings", lambda: settings)
    headers = auth_headers(client, "candidate@example.com")

    response = client.post(
        "/api/v1/resumes/upload",
        headers=headers,
        files={"file": ("resume.pdf", b"%PDF-1.7\ncontent", "application/pdf")},
    )

    assert response.status_code == 400
    assert "malformed" in response.json()["detail"]


def test_rejects_empty_extracted_text(client, tmp_path, monkeypatch):
    class Page:
        def extract_text(self):
            return "  \n"

    class Reader:
        is_encrypted = False
        pages = [Page()]

    monkeypatch.setattr(resume_service, "PdfReader", lambda path, strict=True: Reader())
    settings = SimpleNamespace(resume_storage_dir=str(tmp_path), resume_max_size_bytes=1024)
    monkeypatch.setattr("app.api.routes.resumes.get_settings", lambda: settings)
    headers = auth_headers(client, "candidate@example.com")

    response = client.post(
        "/api/v1/resumes/upload",
        headers=headers,
        files={"file": ("resume.pdf", b"%PDF-1.7\ncontent", "application/pdf")},
    )

    assert response.status_code == 400
    assert "readable text" in response.json()["detail"]


def test_rejects_encrypted_pdf(client, tmp_path, monkeypatch):
    class Reader:
        is_encrypted = True
        pages = []

    monkeypatch.setattr(resume_service, "PdfReader", lambda path, strict=True: Reader())
    settings = SimpleNamespace(resume_storage_dir=str(tmp_path), resume_max_size_bytes=1024)
    monkeypatch.setattr("app.api.routes.resumes.get_settings", lambda: settings)
    headers = auth_headers(client, "candidate@example.com")

    response = client.post(
        "/api/v1/resumes/upload",
        headers=headers,
        files={"file": ("resume.pdf", b"%PDF-1.7\ncontent", "application/pdf")},
    )

    assert response.status_code == 400
    assert "Encrypted" in response.json()["detail"]


def test_rejects_wrong_extension_and_mime_type(client, tmp_path, monkeypatch):
    settings = SimpleNamespace(resume_storage_dir=str(tmp_path), resume_max_size_bytes=1024)
    monkeypatch.setattr("app.api.routes.resumes.get_settings", lambda: settings)
    headers = auth_headers(client, "candidate@example.com")

    wrong_extension = client.post(
        "/api/v1/resumes/upload",
        headers=headers,
        files={"file": ("resume.txt", b"%PDF-1.7\ncontent", "application/pdf")},
    )
    wrong_mime = client.post(
        "/api/v1/resumes/upload",
        headers=headers,
        files={"file": ("resume.pdf", b"%PDF-1.7\ncontent", "text/plain")},
    )

    assert wrong_extension.status_code == 400
    assert wrong_mime.status_code == 400


def test_upload_requires_authentication(client):
    response = client.post(
        "/api/v1/resumes/upload",
        files={"file": ("resume.pdf", b"%PDF-1.7\ncontent", "application/pdf")},
    )

    assert response.status_code == 401


def test_resume_metadata_isolated_between_users(client, tmp_path, monkeypatch):
    class Page:
        def extract_text(self):
            return "Private candidate information"

    class Reader:
        is_encrypted = False
        pages = [Page()]

    monkeypatch.setattr(resume_service, "PdfReader", lambda path, strict=True: Reader())
    settings = SimpleNamespace(resume_storage_dir=str(tmp_path), resume_max_size_bytes=1024)
    monkeypatch.setattr("app.api.routes.resumes.get_settings", lambda: settings)
    owner_headers = auth_headers(client, "owner@example.com")
    other_headers = auth_headers(client, "other@example.com")
    upload = client.post(
        "/api/v1/resumes/upload",
        headers=owner_headers,
        files={"file": ("resume.pdf", b"%PDF-1.7\ncontent", "application/pdf")},
    )
    assert upload.status_code == 201

    assert client.get("/api/v1/resumes/me", headers=owner_headers).status_code == 200
    assert client.get("/api/v1/resumes/me", headers=other_headers).status_code == 204


def test_storage_error_returns_service_unavailable(client, tmp_path, monkeypatch):
    blocked_path = tmp_path / "blocked"
    blocked_path.write_text("not a directory")
    settings = SimpleNamespace(resume_storage_dir=str(blocked_path), resume_max_size_bytes=1024)
    monkeypatch.setattr("app.api.routes.resumes.get_settings", lambda: settings)
    headers = auth_headers(client, "candidate@example.com")

    response = client.post(
        "/api/v1/resumes/upload",
        headers=headers,
        files={"file": ("resume.pdf", b"%PDF-1.7\ncontent", "application/pdf")},
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "Resume storage is temporarily unavailable"
