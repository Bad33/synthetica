# Product reset: source-grounded v1

## Review baseline

Reviewed main at `b5b06f4f83656d732a63147173d8f9ce36529579` against the user's **Product review feedback** conversation.

The review confirmed three duplicated generators instructing the model to infer chart values; Q&A receiving generated Markdown as "full text"; unauthenticated expensive APIs; a tracked `.env.local`; ordinary reads using service-role credentials; an incomplete migration; arbitrary impact scores and hard-coded category feeds; and duplicate reader implementations. `package.json` also requested Next 14 while the lockfile/configuration described Next 16. The dependency manifests now agree on Next 16.3.6 and React 19.2.8.

## Implemented

| Concern                | Result                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fabricated evidence    | All inference/chart generation paths removed; no legacy chart display; typed quotes validated against original chunks                                   |
| Summary-as-source chat | Authenticated paper ID lookup, server-side passage retrieval, exact citations, unsupported-answer behavior, persisted multi-turn conversations          |
| Privacy and cost       | Validated Supabase identity, owner RLS and foreign keys, persistent atomic quotas, bounded inputs, generic upstream errors                              |
| Source ingestion       | Text PDF/HTML/TXT uploads, HTTPS/DOI retrieval, section parsing, PDF pages, immutable chunks, content hash, atomic storage and deduplication            |
| URL security           | HTTPS only, every redirect revalidated, reserved/private IP rejection, checked DNS address pinned to connection, size/deadline bounds                   |
| Reader                 | Original/explanation/side-by-side views; source facts vs AI interpretation vs user notes; structured research areas and source-backed concept actions   |
| Homepage               | Question-oriented source search, recent private papers, saved investigations; no trending/Hot/impact/carousel/three-domain identity                     |
| Personal workspace     | Accounts, notes, linked quotations, tags, reading status, private feedback, Markdown export                                                             |
| Multiple papers        | Collections, atomic membership updates, extracted side-by-side comparison, cited on-demand synthesis                                                    |
| Engineering            | Reproducible migrations, shared model config, versioned prompts, removed duplicate/dead UI and legacy backfill, regression and browser tests, CI        |
| Secrets                | Tracked `.env.local` deleted; only blank `.env.example` retained; no service-role credentials in application code; operational rotation plan documented |

## Explicitly not claimed as shipped

This release establishes the foundation, rather than silently presenting placeholders as finished features:

- Credential rotation and shared Git-history removal are external operational steps. Rewriting `main` conflicts with this task's instruction not to modify it.
- OCR; reliable structured figure/table extraction; source-verified numeric chart reconstruction; bibliographic reference/entity extraction.
- Full-text access for every DOI/URL; title lookup; all requested discovery filters; vector/semantic search; recommendation ranking across citation, method, and dataset relationships.
- A typed research graph, concept lineage, research timelines, or retraction/correction monitoring.
- Durable background ingestion jobs, retries, and live per-stage progress. Import is synchronous, reports actual parsed counts on completion, and is separate from retryable AI analysis.
- Persistent synthesis artifacts, cross-paper note entities, note editing, resizable panels, and a complete keyboard-shortcut system.
- Team collaboration, profiles beyond Supabase accounts, citation-manager integrations, or a public API product.
- A 70-paper representative human evaluation corpus. Automated tests validate mechanics and selected grounding failures; they do not establish scientific correctness.

The new schema intentionally models currently working features. Future graph, figure, table, job, and external integration schemas should be added with their implementations rather than as unused tables.
