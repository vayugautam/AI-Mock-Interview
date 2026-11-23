# AI Mock Interview Platform Frontend

This React/Vite application provides the text-based mock interview demo flow:

- registration and login
- dashboard history and progress
- interview setup and generated questions
- typed answer submission
- persisted evaluation results

Set `VITE_API_BASE_URL` to the backend origin when it is not running at
`http://localhost:8000`. Copy `.env.example` to `.env.local` for local
development. Backend secrets, including `GROQ_API_KEY`, must remain server-side.

```powershell
npm install
npm run dev
```

The evaluator label on results reflects the backend provider. The default
backend configuration uses the deterministic mock evaluator; it is not a real
LLM judgment.
