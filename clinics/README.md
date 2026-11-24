# Clinics

One file per clinic that gets its own desktop installer and its own signed
releases (docs/RELEASE.md). The release tool and the installer build read
everything clinic-specific from here, so a new clinic is one new file:

    npm run release -- --clinic <id>

Names follow the clinic, never the country or the city.

## `<id>.json` (tracked: public values only)

| Field | What it is | Dentiks |
|---|---|---|
| `id` | The file's name, and the build id the release statement carries. Lowercase letters, digits and `-`; never `main`. | `dentiks` |
| `name` | How the tool and the release page name the clinic. | `Dentiks` |
| `releasesRepo` | The public GitHub repository whose release `stable` holds the clinic's installer, `latest.yml` and `updates.json`. Never main's repository. | `SniperInSuit/wivo-dentiks-releases` |
| `phoneUrl` | The address people open the clinic's phone app at: its own domain when it has one (VITE_PHONE_URL; "What's new" names it). | `https://wivo.dentiks.lv` (custom domain of `wivo-dentiks`) |
| `supabaseRef` | The clinic's own Supabase project. Never production's or the test copy's. | `fwsrnsdrlrlmjfkkkhvp` |
| `cloudflareProject` | The Cloudflare Pages project of the phone app. | `wivo-dentiks` |
| `phoneBranch` | The git branch that project builds. It only ever points at a commit already on `testing`. Never `main` or `testing`. | `riga` |

`scripts/clinicBuild.test.ts` checks every file here.

## `<id>.env` (not tracked: on Kevin's machine only)

One line, the project's public key, which ships in every phone's bundle
anyway:

    VITE_SUPABASE_ANON_KEY=<the anon key, or sb_publishable_…>

The build refuses a secret key, a key of another project, and any other line.
(Lines `VITE_SUPABASE_URL` and `VITE_PHONE_URL` are accepted only when they
say the same as `<id>.json`, so an older env file still works.)

## A new clinic

1. Its Supabase project, phone app and Cloudflare project (docs/CLINIC-SETUP.md,
   with the new clinic's names).
2. A public repository for its releases, with a README (so it has a commit).
3. `clinics/<id>.json` here, and `clinics/<id>.env` on the machine that builds.
4. `npm run release -- --clinic <id> --first`, then the steps in
   docs/CLINIC-ROLLOUT.md with the new clinic's names.
