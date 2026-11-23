# AI Mock Interview Platform — Revised Implementation Plan (Semester 7 & Full Synopsis Alignment)

This revised plan organizes the implementation explicitly around your **Semester 7 Work Plan** milestones from Section 3.1 of the synopsis—ensuring every dataset, speech preprocessing stage, RAG module, rubric evaluator, fusion strategy, and empirical evaluation metric is built accurately inside the live React + Express application, alongside the Semester 8 modules confirmed earlier.

## User Review & Confirmed Decisions

> [!IMPORTANT]
> This revision preserves your confirmed Phase 1 choices while elevating **audio waveform preprocessing** and **4-way Semester 7 evaluation benchmarking** to first-class deliverables.

- **Confirmed Runtime Architecture**: Runs live on port 3000 with the React frontend and Express TypeScript API implementing the exact relational database schema (`users`, `knowledge_chunks`, `interview_sessions`, `answers`, `evaluations`, `annotated_eval_set`), hashed password authentication (`scrypt`), RAG embedding store, audio pipeline, and Early/Late fusion engine.
- **Strict Synopsis Alignment (Zero Hiring Verdicts)**: Replaces resume shortlisting and corporate hiring verdicts with academic placement preparation, fixed 5-criterion `/10` rubric scoring, performance bands (*Needs Improvement, Satisfactory, Good, Excellent*), and an explicit academic practice disclaimer.
- **Semester 7 Core + Confirmed Semester 8 Modules**: Prioritizes all 7 technical Semester 7 milestones (including real 16kHz resampling, silence trimming, volume normalization, and 4-way benchmark correlation metrics) while integrating the confirmed Semester 8 modules (structured explanation feedback, session trends analytics dashboard, and off-topic threshold re-answer gate).

---

## 1. Overview & Core Concept

- **What It Does**: A multimodal academic interview preparation and evaluation research platform across core placement subjects (**DSA, DBMS, Operating Systems, Computer Networks, OOP, Web Development, AI/ML Basics, and HR/Behavioural**).
- **Semester 7 Core Pipeline**:
  1. **Knowledge Base & Annotated Dataset (D1)**: Curated chunks with vector embeddings (`gemini-embedding-2`) plus an annotated evaluation set containing *Strong, Average, Weak,* and *Off-Topic* human-scored answers.
  2. **Auth, Profiles & Relational Store (D2)**: Salted/hashed user registration & login, candidate profile settings, and relational-structured persistence for sessions, transcripts, feature vectors, and evaluations.
  3. **RAG Question Generation**: Semantic retrieval from D1, structured prompt construction avoiding repeats, schema validation, and curated fallback.
  4. **Answer Preprocessing & Speech Pipeline**: Browser audio capture, 16kHz resampling, leading/trailing silence trimming, RMS volume normalization, speech-to-text transcription (`gemini-3.5-transcribe` + Web Speech), filler removal (raw vs. cleaned transcript), and delivery feature extraction (WPM, pause frequency, filler count, duration).
  5. **Rubric-Based Answer Evaluator**: Structured 5-criterion evaluation (*Technical Correctness, Relevance, Clarity, Completeness, Communication*) using distinct Technical and Behavioural (STAR) rubrics.
  6. **Evaluation Fusion & Scoring**: Compares **Feature-Level (Early) Fusion** vs. **Decision-Level (Late) Fusion** on a `/10` scale with consistency indicators and performance bands.
  7. **Semester 7 Validation Benchmark**: Evaluates the Question Generator, Content-only baseline, Delivery-only baseline, Feature-level Fusion, and Decision-level Fusion against human ground truth using **Pearson ($r$), Spearman ($\rho$), MAE, Performance-Band Accuracy (%), and Response Time (ms)**.
- **Confirmed Semester 8 Extensions Included**: Answer-level missing-concept explanations, off-topic threshold gate (`< 3.5 / 10` re-answer prompt), adaptive follow-up questions, and multi-session progress analytics charts.

---

## 2. User Experience & Visual Design

### Key User Flows (Mapped to Synopsis Work Plan)

1. **Authentication & Candidate Profile**: Clean Sign In / Create Account screen (hashed password verification + 1-click demo candidate) with top-right Dark/Bright mode switch.
2. **Interview Configuration (Question Generation Setup)**:
   - Vertical tap-to-open scrollable selectors for **Subject / Track** (DSA, DBMS, OS, CN, OOP, Web Dev, AI/ML, HR/Behavioural, Full Stack) and **Difficulty Level** (Beginner/Junior, Intermediate, Advanced/Senior).
   - Segmented **Interview Type** switch (*Technical* vs. *Behavioural / HR*), **RAG Context Grounding** toggle, and **1–10 Question Count** selector.
3. **Multimodal Interview Studio (Speech Pipeline + Evaluation)**:
   - **Typed Mode**: Live 1,000-character meter, spell-check feedback, and explicit *Content-Only Mode (Delivery Metrics Unavailable)* indicator.
   - **Voice Mode**: Records live microphone audio (`MediaRecorder` + Web Audio pipeline), runs real **16kHz resampling, silence trimming, and peak/RMS normalization** client/server-side, renders a live waveform/preprocessing badge showing trimmed duration & normalized gain, transcribes into **Raw Transcript** (preserving fillers for delivery scoring) and **Cleaned Transcript** (repeated fillers removed for content scoring).
   - **Rubric Evaluation & Off-Topic Guard**: Displays `/10` score, Performance Band, 5-criterion breakdown, Content vs. Delivery normalized feature vectors, Early vs. Late fusion score comparison, Consistency Indicator, and triggers an **Off-Topic Re-Answer Gate** if Relevance drops below threshold.
4. **Knowledge Base Curator (D1 Tab)**: Browse, filter, and search chunked reference Q&A pairs across all 8 subjects, inspect vector embedding status, and add/index new reference questions and rubrics into D1.
5. **Semester 7 Benchmark & Validation Tab**: Dedicated empirical evaluation console showing:
   - The **Annotated Evaluation Set** (*Strong, Average, Weak, Off-Topic* sample responses with human ground-truth scores).
   - A live **"Run Semester 7 Evaluation"** runner testing **Question Generation Latency/Validity**, **Content-Only**, **Delivery-Only**, **Feature-Level (Early) Fusion**, and **Decision-Level (Late) Fusion**.
   - Comparative tabular results displaying **Pearson $r$, Spearman $\rho$, MAE, Performance-Band Accuracy (%), and Mean Response Time (ms)** with `tabular-nums` alignment.
6. **Analytics Dashboard & Session Report**: Shows category-wise strengths, recommended study topics, multi-session `/10` score trends, and speaking fluency trends (WPM & filler reduction).

### Visual Identity & Theme

- **Aesthetic Direction**: Academic engineering research workbench — clean, structured, high-contrast surfaces with zero generic visual fluff.
- **Color Palette & Surface Hierarchy**:
  - *60% Neutral Canvas*: Crisp off-white (`#F8FAFC`) in Bright Mode / deep slate (`#020617`) in Dark Mode.
  - *30% Structural Surfaces*: Crisp white (`#FFFFFF`) / dark slate (`#0F172A`) cards with `1px` hairline borders (`#E2E8F0` / `#1E293B`), strictly single-level elevation (no nested cards or thick left accent bars).
  - *10% Semantic Accents*: Indigo (`#4F46E5`) primary actions; paired status badges with explicit text labels (*Excellent, Good, Satisfactory, Needs Improvement, Off-Topic*).
- **Typography & Anti-Slop Rules**: `Plus Jakarta Sans` headings + `DM Sans` body + `JetBrains Mono` (`tabular-nums`) for all scores, WPM, correlation coefficients, and latency timings; unboxed metadata with `·` separators instead of capsule pill islands; no decorative pulsing dots.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1 — Real Audio Waveform Preprocessing Before Transcription**:
  - *Chosen Approach*: Use the browser `AudioContext` / `OfflineAudioContext` to decode captured microphone recordings, resample to **16,000 Hz mono**, trim leading/trailing silence below an amplitude threshold, normalize RMS amplitude, encode a clean WAV payload for `gemini-3.5-transcribe`, and compute pause intervals from energy envelopes.
  - *Why*: Directly implements Section 2.5 and Semester 7 milestone 5 ("resampling, silence trimming, speech-to-text transcription and delivery-feature computation") with authentic signal measurements rather than placeholder timers.
  - *Alternatives Considered*: Relying solely on `SpeechRecognition` wall-clock time, which lacks silence trimming and waveform normalization.

- **Decision 2 — Four-Way Empirical Comparison in Semester 7 Evaluation**:
  - *Chosen Approach*: Evaluate four distinct scoring modes against the human-annotated evaluation set—**Content-Only**, **Delivery-Only**, **Feature-Level (Early) Fusion**, and **Decision-Level (Late) Fusion**—alongside Question Generator schema validity and response latency.
  - *Why*: Matches the exact Semester 7 evaluation requirement ("Evaluating the question generator, the individual content and delivery analysis, and the initial fused evaluator using agreement with human scores").
  - *Alternatives Considered*: Only comparing Early vs. Late fusion without isolating single-signal Content and Delivery baselines.

- **Decision 3 — In-Process Vector Retrieval (D1) & Relational Persistence (D2) in Express**:
  - *Chosen Approach*: Store normalized chunked records with `gemini-embedding-2` vectors in D1 and compute cosine similarity in Express; persist normalized relational entities (`users`, `sessions`, `responses`, `evaluations`) to disk-backed stores in D2.
  - *Why*: Keeps the full system self-contained on port 3000 with zero external Qdrant/FastAPI deployment friction while matching the synopsis DFD and schema contracts.

---

## 4. Technical Architecture & Data Strategy

### Semester 7 Pipeline & DFD Mapping

```
┌────────────────────────────────────────────────────────────────────────────┐
│                     REACT INTERVIEW & EVALUATION WORKBENCH                 │
│  [Auth] ──► [Config (Role/Type/Diff/1-10)] ──► [Studio: Text & 16kHz WAV]  │
│  [Knowledge Base (D1)]   [Analytics & Report (/10)]   [Sem-7 Benchmark]    │
└────────────────────────────────────┬───────────────────────────────────────┘
                                     │ REST / JSON + Preprocessed Audio
┌────────────────────────────────────▼───────────────────────────────────────┐
│                   EXPRESS BACKEND & AI EVALUATION ENGINE                   │
│                                                                            │
│  (1) D1 Knowledge Base & Dataset                                           │
│      ├─ Chunked Q&A across 8 placement subjects + Rubrics                  │
│      └─ Vector Embeddings (gemini-embedding-2) + Cosine Similarity Top-K   │
│                                                                            │
│  (2) Question Generator (RAG + Schema Validator)                           │
│      └─ D1 Context + Non-repeat History ──► gemini-4-hydrogen ──► Q Schema │
│                                                                            │
│  (3) Speech & Text Preprocessing Pipeline                                  │
│      ├─ Audio: 16kHz Resample ─► Trim Silence ─► Normalize ─► STT          │
│      └─ Transcript: Raw (WPM, pauses, fillers) vs Cleaned (content only)   │
│                                                                            │
│  (4) Feature Extraction & Dual Fusion Evaluator (Early vs Late)            │
│      ├─ Content Vector [0..1]: Semantic Sim + Concepts + Length + STAR     │
│      ├─ Delivery Vector [0..1]: WPM + Pause Ratio + Filler Density         │
│      ├─ Early Fusion: Features + Context + Rubric ──► gemini-4-hydrogen    │
│      └─ Late Fusion: Weighted Score (LLM + Semantic + Delivery)            │
│                                                                            │
│  (5) Semester 7 Evaluation & D2 Relational Store                           │
│      ├─ Saves Sessions, Responses, 5-Criterion /10 Scores & Bands          │
│      └─ Computes Pearson r, Spearman ρ, MAE, Band Acc %, Latency (ms)      │
└────────────────────────────────────────────────────────────────────────────┘
```

### Data Model & Interactive State Mapping

- **D1 (`KnowledgeChunk`)**: Chunk ID, subject, interview type (`technical` | `behavioural`), difficulty, question prompt, reference answer, expected concepts list, rubric focus, and `gemini-embedding-2` embedding array.
- **D2 (`SessionRecord` & `AnswerEvaluationRecord`)**: User ID, configuration (`subject`, `interviewType`, `difficulty`, `questionCount`, `ragEnabled`), retrieved chunk IDs, audio preprocessing telemetry (`sampleRateHz`, `trimmedMs`, `normalizedGainDb`), raw & cleaned transcripts, normalized content/delivery feature vectors, 5-criterion scores (`/10`), `earlyFusionScore`, `lateFusionScore`, `finalScore` (`/10`), `consistencyScore`, `performanceBand`, `isOffTopic`, `missingConcepts`, and `adaptiveFollowUp`.
- **Annotated Evaluation Set (`ValidationSample`)**: Curated *Strong, Average, Weak,* and *Off-Topic* benchmark cases with human ground-truth per-criterion and overall `/10` scores, voice delivery metadata, and live-computed **Content-Only, Delivery-Only, Early Fusion, and Late Fusion** runs for Pearson $r$, Spearman $\rho$, MAE, Band Accuracy, and Response Time reporting.
