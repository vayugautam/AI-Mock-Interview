# Consolidated Interview Platform

This workspace combines TalentPulse's multimodal interview workflow with the AI Mock Interview FastAPI application.

## Main application

The root React/Vite and TypeScript server remain the primary application. The interview UI has been restyled with warm neutral surfaces, restrained brown accents, tighter corners, and lighter typography to give it a quiet, minimal feel.

## Integrated AI Mock Interview application

- FastAPI backend: `backend/ai_mock`
- AI Mock Interview React frontend: `ai-mock-frontend`
- Backend environment: `backend/ai_mock/.env` (copied from the original AI Mock Interview backend; do not commit)
- Implementation report: `AI-MOCK-IMPLEMENTATION-REPORT.md`

Start the FastAPI service from the workspace root with `npm run ai:api` after installing `backend/ai_mock/requirements.txt` in your Python environment. Start the preserved AI Mock Interview frontend with `npm run ai:web` from its folder (install its `package.json` dependencies first). The existing root app still runs with `npm run dev`.

The AI Mock Interview application retains its own API and frontend contracts under this workspace so its auth, resume, company research, interview, and evaluation capabilities remain available while the TalentPulse multimodal workflow stays intact.
