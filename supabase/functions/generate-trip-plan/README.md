# AI trip planner function

Deploy `index.ts`, `handler.ts`, `provider-errors.ts`, `deno.json`, `../_shared/ai-planner.ts`, and `../_shared/destination-catalog.ts` together as `generate-trip-plan`. The handler checks the caller's bearer token with the project's Auth `/user` endpoint, so deployment can use `verify_jwt = false` while retaining authentication for every planning request. Guest and expired sessions cannot spend provider quota.

Required server secrets:

- `GEMINI_API_KEY`: create in Google AI Studio and store in Supabase Edge Function Secrets. Never place it in Expo public configuration.
- `SUPABASE_URL` and `SUPABASE_ANON_KEY`: normally injected by Supabase. `SUPABASE_PUBLISHABLE_KEY`, or `SUPABASE_PUBLISHABLE_KEYS` with a `default` value, is also supported for the public key.
- Optional `GEMINI_MODEL`: defaults to `gemini-3.5-flash-lite`, which supports structured output and free-tier text generation. It uses `thinking_level: minimal`; a `gemini-3.8-flash` override uses `low`, and other overrides keep their own thinking defaults. Output is capped at 2,200–5,000 tokens according to trip length, with concise reasons and notes.

The request and response types and runtime validators live in the shared file. Each request makes at most one Gemini Interactions API call with `store: false` and no tools. A researched catalog supplies attractions, stay areas, navigation links, and official destination references; Gemini arranges them into a structured itinerary. Unsupported destinations and insufficient remaining places are rejected before the provider call. Names, URLs and kinds are copied from the catalog; repeated places, excluded names/URLs, invalid days and over-budget results are rejected. No automatic provider retries or paid Maps/Search grounding are used. Text generation still depends on the project's model eligibility and available free quota.

Version 1 responses add optional `basis: "curated"` and `references: [{label, url}]`. The shared validator checks curated places and references against the exact destination catalog. Missing `basis` retains the legacy Google Maps response contract. Navigation links are not evidence of live Google Maps verification. Stay suggestions are accommodation search areas, not hotel endorsements or room offers.

All cost values are planning estimates. The server multiplies room, meal, transport and activity allowances by the requested nights, days and travelers, adds a 10% contingency, and checks the chosen budget ceiling. It never changes estimates to force a plan within budget. No hotel availability, price or live crowd count is verified by this integration.

The whole request, including request parsing, Auth and provider response-body reads, has a 12-second deadline. Unsupported destinations and invalid catalog coverage are checked locally before outgoing Auth or Gemini calls. A timeout returns `UPSTREAM_TIMEOUT` with HTTP 504, allowing the client to offer its clearly labeled offline fallback. Requests and provider responses have byte limits. A per-user cooldown and concurrency guard operate within each warm function isolate only; they are not a durable cross-instance quota. Set provider usage limits for testing and add a durable quota before opening unrestricted public use.

Provider failures use HTTP 503 and distinguish unavailable quota, temporary rate limits and configuration failures. Local cooldown/concurrent requests use HTTP 429. Provider error-body parsing is limited to 32 KB and two seconds. Diagnostic logs contain only the fixed stage/classification, provider status, filtered quota identifiers/numeric values and retry delay; never raw messages, user identifiers, request contents or credentials. Phase events mark successful authentication, provider start and HTTP response. Failure events identify whether authentication, request reading, provider headers/body or validation failed. Successful plans log only elapsed time, basis and place/day counts.

Provider documentation checked during implementation:

- https://ai.google.dev/gemini-api/docs/pricing
- https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite
- https://ai.google.dev/gemini-api/docs/thinking
- https://ai.google.dev/gemini-api/docs/structured-output
- https://ai.google.dev/gemini-api/docs/interactions-overview
- https://supabase.com/docs/guides/functions/auth

Run `npx tsx --test tests/ai-backend.test.ts` from the project root for mocked handler/contract tests. These do not use real API keys, send email, or spend provider quota. Real Gemini model access still requires a configured server key and an authenticated live smoke check.
