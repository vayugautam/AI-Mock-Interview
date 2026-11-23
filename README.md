# TalentPulse AI Mock Interview

TalentPulse is a React interview practice website with an Express API in the same Node server. The active website runs on port 3000 and does not need the separate FastAPI service in `backend/ai_mock`.

## Run locally

Prerequisites: Node.js 24 (the local SQL session store uses Node's built-in SQLite module) and a Gemini API key.

1. From the project root, install dependencies and create `.env` from `.env.example` if needed.
2. Set `GEMINI_API_KEY` in the root `.env`. Optionally add `GROQ_API_KEY` for fallback text, transcription, and interviewer voices, plus `TAVILY_API_KEY` for date-filtered recent interview-experience search.
3. Start the complete website and API:

```powershell
npm install
npm run dev
```

Open `http://localhost:3000`. The frontend and `/api/*` routes share this server. Do not start `npm run ai:api` for the active website flow.

Interviewer questions can be read aloud using selectable interviewer personas. With `GROQ_API_KEY`, Groq Orpheus generates persona-specific voices; if generation is unavailable, the app falls back to browser Speech Synthesis. Auto-read, replay, and stop controls are available. Voice-answer mode requires microphone permission and works on `localhost` or HTTPS. Browser speech recognition may provide a live transcript; if unavailable, the server transcribes the recorded WAV through the configured AI providers.

## Implemented interview plan

- Upload a job description and resume as PDFs. The server extracts text, analyzes each document with Gemini, identifies job requirements and resume skill gaps, and saves document chunks for retrieval.
- Generate technical, behavioral, or mixed interviews with a selected difficulty and 5, 10, 15, or 20 questions. Questions use the job description, resume, retrieved knowledge, and recent public interview-experience research when available. Dated Tavily search is optional; Gemini search grounding and Groq browser search remain fallbacks. Questions use recurring themes without claiming candidate reports are guaranteed or official questions.
- Record voice answers or use the available answer input. Voice audio is resampled to 16 kHz mono, silence-trimmed, and volume-normalized. The server retains the raw transcript and a filler-cleaned transcript for the appropriate evaluation features; it does not persist the audio recording.
- Evaluate each response against five fixed criteria: correctness, relevance, clarity, completeness, and communication. The report includes content similarities, concept coverage, STAR structure, answer length, and (for voice only) pace, pause, filler, and duration measurements. Delivery features are not used to infer accent, personality, or emotion.
- Compute answer and session scores on a 0–10 scale, map scores to performance bands, and show question-level feedback, skill performance, strengths, and improvement areas.
- Compare content-only, delivery-only, feature-level, and decision-level scoring. The benchmark calibrates feature-level rubric weights with leave-one-out scoring and saves the resulting weights for future answers.

## Storage and privacy

Account and interview session records are stored in `data/talentpulse_sessions.sqlite` with user ownership enforced by SQL relationships. On first startup, existing `data/users.json` and `data/interviews_d2.json` records are imported into SQLite; the original JSON files are retained as a local backup. Documents and the curated knowledge base remain in the app's local data files.

Voice audio is processed in memory for transcription and is not stored with the session. The report retains transcripts and calculated delivery values. Before collecting real voice examples for research validation, obtain participants' informed consent and add human-scored examples to the validation set.

## Configuration

Gemini is the primary AI provider. Groq enables fallback text generation, voice transcription, and selectable interviewer voices. Tavily enables date-filtered interview-experience search. Embeddings fall back to local lexical matching:

```env
GEMINI_API_KEY=your_key_here
GROQ_API_KEY=your_groq_key_here # optional AI and voice fallback
TAVILY_API_KEY=your_tavily_key_here # optional recent interview-experience search
```

Optional:

```env
PORT=3000
```

The sample validation dataset contains eight curated examples. Its correlation and error metrics are an implementation benchmark, not evidence of production reliability; add more independently human-scored answers before relying on those metrics.

## Project layout

- `src/` — active React website
- `server/` — active Express API, document processing, Gemini prompts, evaluation, voice transcription, and SQLite session persistence
- `data/` — local application data and SQL session database
- `backend/ai_mock/` — separate FastAPI application retained in the repository; it is not used by the active React website
- `docs/` — project synopsis and planning documents
