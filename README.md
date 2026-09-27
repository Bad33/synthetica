# Synthetica

A private workspace for understanding research and tracing explanations back to original passages.

This branch replaces the impact-ranked summary feed with a source-first workflow:

1. **Analyze:** import a text PDF, HTML/TXT file, DOI, HTTPS paper URL, or pasted original text.
2. **Understand:** read the retained source alongside a structured explanation. Expand each citation to inspect the exact quote, passage context, section, and PDF page.
3. **Investigate:** group up to six papers around a question, compare their extracted methods and limitations, and request a cited cross-paper synthesis.
4. **Keep your work:** save private notes, source quotations, tags, reading status, conversations, and collections. Export a Markdown research brief.

## Trust and limits

- **Source facts** are verbatim quotations. **AI interpretations** include explanations and paraphrases with quotations checked against the original stored passages. An exact quotation does **not** establish that the model's interpretation is correct.
- Questions retrieve original text on the server. The client cannot submit a generated summary as evidence. Unsupported or invalidly cited answers produce an explicit unavailable state.
- Uploaded PDFs retain page numbers. HTML and pasted text retain section references. Abstracts and web pages are labelled _provided text_, never silently promoted to full papers. Scanned PDFs require external OCR.
- Limits: 3 MB per file/remote document, 100 PDF pages, 400,000 extracted characters. The file limit accommodates base64 within common serverless request limits. Import has an independent authenticated quota.
- PDF tables/figures are **not** reconstructed as structured data. HTML table/caption text is retained, but no automatic charts are generated. Legacy inferred charts and model-generated impact scores are never displayed.
- Search and Q&A retrieval use PostgreSQL full-text search and deterministic lexical passage ranking, respectively. They are not advertised as semantic search or a knowledge graph.
- DOI and URL imports retrieve the accessible destination, which can be an abstract or landing page. They do not bypass paywalls, do title lookup, or guarantee access to full text.
- Cross-paper interpretations require citations from at least two selected papers; matching quotes alone cannot prove agreement or contradiction. Synthesis is generated on demand; it is not a systematic review.

See [the implementation scope](docs/product-reset.md), [deployment and credential remediation](docs/deployment.md), and [security policy](SECURITY.md).

## Local setup

Requires Node.js 22.13+ and a Supabase project. Application routes use the public anon key plus the authenticated user's bearer token; **no service-role key is needed**.

```sh
git clone https://github.com/Bad33/synthetica.git
cd synthetica
npm ci
cp .env.example .env.local
```

Set the variables from `.env.example`:

| Variable                        | Purpose                                                       |
| ------------------------------- | ------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase project URL                                          |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public Supabase anon key                                      |
| `GEMINI_API_KEY`                | Server-only Google API key                                    |
| `GEMINI_EXTRACTION_MODEL`       | A text-generation model ID enabled for your Google account    |
| `GEMINI_QA_MODEL`               | Optional separate Q&A model; defaults to the extraction model |

No guessed or outdated model ID is hard-coded. Missing AI configuration fails closed with a clear message; source import and reading remain available.

Apply **all** migrations in `supabase/migrations/` in filename order to a fresh Supabase database. Use your linked Supabase CLI migration workflow (`supabase db push`) or the SQL editor. Existing installations that already applied `00001` apply only the new migrations. Back up first; see deployment notes for legacy data handling.

Create user accounts through Supabase Auth administration and keep public sign-ups disabled for this invite-only release. Set a password for each account through your approved Supabase account onboarding flow. Users sign in with email/password. Merely hiding a registration form does not disable public registration: configure Auth on the project itself.

```sh
npm run dev
```

Open `http://localhost:3000`. With no Supabase configuration, the application displays setup guidance and makes no model requests. Use an invite-only staging project to verify real authentication, PDF imports, and the chosen model before production.

## API and storage

All active AI/import endpoints require `Authorization: Bearer <Supabase access token>`.

| Endpoint               | Role                                                                         |
| ---------------------- | ---------------------------------------------------------------------------- |
| `POST /api/ingest`     | Validate, retrieve/parse, chunk, atomically save original source             |
| `POST /api/analyze`    | Extract claims from saved passages; validate quotes; save analysis           |
| `POST /api/chat`       | Retrieve original passages, answer, validate citations, persist conversation |
| `POST /api/synthesize` | Compare evidence across 2–6 authorized papers                                |

Personal library, notes, feedback, and collection operations use Supabase directly under owner RLS. `save_research_source` and `save_research_collection` commit related changes atomically. `consume_research_quota` enforces persistent hourly per-account limits: 10 imports, 10 analyses, 60 questions, 10 syntheses. Unknown actions and unavailable quota storage fail closed.

The canonical model is `research_papers` + immutable `paper_chunks`. Analysis is a derived JSON view with typed claims and exact citations. User-owned tables also include `collections`, `collection_papers`, `notes`, `chat_messages`, and `research_feedback`. All actively used tables, indexes, functions, and policies are in migrations. Old `papers`, embedding columns, and graph functions are retained only as quarantined legacy data; the app no longer uses vector features.

The old `/api/process-paper` and cron endpoints return `410 Gone`. The cron schedule and standalone backfill generator are removed. `/explore` redirects to Investigate.

## Verification

```sh
npm run lint
npm run typecheck
npm test
npm run test:db
npm run build
npx playwright install chromium
npm run test:browser
```

- Unit and API tests cover provenance, Unicode offsets, real PDF parsing, unsupported answers, request bounds, auth/quota ordering, invalid citations, and safe error handling. API provider responses are mocked; no paid model calls occur.
- Database tests execute the migrations in an embedded PostgreSQL runtime (PGlite), exercise RLS with two users, check transactional rollback and cross-owner foreign keys, and verify quotas and legacy access revocation. PGlite uses its built-in UUID function in place of Supabase's `pgcrypto` extension setup.
- Browser tests exercise sign-in, import, source expansion, chat, notes, export, collections, and mobile layout against mocked Supabase/model responses. They are UI integration tests, not proof of a live deployment.
- CI runs these checks on pull requests. Prompt changes should retain the grounding regressions and also be evaluated on a curated, human-reviewed paper set before release; a representative human evaluation set is not yet included.
