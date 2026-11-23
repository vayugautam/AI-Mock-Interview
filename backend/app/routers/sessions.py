"""Interview session routes including question generation and text/voice answer submission."""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import evaluator, scoring, speech
from app.auth import get_current_user
from app.config import settings
from app.db import get_db
from app.models import InterviewSession, Question, Response, User
from app.questions import generate_question
from app.schemas import (
    QuestionOut,
    QuestionResultOut,
    ResponseOut,
    SessionCreateRequest,
    SessionOut,
    SessionResultOut,
)
from app.speech import AudioProcessingError

router = APIRouter(prefix="/sessions", tags=["Sessions"])

UPLOADS_DIR = (Path(__file__).resolve().parents[2] / "uploads").resolve()
ALLOWED_AUDIO_EXTENSIONS = frozenset({".webm", ".wav", ".mp3", ".m4a", ".ogg", ".flac"})
MAX_AUDIO_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MB


def _get_owned_session(
    session_id: int,
    current_user: User,
    db: Session,
) -> InterviewSession:
    session = db.get(InterviewSession, session_id)
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Interview session not found",
        )
    if session.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this interview session",
        )
    return session


async def _save_uploaded_audio(
    audio: UploadFile,
    *,
    session_id: int,
    question_id: int,
    uploads_dir: Path = UPLOADS_DIR,
) -> Path:
    """Validate audio extension/size and write to a safe server-generated path inside uploads_dir."""
    ext = Path(audio.filename or "recording.webm").suffix.lower() or ".webm"
    if ext not in ALLOWED_AUDIO_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported audio format '{ext}'. Allowed: {', '.join(sorted(ALLOWED_AUDIO_EXTENSIONS))}",
        )

    uploads_dir.mkdir(parents=True, exist_ok=True)
    resolved_dir = uploads_dir.resolve()
    safe_name = f"s{session_id}_q{question_id}_{uuid.uuid4().hex}{ext}"
    target_path = (resolved_dir / safe_name).resolve()

    if not str(target_path).startswith(str(resolved_dir) + os.sep):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid audio upload path",
        )

    total_bytes = 0
    chunks: list[bytes] = []
    while True:
        chunk = await audio.read(1024 * 1024)
        if not chunk:
            break
        total_bytes += len(chunk)
        if total_bytes > MAX_AUDIO_UPLOAD_BYTES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Audio file exceeds maximum size limit of 25 MB",
            )
        chunks.append(chunk)

    if total_bytes == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded audio file is empty",
        )

    target_path.write_bytes(b"".join(chunks))
    return target_path


@router.post(
    "",
    response_model=SessionOut,
    status_code=status.HTTP_201_CREATED,
)
def create_session(
    payload: SessionCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> InterviewSession:
    """Create a new interview session owned by the authenticated user."""
    session = InterviewSession(
        user_id=current_user.id,
        role=payload.role.strip(),
        experience_level=payload.experience_level.strip(),
        interview_type=payload.interview_type,
        difficulty=payload.difficulty,
        total_questions=payload.total_questions,
        status="in_progress",
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@router.get("", response_model=list[SessionOut])
def list_my_sessions(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[InterviewSession]:
    """List interview sessions belonging to the authenticated user (newest first)."""
    stmt = (
        select(InterviewSession)
        .where(InterviewSession.user_id == current_user.id)
        .order_by(InterviewSession.created_at.desc(), InterviewSession.id.desc())
    )
    return list(db.scalars(stmt).all())


@router.get("/{session_id}", response_model=SessionOut)
def get_session(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> InterviewSession:
    """Retrieve a single interview session if it belongs to the authenticated user."""
    return _get_owned_session(session_id, current_user, db)


@router.post(
    "/{session_id}/next-question",
    response_model=QuestionOut,
    status_code=status.HTTP_201_CREATED,
)
def next_question(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Question:
    """Generate and persist the next interview question for the owned session."""
    session = _get_owned_session(session_id, current_user, db)

    existing_questions = list(
        db.scalars(
            select(Question)
            .where(Question.session_id == session.id)
            .order_by(Question.order_no.asc())
        ).all()
    )
    if len(existing_questions) >= session.total_questions or session.status == "completed":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="All questions for this session have already been asked",
        )

    generated = generate_question(session, existing_questions)

    question = Question(
        session_id=session.id,
        order_no=len(existing_questions) + 1,
        text=generated["question"],
        topic=generated["topic"],
        type=generated["type"],
        difficulty=generated["difficulty"],
        expected_concepts=generated["expected_concepts"],
    )
    db.add(question)
    db.commit()
    db.refresh(question)
    return question


@router.post(
    "/{session_id}/questions/{qid}/answer",
    response_model=ResponseOut,
    status_code=status.HTTP_201_CREATED,
)
async def submit_answer(
    session_id: int,
    qid: int,
    input_mode: Literal["text", "voice"] = Form(...),
    text: Optional[str] = Form(default=None),
    audio: Optional[UploadFile] = File(default=None),
    time_taken_sec: Optional[float] = Form(default=None, ge=0.0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    """Submit a text or voice answer for a session question and store extracted speech metrics."""
    session = _get_owned_session(session_id, current_user, db)

    question = db.get(Question, qid)
    if question is None or question.session_id != session.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Question not found in this interview session",
        )

    existing_response = db.scalar(select(Response).where(Response.question_id == question.id))
    if existing_response is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This question has already been answered",
        )

    if input_mode == "text":
        raw_text = (text or "").strip()
        if not raw_text:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Answer text is required when input_mode is 'text'",
            )
        cleaned_text = speech.clean_transcript(raw_text)
        audio_path_str: Optional[str] = None
        duration_sec = round(float(time_taken_sec), 2) if time_taken_sec is not None else None
        delivery: Optional[dict] = None
    else:
        if audio is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Audio file is required when input_mode is 'voice'",
            )
        saved_path = await _save_uploaded_audio(
            audio,
            session_id=session.id,
            question_id=question.id,
            uploads_dir=UPLOADS_DIR,
        )
        try:
            processed_wav = speech.preprocess_audio(saved_path)
            measured_duration = speech.get_audio_duration_sec(processed_wav)
            transcript = speech.transcribe(processed_wav)
        except AudioProcessingError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(exc),
            ) from exc

        raw_text = str(transcript.get("text") or "").strip()
        words = list(transcript.get("words") or [])
        cleaned_text = speech.clean_transcript(raw_text)
        duration_sec = (
            measured_duration
            if measured_duration > 0
            else (round(float(time_taken_sec), 2) if time_taken_sec is not None else 0.0)
        )
        delivery = speech.delivery_features(words, duration_sec, raw_text=raw_text)
        audio_path_str = str(Path("uploads") / saved_path.name)

    response = Response(
        question_id=question.id,
        input_mode=input_mode,
        raw_text=raw_text,
        cleaned_text=cleaned_text,
        audio_path=audio_path_str,
        duration_sec=duration_sec,
        delivery_features=delivery,
        content_features={},
    )
    db.add(response)
    db.commit()
    db.refresh(response)

    # Run evaluation pipeline; keep the saved response intact if evaluation fails (502)
    try:
        evaluator.evaluate_response(response)
    except evaluator.EvaluationFailed as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                f"Answer saved (response_id={response.id}), but evaluation failed and "
                f"can be retried: {exc}"
            ),
        ) from exc

    db.refresh(response)
    return response


@router.post(
    "/{session_id}/questions/{qid}/retry-evaluation",
    response_model=ResponseOut,
)
def retry_question_evaluation(
    session_id: int,
    qid: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    """Retry LLM evaluation for an already-saved response after a 502 evaluation failure."""
    session = _get_owned_session(session_id, current_user, db)
    question = db.get(Question, qid)
    if question is None or question.session_id != session.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Question not found in this interview session",
        )

    response = db.scalar(select(Response).where(Response.question_id == question.id))
    if response is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No saved answer found for this question",
        )

    try:
        evaluator.evaluate_response(response)
    except evaluator.EvaluationFailed as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                f"Answer remains saved (response_id={response.id}), but evaluation failed "
                f"again: {exc}"
            ),
        ) from exc

    db.refresh(response)
    return response


def _load_session_questions(session_id: int, db: Session) -> list[Question]:
    return list(
        db.scalars(
            select(Question)
            .where(Question.session_id == session_id)
            .order_by(Question.order_no.asc())
        ).all()
    )


@router.post("/{session_id}/complete", response_model=SessionOut)
def complete_session(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> InterviewSession:
    """Complete a session only when every question has an evaluated response."""
    session = _get_owned_session(session_id, current_user, db)
    questions = _load_session_questions(session.id, db)

    if len(questions) < session.total_questions:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Cannot complete session: only {len(questions)} of "
                f"{session.total_questions} questions have been generated"
            ),
        )

    unevaluated = [
        q.order_no
        for q in questions
        if q.response is None or q.response.evaluation is None
    ]
    if unevaluated:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Cannot complete session: all questions must have an evaluated response "
                f"(pending question numbers: {unevaluated})"
            ),
        )

    answer_scores = [q.response.evaluation.fused_score for q in questions]  # type: ignore[union-attr]
    overall = scoring.session_score(answer_scores)
    performance_band = scoring.band(overall)

    session.overall_score = overall
    session.band = performance_band
    session.status = "completed"
    if session.completed_at is None:
        session.completed_at = datetime.now(timezone.utc)

    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@router.get("/{session_id}/result", response_model=SessionResultOut)
def get_session_result(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SessionResultOut:
    """Return per-question scores, covered/missing concepts, session score, and band."""
    session = _get_owned_session(session_id, current_user, db)
    if session.status != "completed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Session is not completed yet. Complete all questions and call POST /sessions/{id}/complete first.",
        )

    questions = _load_session_questions(session.id, db)
    question_results: list[QuestionResultOut] = []
    fusion_method = settings.FUSION_METHOD

    for idx, q in enumerate(questions):
        if q.response is None or q.response.evaluation is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Question {q.order_no} is missing an evaluated response",
            )
        resp = q.response
        ev = resp.evaluation
        if idx == 0 and ev.fusion_method:
            fusion_method = ev.fusion_method

        covered = [str(c).strip() for c in (ev.concepts_covered or []) if str(c).strip()]
        covered_lower = {c.lower() for c in covered}
        expected = [str(c).strip() for c in (q.expected_concepts or []) if str(c).strip()]
        missing = [c for c in expected if c.lower() not in covered_lower]

        question_results.append(
            QuestionResultOut(
                question_id=q.id,
                order_no=q.order_no,
                question=q.text,
                topic=q.topic,
                input_mode=resp.input_mode,
                scores=dict(ev.scores or {}),
                answer_score=ev.fused_score,
                concepts_covered=covered,
                concepts_missing=missing,
                method_scores=dict(ev.method_scores or {}),
            )
        )

    final_score = (
        session.overall_score
        if session.overall_score is not None
        else scoring.session_score([qr.answer_score for qr in question_results])
    )
    final_band = session.band or scoring.band(final_score)

    return SessionResultOut(
        session_id=session.id,
        role=session.role,
        interview_type=session.interview_type,
        difficulty=session.difficulty,
        status=session.status,
        fusion_method=fusion_method,
        session_score=final_score,
        band=final_band,
        completed_at=session.completed_at,
        questions=question_results,
    )
