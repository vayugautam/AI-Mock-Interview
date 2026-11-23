from dataclasses import dataclass
from typing import Any, Protocol

from app.models import InterviewSession


@dataclass(frozen=True)
class QuestionDraft:
    question_text: str
    topic: str | None = None
    difficulty: str | None = None
    category: str | None = None
    source_type: str | None = None
    source_references: tuple[str, ...] = ()
    model_answer: str | None = None


class QuestionProvider(Protocol):
    generation_source: str

    def generate(
        self,
        session: InterviewSession,
        number_of_questions: int,
        context: Any = None,
    ) -> list[str | QuestionDraft]:
        """Return ordered questions for one interview session."""


class DeterministicQuestionProvider:
    """A replaceable, local question bank used until an LLM provider is introduced."""

    generation_source = "predefined"

    def generate(
        self,
        session: InterviewSession,
        number_of_questions: int,
        context: Any = None,
    ) -> list[str]:
        templates = self._templates_for(session.interview_type)
        context = {
            "role": session.role,
            "difficulty": session.difficulty,
        }
        return [template.format(**context) for template in templates[:number_of_questions]]

    @staticmethod
    def _templates_for(interview_type: str) -> list[str]:
        technical = [
            "For this {difficulty} {role} role, describe how you would approach a new technical problem before writing code.",
            "Which core tools, concepts, or trade-offs are most important for a {role}, and why?",
            "Walk through how you would diagnose a production issue relevant to a {role}.",
            "How would you design a maintainable solution for a common {role} workflow?",
            "Describe how you would test and validate a change before releasing it.",
            "What performance or reliability risks would you consider in this {role} role?",
            "Explain a technical decision you would document for teammates and the alternatives you would evaluate.",
            "How would you break a complex {role} task into smaller, deliverable steps?",
            "What security considerations would guide your work as a {role}?",
            "How would you measure whether a technical solution was successful?",
        ]
        behavioral = [
            "Tell me about a time you handled an ambiguous problem relevant to a {role} role. What was the outcome?",
            "Describe a time you received difficult feedback. How did you respond and what changed?",
            "Give an example of how you collaborated with people who had different priorities from yours.",
            "Tell me about a mistake you made in a project and the lesson you applied afterward.",
            "Describe a situation where you had to prioritize competing work under pressure.",
            "How have you explained a complex topic to a non-technical stakeholder?",
            "Tell me about a time you took ownership of a problem outside your usual responsibilities.",
            "Describe a disagreement with a teammate and how you worked toward a resolution.",
            "Give an example of a process improvement you proposed or implemented.",
            "Tell me about a time you learned a new skill quickly to deliver a result.",
        ]
        if interview_type == "behavioral":
            return behavioral
        if interview_type == "mixed":
            return [item for pair in zip(technical, behavioral) for item in pair]
        return technical


question_provider = DeterministicQuestionProvider()
