# Security

Report vulnerabilities through the repository's private reporting channel if enabled, or contact the maintainer privately. Do not post credentials, private papers, or exploitation details in a public issue.

## Boundaries

- APIs validate Supabase bearer tokens using `auth.getUser`; user data queries keep that caller's identity and RLS applies. No service-role key is used by the app.
- Database policies enforce ownership, including composite foreign keys for cross-table links. Legacy public data and graph RPCs are quarantined.
- AI and import endpoints fail closed when authentication or persistent quota enforcement is unavailable. Input bodies, documents, questions, model outputs, and remote fetches are bounded.
- Remote sources allow only public HTTPS destinations; redirect targets are checked again and DNS resolution is pinned for each connection.
- Source text and model responses are rendered as React text, not raw HTML. Quoted evidence must match retained passages. Model instructions treat source text and conversation content as untrusted data.
- No fabricated charts or impact scores are shown. Citation checks validate literal provenance, **not** the correctness of an interpretation or the scientific validity of a source.

## Known operational work

Previously tracked secrets must be rotated outside this PR; deleting `.env.local` is insufficient. Follow [deployment remediation](docs/deployment.md). Private user accounts are invite-only: disable public registration at Supabase, not just in the UI. Per-user quotas do not replace provider spend controls or deployment-level abuse protection.

The PR's automated tests use fixture providers and an embedded PostgreSQL database; staging verification against real services is required before production rollout.
