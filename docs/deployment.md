# Deployment and migration

## Previously committed credentials

The repository tracked `.env.local`. This PR removes it from the current tree but **does not revoke secrets or erase prior commits**. Treat every credential ever committed there as compromised.

Before deploying:

1. Rotate/revoke the old Google AI key and Supabase service-role/secret credentials in their provider consoles. If a legacy Supabase JWT signing secret was exposed or legacy keys must be invalidated, follow the provider's supported key-rotation process and account for session invalidation. Review provider access/usage logs.
2. Rotate any other secret values previously stored in that file, including cron secrets. The application no longer requires a cron secret or service-role credential; remove those values from this deployment's environment.
3. Put new server-only credentials in the hosting secret store. Configure the public Supabase URL and anon key separately. Never prefix an API/service-role secret with `NEXT_PUBLIC_`.
4. Coordinate a separate Git-history remediation with repository administrators. It may require history rewriting, force-pushes, collaborator re-clones, cache cleanup, and host support. A normal PR cannot remove secrets from historical commits, forks, or clones. Revocation remains necessary even after cleanup.

No production credentials were used to run this branch's tests, and no provider keys have been rotated by this PR.

## Database rollout

1. Back up the database and test the migrations in a staging Supabase project.
2. Fresh databases apply `00001`, `00002`, and `00003` in order. Existing databases that already applied `00001` apply `00002` and `00003`. If production has manual schema changes, reconcile its migration ledger first; do not replay `00001` over an existing `papers` table.
3. `00002` removes **all policies** and anonymous/authenticated grants on legacy `papers`, and revokes public/client execution of all `match_papers` / `get_graph_data` overloads. Review for any additional custom views or definer RPCs outside this repository that expose legacy data; these cannot be inferred from the old schema file.
4. New private records live in `research_papers` and `paper_chunks`. Existing generated rows remain untouched in the quarantined `papers` table. They have no trustworthy original source or owner and are **not automatically assigned to a user** or treated as grounded evidence. Users should reimport their sources.
5. Owner foreign keys enforce that chunks, notes, and collection membership refer to the same account's paper. Source/chunk updates are restricted; changing original source material means importing a new source.
6. Keep anonymous table access disabled and public Auth sign-ups disabled. Provision approved users and test with two distinct accounts.
7. Old deployments will stop reading legacy papers after `00002`. Schedule migration/application cutover together; this is an intentional breaking product reset. Rolling back only the frontend will not restore the old public policies.

No production migration is applied automatically by CI or by opening this PR.

## Staging acceptance

- Verify a real email/password login and a second account's isolation.
- Import a PDF, an HTML file, pasted text, and a public DOI/URL. Test an abstract-only landing page and an inaccessible source.
- Configure Gemini model IDs that your account can access. Run a short paper analysis, inspect each citation, and ask an unanswerable question.
- Save a note and a collection; reload. Compare two known papers with different experimental settings and manually review the interpretation.
- Verify quota failure and account registration configuration. Set provider-level spend limits/alerts and hosting request limits for the deployment.
- Test PDF parsing in the target serverless runtime. The parser remains a Node external package, including its worker/native dependencies. Use Node 22.13+.
- Confirm the old cron schedule is removed from hosting as well as the repository. Old routes return 410.

## Maintenance

Quotas use per-user UTC database hour buckets. A database operator can periodically delete expired `research_usage` rows; retain enough for operational diagnostics. No unauthenticated cleanup endpoint is exposed. Prompt version is persisted with analysis; existing analyses are cached, so a deliberate model/prompt upgrade needs a controlled invalidation or new versioning migration.
