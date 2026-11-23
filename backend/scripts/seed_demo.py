"""Seed a demo user and one complete 3-question interview session with canned answers.

Allows demonstrating the full Dashboard -> Result UI immediately without recording audio
or manually typing answers. Supports both live LLM evaluation (default) and `--offline`
mode (uses deterministic rubric scores so demos work even without an LLM API key).

Run from `backend/`:
    python -m scripts.seed_demo
    python -m scripts.seed_demo --offline
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from sqlalchemy import select  # noqa: E402

from app import evaluator, features, fusion, scoring, speech  # noqa: E402
from app.auth import hash_password  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.models import (  # noqa: E402
    CandidateProfile,
    Evaluation,
    InterviewSession,
    Question,
    Response,
    User,
)

DEMO_NAME = "Demo Candidate"
DEMO_EMAIL = "demo@mockinterview.edu"
DEMO_PASSWORD = "DemoPassword123"

DEMO_QA_ITEMS: list[dict[str, Any]] = [
    {
        "topic": "dbms",
        "difficulty": "medium",
        "question": "Explain database normalization and the goals of 1NF, 2NF, and 3NF.",
        "expected_concepts": [
            "redundancy reduction",
            "update anomalies",
            "1NF atomic values",
            "2NF partial dependency",
            "3NF transitive dependency",
        ],
        "reference_context": (
            "Normalization structures relational tables to reduce data redundancy and prevent "
            "insert, update, and delete anomalies. 1NF enforces atomic values; 2NF removes "
            "partial dependencies on composite keys; 3NF removes transitive dependencies."
        ),
        "input_mode": "text",
        "raw_text": (
            "Database normalization structures relational tables to reduce data redundancy and "
            "prevent insert, update, and delete anomalies. 1NF requires atomic column values "
            "with no repeating groups. 2NF eliminates partial dependencies on composite primary "
            "keys, and 3NF removes transitive dependencies so non-key columns depend strictly "
            "on the primary key."
        ),
        "duration_sec": 54.0,
        "delivery_features": None,
        "offline_eval": {
            "scores": {
                "technical_correctness": 9,
                "relevance": 9,
                "clarity": 8,
                "completeness": 9,
                "communication": 8,
            },
            "concepts_covered": [
                "redundancy reduction",
                "update anomalies",
                "1NF atomic values",
                "2NF partial dependency",
                "3NF transitive dependency",
            ],
        },
        "offline_content": {
            "sim_question": 0.78,
            "sim_reference": 0.89,
            "concept_coverage": 1.0,
            "concepts_covered": [
                "redundancy reduction",
                "update anomalies",
                "1NF atomic values",
                "2NF partial dependency",
                "3NF transitive dependency",
            ],
            "word_count": 56,
            "length_score": 0.9016,
            "star_structure": None,
        },
    },
    {
        "topic": "os",
        "difficulty": "medium",
        "question": "What are the four Coffman conditions for deadlock and how can an OS prevent deadlock?",
        "expected_concepts": [
            "mutual exclusion",
            "hold and wait",
            "no preemption",
            "circular wait",
            "lock ordering",
        ],
        "reference_context": (
            "Deadlock requires mutual exclusion, hold and wait, no preemption, and circular wait "
            "simultaneously. Breaking circular wait via strict global lock ordering prevents deadlock."
        ),
        "input_mode": "voice",
        "raw_text": (
            "Um, deadlock happens when four Coffman conditions hold together: mutual exclusion, "
            "hold and wait, no preemption, and circular wait. You know, an OS prevents deadlock "
            "by breaking circular wait with a strict global lock ordering."
        ),
        "duration_sec": 34.0,
        "delivery_features": {
            "speaking_rate_wpm": 124.0,
            "pause_frequency": 1.76,
            "filler_count": 2,
            "duration_sec": 34.0,
            "normalized": {
                "speaking_rate_wpm": 1.0,
                "pause_frequency": 1.0,
                "filler_count": 0.7143,
                "duration_sec": 1.0,
            },
        },
        "offline_eval": {
            "scores": {
                "technical_correctness": 8,
                "relevance": 9,
                "clarity": 8,
                "completeness": 8,
                "communication": 8,
            },
            "concepts_covered": [
                "mutual exclusion",
                "hold and wait",
                "no preemption",
                "circular wait",
                "lock ordering",
            ],
        },
        "offline_content": {
            "sim_question": 0.81,
            "sim_reference": 0.86,
            "concept_coverage": 1.0,
            "concepts_covered": [
                "mutual exclusion",
                "hold and wait",
                "no preemption",
                "circular wait",
                "lock ordering",
            ],
            "word_count": 38,
            "length_score": 0.5042,
            "star_structure": None,
        },
    },
    {
        "topic": "cn",
        "difficulty": "medium",
        "question": "Walk through the TCP three-way handshake and explain why TCP is reliable compared to UDP.",
        "expected_concepts": [
            "SYN SYN-ACK ACK",
            "sequence numbers",
            "acknowledgements and retransmissions",
            "flow control",
            "congestion control",
        ],
        "reference_context": (
            "TCP opens connections with SYN, SYN-ACK, and ACK, and ensures reliability via "
            "sequence numbers, acknowledgements with retransmissions, flow control, and congestion control."
        ),
        "input_mode": "text",
        "raw_text": (
            "In the TCP three-way handshake, the client sends SYN, the server replies SYN-ACK, "
            "and the client confirms with ACK. TCP is reliable compared to UDP because it uses "
            "sequence numbers, acknowledgements, and retransmissions when packets are dropped."
        ),
        "duration_sec": 42.0,
        "delivery_features": None,
        "offline_eval": {
            "scores": {
                "technical_correctness": 7,
                "relevance": 8,
                "clarity": 8,
                "completeness": 6,
                "communication": 8,
            },
            "concepts_covered": [
                "SYN SYN-ACK ACK",
                "sequence numbers",
                "acknowledgements and retransmissions",
            ],
        },
        "offline_content": {
            "sim_question": 0.74,
            "sim_reference": 0.76,
            "concept_coverage": 0.6,
            "concepts_covered": [
                "SYN SYN-ACK ACK",
                "sequence numbers",
                "acknowledgements and retransmissions",
            ],
            "word_count": 39,
            "length_score": 0.5242,
            "star_structure": None,
        },
    },
]


def seed_demo(
    email: str = DEMO_EMAIL,
    password: str = DEMO_PASSWORD,
    name: str = DEMO_NAME,
    offline: bool = False,
) -> int:
    """Create/reuse the demo account and populate one completed 3-question interview session."""
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        normalized_email = email.strip().lower()
        user = db.scalar(select(User).where(User.email == normalized_email))
        if user is None:
            user = User(
                name=name,
                email=normalized_email,
                password_hash=hash_password(password),
            )
            user.profile = CandidateProfile(
                target_role="Backend Engineer",
                skills=["Python", "SQL", "FastAPI", "PostgreSQL"],
                experience_level="Fresher",
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            print(f"Created demo user: {user.email}")
        else:
            print(f"Reusing existing demo user: {user.email}")

        session = InterviewSession(
            user_id=user.id,
            role="Backend Engineer",
            experience_level="Fresher",
            interview_type="technical",
            difficulty="medium",
            total_questions=len(DEMO_QA_ITEMS),
            status="in_progress",
        )
        db.add(session)
        db.commit()
        db.refresh(session)

        answer_scores: list[float] = []
        for idx, item in enumerate(DEMO_QA_ITEMS, start=1):
            question = Question(
                session_id=session.id,
                order_no=idx,
                text=item["question"],
                topic=item["topic"],
                type="technical",
                difficulty=item["difficulty"],
                expected_concepts=item["expected_concepts"],
            )
            db.add(question)
            db.commit()
            db.refresh(question)

            cleaned_text = speech.clean_transcript(item["raw_text"])

            if offline:
                c_feats = dict(item["offline_content"])
                llm_res = dict(item["offline_eval"])
            else:
                c_feats = features.content_features(
                    question=question.text,
                    cleaned_answer=cleaned_text,
                    reference_chunk=item["reference_context"],
                    expected_concepts=question.expected_concepts,
                    interview_type=question.type,
                )
                llm_res = evaluator.evaluate_with_llm(
                    question=question.text,
                    answer_text=cleaned_text,
                    expected_concepts=question.expected_concepts,
                    reference_context=item["reference_context"],
                    content_features=c_feats,
                    delivery_features_or_None=item["delivery_features"],
                    interview_type=question.type,
                )

            response = Response(
                question_id=question.id,
                input_mode=item["input_mode"],
                raw_text=item["raw_text"],
                cleaned_text=cleaned_text,
                audio_path="uploads/demo_sample_os.webm" if item["input_mode"] == "voice" else None,
                duration_sec=item["duration_sec"],
                delivery_features=item["delivery_features"],
                content_features=c_feats,
            )
            db.add(response)
            db.commit()
            db.refresh(response)

            fused = fusion.fuse_evaluation_scores(
                llm_result=llm_res,
                interview_type=question.type,
                sim_reference=float(c_feats.get("sim_reference", 0.0)),
                concept_coverage=float(c_feats.get("concept_coverage", 0.0)),
                delivery_features_or_None=response.delivery_features,
            )

            evaluation = Evaluation(
                response_id=response.id,
                rubric_type=question.type,
                scores=llm_res["scores"],
                concepts_covered=llm_res["concepts_covered"],
                llm_score=fused["llm_score"],
                similarity_score=fused["similarity_score"],
                delivery_score=fused["delivery_score"],
                fused_score=fused["fused_score"],
                fusion_method=fused["fusion_method"],
                method_scores=fused["method_scores"],
                eval_version=evaluator.EVAL_PROMPT_VERSION,
            )
            db.add(evaluation)
            db.commit()
            answer_scores.append(evaluation.fused_score)
            print(
                f"  Q{idx} ({item['topic']}, {item['input_mode']}): "
                f"score={evaluation.fused_score:.2f} "
                f"(feature={fused['method_scores']['feature_level']:.2f}, "
                f"decision={fused['method_scores']['decision_level']:.2f})"
            )

        session.overall_score = scoring.session_score(answer_scores)
        session.band = scoring.band(session.overall_score)
        session.status = "completed"
        session.completed_at = datetime.now(timezone.utc)
        db.add(session)
        db.commit()

        print("\nDemo seed complete!")
        print(f"  Login email    : {normalized_email}")
        print(f"  Login password : {password}")
        print(f"  Session ID     : {session.id}")
        print(f"  Session score  : {session.overall_score:.1f} / 10 ({session.band})")
        print(f"  Result URL     : http://localhost:5173/result/{session.id}")
        return session.id
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed a demo user and one completed mock interview.")
    parser.add_argument("--email", default=DEMO_EMAIL)
    parser.add_argument("--password", default=DEMO_PASSWORD)
    parser.add_argument("--name", default=DEMO_NAME)
    parser.add_argument(
        "--offline",
        action="store_true",
        help="Use deterministic canned rubric scores instead of calling the live LLM/MiniLM.",
    )
    args = parser.parse_args()
    seed_demo(
        email=args.email,
        password=args.password,
        name=args.name,
        offline=args.offline,
    )


if __name__ == "__main__":
    main()
