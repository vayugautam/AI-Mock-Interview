# Company research

The backend exposes an authenticated `POST /api/v1/company-research` endpoint.
It uses the replaceable `SearchProvider` interface and defaults to the
server-side Tavily REST API. Set `TAVILY_API_KEY` and keep
`COMPANY_SEARCH_PROVIDER=tavily` in the backend environment. The legacy
`DuckDuckGoHtmlSearchProvider` remains available by explicitly selecting
`duckduckgo_html`.

The orchestration is bounded by configurable search-call, page, byte, timeout,
and retry limits. It retrieves only public HTTP(S) pages, rejects private,
loopback, link-local, metadata, and credential-bearing URLs, and does not
bypass authentication, CAPTCHAs, or access restrictions.

Evidence extraction is deterministic and does not require Groq. Retrieved text
is treated as untrusted data; embedded instructions are not executed or
treated as application policy. Question generation passes the validated
research profile to Groq when `QUESTION_GENERATION_PROVIDER=groq`.

Use `COMPANY_SEARCH_PROVIDER` to select a future provider implementation.
Production deployments should review the selected provider's terms and
configure any required credentials in server-side environment variables only.

## Persistent cache

Research profiles are persisted in `company_research_cache`, keyed by normalized
company, role, and region. The default TTL is 24 hours and is configured with
`COMPANY_RESEARCH_CACHE_TTL_HOURS`. Use `POST /api/v1/company-research?refresh=true`
to force live research.

Cache records retain structured findings and source metadata, including the
original retrieval timestamps. A job-description URL/text is represented only
by a SHA-256 fingerprint; raw user-supplied job-description text is not stored.
When live research fails, a matching expired record may be returned with
`cache_status: "stale"` and an explicit limitation. A changed job-description
fingerprint prevents reuse of the old result.
