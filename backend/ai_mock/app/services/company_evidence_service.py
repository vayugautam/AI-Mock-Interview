from __future__ import annotations

import re
from collections import Counter

from app.schemas.company_research import (
    EvidenceKind,
    EvidenceStrength,
    ResearchFinding,
    ResearchSource,
)
from app.services.company_page_service import PageDocument

KNOWN_SKILLS = (
    "python", "java", "javascript", "typescript", "go", "rust", "c++", "sql",
    "postgresql", "mysql", "redis", "kafka", "aws", "azure", "gcp", "docker",
    "kubernetes", "react", "node.js", "fastapi", "graphql", "rest", "microservices",
    "distributed systems", "machine learning", "data structures", "algorithms",
    "system design", "testing", "security",
)


def extract_evidence(
    pages: list[PageDocument],
    *,
    source_for_page,
) -> tuple[list[ResearchFinding], list[str], list[str], list[str], list[str]]:
    findings: list[ResearchFinding] = []
    skill_counts: Counter[str] = Counter()
    technical_subjects: set[str] = set()
    requirements: list[str] = []
    stages: list[str] = []

    for page in pages:
        source = source_for_page(page)
        sentences = _sentences(page.text)
        trusted_sentences = [sentence for sentence in sentences if not _is_instruction_like(sentence)]
        lower_text = " ".join(trusted_sentences).lower()
        present_skills = [skill for skill in KNOWN_SKILLS if skill in lower_text]
        for skill in present_skills:
            skill_counts[skill] += 1
            findings.append(
                ResearchFinding(
                    category="skill",
                    statement=f"{skill} is mentioned in the retrieved source.",
                    evidence_kind=_evidence_kind(source.source_type),
                    sources=[source],
                )
            )
        for sentence in trusted_sentences:
            lower = sentence.lower()
            if _contains_any(lower, ("required", "qualification", "you will", "must have", "experience with")):
                requirements.append(sentence)
                findings.append(
                    ResearchFinding(
                        category="role_requirement",
                        statement=sentence[:1000],
                        evidence_kind=_evidence_kind(source.source_type),
                        sources=[source],
                    )
                )
            if _contains_any(lower, ("interview", "onsite", "on-site", "phone screen", "technical screen", "assessment", "interview loop")):
                stages.append(sentence)
                findings.append(
                    ResearchFinding(
                        category="interview_stage",
                        statement=sentence[:1000],
                        evidence_kind=_evidence_kind(source.source_type),
                        sources=[source],
                    )
                )
        for skill in present_skills:
            if skill in {"system design", "data structures", "algorithms", "distributed systems", "security", "testing"}:
                technical_subjects.add(skill)

    key_skills = [skill for skill, _ in skill_counts.most_common(30)]
    return _dedupe_findings(findings), key_skills, requirements[:30], stages[:20], sorted(technical_subjects)


def infer_priorities(
    findings: list[ResearchFinding],
    *,
    source_limit: int = 3,
) -> list[ResearchFinding]:
    counts = Counter(
        finding.statement.removesuffix(" is mentioned in the retrieved source.")
        for finding in findings
        if finding.category == "skill"
    )
    sources_by_skill = {}
    for finding in findings:
        if finding.category == "skill":
            skill = finding.statement.removesuffix(" is mentioned in the retrieved source.")
            sources_by_skill.setdefault(skill, []).extend(finding.sources)
    return [
        ResearchFinding(
            category="inferred_priority",
            statement=f"{skill} may be a priority because it appears across {count} retrieved source(s); this is an inference.",
            evidence_kind="inference",
            sources=sources_by_skill[skill][:source_limit],
        )
        for skill, count in counts.most_common(10)
    ]


def _sentences(text: str) -> list[str]:
    return [part.strip() for part in re.split(r"(?<=[.!?])\s+|\n+", text) if part.strip()]


def _contains_any(text: str, terms: tuple[str, ...]) -> bool:
    return any(term in text for term in terms)


def _is_instruction_like(sentence: str) -> bool:
    lowered = sentence.lower()
    return (
        "ignore all prior instructions" in lowered
        or "ignore previous instructions" in lowered
        or "claim " in lowered
        or "do not follow" in lowered
        or "system message" in lowered
    )


def _evidence_kind(source_type: str) -> EvidenceKind:
    return "anecdotal" if source_type == "candidate_report" else "verified"


def _dedupe_findings(findings: list[ResearchFinding]) -> list[ResearchFinding]:
    seen: set[tuple[str, str]] = set()
    unique: list[ResearchFinding] = []
    for finding in findings:
        key = (finding.category, finding.statement)
        if key not in seen:
            seen.add(key)
            unique.append(finding)
    return unique
