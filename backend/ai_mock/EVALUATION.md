# Text Answer Evaluation

Evaluation is limited to typed text answers. Speech-to-text, microphone capture,
voice analysis, and multimodal fusion are intentionally out of scope.

The existing evaluation endpoints persist four validated criterion scores:
technical correctness, relevance, completeness, and clarity/structure. The
backend calculates the overall score using the provisional weights
`0.35 / 0.25 / 0.25 / 0.15`, rounded to two decimal places. These weights have
not been calibrated against human assessments.

Technical reference material is evidence for correctness. Company requirements
can affect role relevance but do not replace technical correctness criteria.
Resume content is unverified candidate evidence. Retrieved content is passed to
Groq as data, not instructions, and prompts request concise evidence-based
explanations rather than private chain-of-thought.

An answer can be evaluated only once; repeated requests return a conflict rather
than creating a second result. The deterministic provider remains available for
tests and offline development. Groq results are labeled with provider and model
metadata, and malformed or unavailable provider responses are not persisted.

## Enabling live Groq evaluation

Set `EVALUATION_PROVIDER=groq` and provide `GROQ_API_KEY` in the backend
`.env`, then restart the FastAPI process. The local environment is configured
for Groq; credentials remain backend-only and are never exposed to Vite.
If the provider is unavailable, the API returns an error instead of persisting
heuristic or fake scores.
