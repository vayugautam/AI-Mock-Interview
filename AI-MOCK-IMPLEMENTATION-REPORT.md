# AI Mock Interview Platform — Implementation Report

## Scope and baseline

This report is based on the current workspace, not prior plans. The repository has:

- `backend/`: FastAPI, SQLAlchemy, Alembic, JWT authentication, PostgreSQL configuration.
- `frontend/`: React 19 + Vite application.
- Existing live baseline observed before this report: backend health endpoint and frontend login page were reachable.

No `.env` values, credentials, tokens, or resume contents were read into this report.

## Capability inventory

| Capability | Current state | Evidence |
|---|---|---|
| Resume upload | Missing | No upload route, multipart schema, resume model, storage adapter, or frontend upload page was found. |
| Resume extraction | Missing | No parser/extraction service or extraction dependency is present. |
| Resume-based RAG | Partial, unrelated | [`retrieval_service.py`](backend/app/services/retrieval_service.py) contains a fixed in-code reference-material list and token-overlap retrieval (`REFERENCE_MATERIAL` and `retrieve_reference_material`); it does not ingest resume data, create embeddings, or query a vector store. |
| Company web research | Missing | No company URL/research route, HTTP research service, scraper, search provider, or frontend workflow was found. |
| Company profile caching | Missing | No company profile model/table, cache service, cache fields, or migration was found. |
| Groq question generation | Missing | [`question_provider.py`](backend/app/services/question_provider.py) exposes a provider protocol but the active provider is [`DeterministicQuestionProvider`](backend/app/services/question_provider.py:13), instantiated as `question_provider` at line 59. [`questions.py`](backend/app/api/routes/questions.py:63) always uses that instance. |
| Text-based answer evaluation | Implemented | [`evaluation_provider.py`](backend/app/services/evaluation_provider.py:40) provides deterministic evaluation and [`GroqEvaluationProvider`](backend/app/services/evaluation_provider.py:85). [`evaluation_service.py`](backend/app/services/evaluation_service.py) validates, scores, and persists results. |
| Results and feedback UI | Implemented | [`ResultsPage.jsx`](frontend/src/pages/ResultsPage.jsx:6) renders scores, provider/model, reasoning, strengths, weaknesses, missing concepts, suggestions, and feedback. [`DashboardPage.jsx`](frontend/src/pages/DashboardPage.jsx:15) renders interview history and progress. |

## Existing implementation to reuse

### Backend

- API composition and CORS: [`main.py`](backend/app/main.py:61).
- Auth and ownership boundary: [`auth.py`](backend/app/api/routes/auth.py).
- Interview lifecycle: [`interviews.py`](backend/app/api/routes/interviews.py), [`interview_service.py`](backend/app/services/interview_service.py).
- Question contract and provider seam: [`question_provider.py`](backend/app/services/question_provider.py), [`question_service.py`](backend/app/services/question_service.py), [`question.py`](backend/app/schemas/question.py).
- Answer persistence: [`answers.py`](backend/app/api/routes/answers.py), [`answer_service.py`](backend/app/services/answer_service.py).
- Evaluation provider seam and Groq HTTP integration: [`evaluation_provider.py`](backend/app/services/evaluation_provider.py).
- Evaluation persistence and weighted score: [`evaluation_service.py`](backend/app/services/evaluation_service.py), [`evaluations.py`](backend/app/api/routes/evaluations.py:169).
- Results aggregation: [`results_service.py`](backend/app/services/results_service.py), [`results.py`](backend/app/api/routes/results.py:14).
- Existing data model patterns: [`models/`](backend/app/models/).
- Existing migration chain: `0001_phase_one`, `0002_one_answer_per_question`, `0003_text_evaluation`.
- Configuration seam: [`config.py`](backend/app/core/config.py:11).

### Frontend

- API request/auth wrapper: [`client.js`](frontend/src/api/client.js).
- Interview API functions: [`interviews.js`](frontend/src/api/interviews.js).
- Interview setup and workspace: [`InterviewCreatePage.jsx`](frontend/src/pages/InterviewCreatePage.jsx), [`InterviewWorkspacePage.jsx`](frontend/src/pages/InterviewWorkspacePage.jsx).
- Results and progress presentation: [`ResultsPage.jsx`](frontend/src/pages/ResultsPage.jsx), [`DashboardPage.jsx`](frontend/src/pages/DashboardPage.jsx).
- Existing tests for auth, interview setup/workspace, results, dashboard, and API client.

## Configuration and dependencies

Current backend configuration supports database settings, JWT settings, mock/Groq evaluation selection, Groq model, timeout, and retry settings in [`config.py`](backend/app/core/config.py). The active default is the deterministic mock evaluation provider, not Groq.

Current backend dependencies in [`requirements.txt`](backend/requirements.txt) cover FastAPI, SQLAlchemy, Alembic, PostgreSQL (`psycopg`), JWT, password hashing, HTTPX, and testing. There are no resume parsing, file storage, web research/search, embedding, vector database, or document chunking dependencies.

Frontend dependencies in [`package.json`](frontend/package.json) cover React, routing, Vite, Tailwind, icons, Vitest, Testing Library, and Oxlint. There is no upload/RAG/research-specific client package.

## Data and migration gaps

The current schema stores users, interview sessions, questions, answers, and evaluations. [`0003_extend_evaluations_for_text_analysis.py`](backend/migrations/versions/0003_extend_evaluations_for_text_analysis.py:18) added structured evaluation fields, but there are no tables for:

- user resume metadata, extracted text, document versions, or processing status;
- resume chunks/embeddings or retrieval metadata;
- company profiles, source URLs, research timestamps, or cache expiry;
- interview-level resume/company personalization selections.

The new capabilities will require migrations. Large extracted text and embeddings should use a deliberate storage strategy rather than adding unbounded fields to `users` or `interview_sessions`.

## Baseline tests

Attempted suites:

- Backend: `backend/tests` — not collected. The execution environment reported that PowerShell/Python was unavailable and no virtual-environment Python executable could be used.
- Frontend: configured Vitest suite — not started. The execution environment reported that PowerShell was unavailable, so npm could not start.

These are environment/setup failures only. No assertion failures were observed, and no new feature changes were made in this phase.

## Recommended implementation order

1. **Define product contracts and limits**: accepted resume formats/size, extraction failure behavior, retention/privacy, supported company sources, cache TTL, and whether personalization is optional per interview.
2. **Add resume ingestion**: upload endpoint, authenticated ownership, metadata/status model, storage abstraction, validation, and extraction worker/service.
3. **Add resume retrieval**: chunk extracted text, select an embedding/vector approach, store document/version/chunk metadata, implement scoped retrieval, and add tests for isolation and empty/failed documents.
4. **Add company research and caching**: approved source strategy, normalized company profile schema, fetch/parser service, TTL/error handling, cache invalidation, and provenance.
5. **Replace question provider behind the existing seam**: add Groq question generation with structured output validation, retry/timeout/error mapping, and deterministic fallback policy explicitly configured and tested. Incorporate only retrieved resume/company context within bounded prompt size.
6. **Extend interview contracts and persistence**: attach selected resume/company profile versions to a session, add migrations, and preserve existing sessions without personalization.
7. **Extend evaluation context if required**: keep the current evaluation provider seam; add retrieved context only if the product requirement calls for personalized answer evaluation, with prompt-injection and data-leakage safeguards.
8. **Update frontend flow**: profile/resume upload state, company selection/research status, interview setup personalization controls, loading/error states, and source/provenance display.
9. **Expand tests and validate**: backend unit/API tests, migration tests, provider contract tests with mocked Groq/research services, frontend component tests, and an end-to-end happy path. Re-run the existing suites first in a working Python/npm environment to establish a clean baseline.
