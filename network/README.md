# network/: the Wivo Network project

Files for the separate Supabase project `wivo-network` (docs/PLAN-NETWORK-1.md).
**Never** applied to a clinic's project, and nothing in `sql/` or
`supabase/` is applied here.

| Path | What |
|---|---|
| `sql/001_network.sql` | accounts, the clinic directory, connections; RLS; everything needs aal2 |
| `sql/002_clinic_key.sql` | a clinic's public key and its directory functions (service role only) |
| `functions/network-token/` | a 5-minute Ed25519 token for one clinic |
| `functions/network-clinic/` | a clinic reads or changes its own directory entry, with a request signed by its own key |
| `functions/_shared/networkClinic.ts` | that function's logic (tested in `test/`) |
| `functions/_shared/networkToken.ts` | that function's logic (tested in `test/`) |
| `functions/_shared/generated/token.ts` | copy of `shared/network/token.ts` (`node scripts/copy-shared-to-functions.mjs`) |
| `scripts/make-network-key.mjs` | the signing key pair, written outside the repo |
| `scripts/make-clinic-key.mjs` | one clinic's own key pair (its project's secret + its Network row), outside the repo |
| `test/network.test.ts` | the schema on PGlite and the function's logic |

Set-up steps: docs/NETWORK-SETUP.md.

Migrations here follow the same rules as `sql/`: numbered, only added, never
edited once applied, idempotent.
