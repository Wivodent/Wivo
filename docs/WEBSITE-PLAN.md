# wivodent.com: the website plan

**Status: plan only. Nothing is built.** Waiting for Kevin's OK and the
decisions in §12. The entry in docs/ROADMAP.md ("Website") points here.

**Lühidalt (Kevin):**
- **Mis see on:** Wivo avalik koduleht aadressil `wivodent.com`. Sellest ei
  saa rakendust: rakendus jääb `app.wivodent.com`-i ja konsool
  `admin.wivodent.com`-i.
- **Stiil:** Apple'i moodi rahu ja ruum, tume kosmos, suur tekst, üks mõte
  korraga. Pealause on „The future of dental management". Apple'i fonte, pilte
  ega nimesid ei kasutata.
- **Avaleht:**
  - osakesed lendavad äärtest keskele ja moodustavad Wivo logo, all on suur tekst;
  - alla kerides laguneb logo tükkideks ja iga tükk näitab üht Wivo osa;
  - animatsioon on AI videost lõigatud WebP kaadrid canvas'el, telefonis lühem jada;
  - kui inimene on liikumise välja lülitanud, näeb ta liikumise asemel pilte ja teksti.
- **Funktsioonide otsing:**
  - roheline: olemas;
  - punane: veel pole, koos nupuga „Request this feature";
  - allikas on üks `features.json`, mis tehakse Wivo koodist (litsentsi moodulid
    ja funktsioonide kataloog) iga `main`-i buildiga. Iga release uuendab seda
    ise ja test ei lase kataloogil koodist lahku minna.
- **„Build your Wivo":** vali moodulid (Jobs, Stock, Payroll, Booking,
  Statistics …), labor või kliinik, inimeste arv ja riik. Siis saada soov.
  Hinda ei näidata, kuni sina nii otsustad.
- **Soovid ja tellimused** jõuavad adminikonsooli (`wivo-admin`) ühe Edge
  Functioni kaudu. Konsooli reegel „anon-võtmega mitte midagi" jääb kehtima:
  kirjutab ainult funktsioon, mitte leht.
- **Patsiendiandmeid** sel lehel ega selle vormides pole. Vorm ütleb, et neid
  ei tohi sinna kirjutada.
- **Sinult vaja:** otsused §12-s (raamistik, hinnad, CAPTCHA, keeled,
  juriidilised tekstid, video tööriist).

---

## 1. Goals and principles

1. **One clear story.** A clinic or lab owner understands in one minute what
   Wivo is, sees that it already does what they need (the search), and can ask
   for it (Build your Wivo). Nothing else competes for attention.
2. **Apple-like, not Apple.** Calm, spacious, large type, one idea per
   screen, motion that explains. No Apple fonts (SF Pro's licence does not
   allow web use for this), images, product names or layouts copied from
   apple.com. The look is Wivo's own: deep space, Wivo's colours, Wivo's logo.
3. **True claims only.** Every claim on the page matches the code:
   - the feature search reads what is built, not what is planned;
   - the security section names what exists: the second factor, row
     security, the audit log and signed updates (docs/SECURITY-REVIEW-2026-11.md),
     and nothing the review did not confirm.
4. **Not a medical device (VISION.md, MDR).**
   - The site never says Wivo recommends, ranks or decides treatment.
   - The words are "treatment plan builder" and "price calculator", never
     "generator".
   - The intended purpose is also read from marketing, so the same wording
     rule holds here as in the app.
5. **No patient data, ever.**
   - The forms ask for a clinic and a contact, nothing about patients.
   - The free-text field says so, and its text goes only to Kevin.
6. **Privacy by default.**
   - No cookies.
   - No third-party trackers.
   - Analytics without cookies (Cloudflare Web Analytics), so there is no
     consent banner.
   - Fonts and images come from the site itself.
7. **Fast and accessible.**
   - The first screen works without JavaScript.
   - Motion respects `prefers-reduced-motion`.
   - Every chapter of the story is real text, never text baked into a frame.
   - Budgets in §9.

## 2. Where it lives

| Part | What | Notes |
|---|---|---|
| Code | `website/` in this repository (recommended), or its own repository (decision 1) | In this repo, the site's build reads the feature catalogue and the licence modules straight from `shared/`, so `features.json` can never be older than the code. |
| Hosting | Cloudflare Pages project `wivo-site`: `wivodent.com`, `www.wivodent.com` → redirect to the apex | Builds only from `main` (= what is released), previews off, as `wivo`. Root directory `website/`. |
| Requests | Edge Function `site-intake` in the admin console's Supabase project (`wivo-admin`) | §7. Not in any clinic's project and not in this repo's Supabase. |
| Neighbours | `app.wivodent.com` (phone app, Pages `wivo`), `admin.wivodent.com` (console, behind Cloudflare Access) | The site sets no cookies, so nothing on the apex can reach the subdomains' sessions; each app keeps its session in its own origin. |

**Why in this repository:**
- the catalogue lives next to the code it describes, and a test catches a
  feature the code no longer has;
- one release updates both;
- the site shares nothing at run time with the app: it is a separate build
  with its own dependencies, and it imports from `shared/` only pure data
  (module keys, the catalogue).

**What changes for branches:** nothing. `main` stays the only branch the site
is built from. A push to `main` without a version bump updates the phone app
and the site. Kevin still does every push.

## 3. Look and feel

- **Theme:** a deep space background, near-black blue (`#05070D` to `#0B1020`).
  A sparse star field moves slowly, with parallax on scroll. Wivo's accent
  (`#0AB6C4`) is used for light, never for large surfaces.
- **Type:** one variable sans, self-hosted (Inter or Geist; decision 6).
  - Headlines 64–120 px on desktop, 40–56 px on the phone, tight tracking.
  - Body 18–21 px, line height 1.5.
  - At most two weights on a screen.
- **Space:** each section is at least one screen high, with a single message
  and a lot of empty space. The width of the text is 32–40 characters for
  headlines and up to 64 for body.
- **Motion:**
  - every movement explains something (the parts come together, the logo
    opens into its parts);
  - nothing moves without the person scrolling, except the hero's particles;
  - easing is slow in and slow out, and nothing bounces.
- **Headline copy (draft, for Kevin):**
  - H1: **"The future of dental management."**
  - Under it: "One place for every job, every file, every tooth: for the lab
    and the clinic."
  - Kevin's phrase "the future dental management solution" stays the
    meta description and the page title: `Wivo — the future dental management solution`.
- **Languages:** English first, then Estonian, Russian and Latvian (decision
  5). Each page has its own `hreflang` and its own URL (`/et/`, `/ru/`, `/lv/`).

## 4. The home page

### 4.1 The hero: particles come together into the logo

- **What the visitor sees:**
  - a few thousand light particles drift in from all four edges;
  - they slow down and settle into the Wivo logo in the middle, and the logo
    sharpens into its real SVG;
  - the big headline fades in under it, then a quiet "Scroll" hint.
- **How:**
  - the logo's SVG paths are sampled into target points once, at build time,
    and saved as a small JSON (about 2 000 points);
  - the particles are drawn on a `<canvas>` with WebGL2 (point sprites).
    Where that fails, Canvas 2D is used with fewer particles;
  - each particle eases from a random start on the edge to its target in
    2.5–3.5 s, with a little noise. After that the canvas is swapped for the
    real `<img>`/SVG logo, so nothing keeps the CPU busy.
- **Counts:**
  - desktop 2 000–3 000;
  - phone 600–900;
  - halved when `navigator.hardwareConcurrency <= 4` or the battery saver is on
    (`prefers-reduced-data` where available).
- **Without motion** (`prefers-reduced-motion`): the logo and the headline,
  still.
- **Without JavaScript:** the same, from the HTML.
- **The first paint is the static logo and headline in the HTML.** The
  particles start after it, so the largest paint is never waiting for
  JavaScript.

### 4.2 The scroll story: the logo opens into Wivo's parts

- **What the visitor sees:** scrolling down, the logo breaks into pieces in
  space. Each piece turns, comes forward and becomes one part of Wivo, with a
  short title and one sentence beside it. Then it moves away and the next
  piece comes.
- **The chapters**, one per licence module plus the core, in this order:

  | # | Piece | Module | Text (draft) |
  |---|---|---|---|
  | 1 | Jobs | `jobs` | Every case from order to delivery, stage by stage. |
  | 2 | Files | core of `jobs` | Scans, designs and photos on the job, versioned. |
  | 3 | Stock | `stock` | Lots, expiry dates, and what each job used. |
  | 4 | Payroll | `payroll` | Pay by work type and stage, ready for the accountant. |
  | 5 | Booking | `patients` | Online booking, the calendar and the patient card. |
  | 6 | Invoices | `invoices` | Invoices and payments, with the clinic's rules. |
  | 7 | Statistics | `stats` | What the month made, and where it went. |
  | 8 | Partners | `partners` | A lab and a clinic on one job, without sharing patients. |
  | 9 | Your phone | core | The whole team, on the phone. |

  The texts are drafts. Each is checked against the code before launch (§8).

- **The pictures are a frame sequence cut from an AI video:**
  - one rendered video of the logo breaking apart, 12–18 s, on a black
    background so the star field shows through;
  - with no real people, no patients and no real clinics in it;
  - the tool and its licence for commercial use are decision 7.
- **The pipeline**, a script in `website/scripts/frames.mjs` run by hand, never
  in CI:
  1. `ffmpeg` cuts the video into frames;
  2. it makes **desktop:** 180 frames, 1920 × 1080, WebP quality 70, about
     35–60 kB each (6–10 MB in all);
  3. it makes **phone:** a shorter sequence, 72 frames, a vertical crop of
     1080 × 1920, about 25–40 kB each (2–3 MB);
  4. it writes a manifest (`frames.json`: count, size, which frame range belongs
     to which chapter).

  The frames are committed under `website/public/story/` (they are the site's
  assets; Git LFS if the repository grows too much, decision 8).
- **On the page:**
  - one `<canvas>`, `position: sticky`, as high as the screen. The section
    around it is as tall as the story needs (about 9 screens);
  - the scroll position, through `requestAnimationFrame`, picks the frame
    (`index = round(progress × (count − 1))`). The frame is drawn with
    `drawImage` at the device's pixel ratio, at most 2;
  - **loading:** the first frame is in the HTML as an `<img>`. Then the
    frames of the first chapter load. The rest come in the background in order,
    decoded with `createImageBitmap`, and frames go out of memory more than
    40 frames from where the visitor is (on the phone 20);
  - **the text** is HTML beside the canvas. Each chapter's title and sentence
    fade in over its frame range. The text is the same in the page source, so
    search engines and screen readers read it.
  - **the phone:**
    - uses the shorter sequence;
    - uses a narrower section (about 6 screens);
    - and when it is on mobile data with Save-Data on, uses still images
      instead of frames.
- **Without motion, without JavaScript, or when the frames fail:** every
  chapter as a still picture (one frame) with its text, one under the other.
  That is the same content, without the movement.

### 4.3 After the story

1. **"Does Wivo do that?"**: the feature search (§5), in large, with three
   example questions under the field ("Stock with expiry dates", "Payroll by
   stage", "Online booking").
2. **Built for both sides:** two columns, *For the lab* and *For the clinic*,
   each with what its people do in Wivo every day.
3. **Safe by design**, naming only what is true:
   - the second factor at every sign-in;
   - each clinic's data in its own database, in the EU;
   - an audit log nobody can rewrite;
   - updates signed with a hardware key.

   No certifications are named, because there are none.
4. **Build your Wivo**: a call to action (§6).
5. **Footer:** contact, privacy, terms, the company's details, and the line
   *"Wivo is practice management software. It is not a medical device and does
   not recommend treatment."*

## 5. The feature search

### 5.1 What the visitor does

- Types a question in their own words, in any of the four languages.
- **Green:** Wivo does it. The result shows the feature's name, a sentence, its
  module ("Part of Stock") and where it runs (desktop, phone).
- **Red:** Wivo does not do it yet. The page says "Not in Wivo yet" and shows
  **"Request this feature"**. That opens the request form (§7) with the
  question already filled in.
- A question that matches nothing is red too. The page never guesses a green.
- **Planned work is not shown as coming.** A feature on the roadmap is red like
  any other: the site makes no promises with dates. Whether it says "On our
  list" is decision 9.

### 5.2 Where the answer comes from: `features.json`

**One file, made from the code, at every build of `main`:**

```json
{
  "version": "2.2.4",
  "generatedAt": "2026-11-26T12:00:00Z",
  "core": ["team", "settings", "licence", "audit"],
  "modules": [
    { "key": "jobs", "names": { "en": "Jobs", "et": "Tööd", "ru": "Работы", "lv": "Darbi" }, "requires": [] },
    { "key": "ratings", "names": { "en": "Ratings" }, "requires": ["jobs"] }
  ],
  "features": [
    {
      "id": "stock-expiry",
      "module": "stock",
      "since": "2.0.0",
      "mode": ["lab", "clinic"],
      "platforms": ["desktop"],
      "names": { "en": "Stock with lots and expiry dates", "et": "Ladu partii ja aegumisega" },
      "summary": { "en": "Every lot and its expiry; expired goods are refused on a job." },
      "keywords": { "en": ["inventory", "expiry", "lot", "implant"], "et": ["ladu", "aegumine", "partii"] }
    }
  ]
}
```

- **The modules** come from the code: `MODULE_KEYS` and `MODULE_REQUIRES` in
  `shared/license/token.ts`. Their names come from the same i18n keys the app
  shows (`settings.module*`). The site's module list cannot differ from what a
  licence can switch on.
- **The features** come from a new catalogue in the code,
  `shared/features/catalogue.ts`. It is one entry per thing a customer would
  search for, written in the customer's words, with its module, the version it
  came in, the mode (lab, clinic), the platforms, and keywords in each language.
  It is data only; the app does not read it.
- **A test keeps the catalogue honest** (`shared/features/catalogue.test.ts`):
  - every feature names a module that exists, or the core;
  - every module has at least one feature;
  - `since` is not newer than package.json;
  - every feature has an English name and summary;
  - no two features have the same id;
  - and the MDR word list (`generator`, `recommend`, `diagnos…`) appears nowhere.
- **A feature that is not built is not in the catalogue.** Red is everything
  else. This is what keeps "green" true.
- **Made by** `website/scripts/features.mjs`, the first step of the site's
  build. It reads the catalogue and the module list from `shared/` and writes
  `website/public/features.json`. Cloudflare builds the site from `main`, so
  **every release updates the file without anyone doing anything**.
- **The release checklist** (docs/RELEASE.md) gets one line: a release that
  adds something a customer would look for adds its catalogue entry.
  `CHANGELOG.md` and What's new already list it.

### 5.3 How it searches

- **In the browser,** over `features.json`, which is about 30–80 kB, so it
  needs no server and nothing about the question leaves the page.
- **Matching:**
  - lower case, accents removed (`ä` → `a`, Latvian and Russian included);
  - each word matched against names and keywords;
  - small typos forgiven (edit distance 1 for words of 5 letters or more);
  - every language's keywords searched, whatever the page's language.
- **Scoring:** a name match counts more than a keyword match, which counts more
  than a summary match. Green results need a score above a threshold. Below
  it the answer is red, with "Did you mean …" for the closest feature.
- **What is learned:** whether to count red questions is decision 10. The
  choices are none, or a daily count of red questions without the text, or the
  text only with the visitor's "Request" (§7).

## 6. Build your Wivo

### 6.1 What the visitor does

1. **Lab, clinic, or both.** This is Wivo's own mode switch (laboratory or
   clinical), so the right parts are suggested.
2. **The parts:**
   - one card per module from `features.json`, with its name, two lines and the
     number of features;
   - Jobs, Stock, Payroll, Invoices, Booking (shown for `patients`: the
     patient card, the calendar and online booking are one piece in Wivo),
     Statistics, Partners, Ratings;
   - the core (Team, Settings, Licence, Audit log) is shown as always
     included, not as a choice.
3. **Rules from the code:**
   - a module that needs another (`MODULE_REQUIRES`: Ratings needs Jobs) takes
     it with it, and the page says why;
   - invoices are shown only for the countries the app supports now
     (`invoicesAvailable()`: Estonia today), and elsewhere as "Not yet in your
     country";
   - both rules come from `features.json`, so they change with the code.
4. **How many people** (seats) and **which country**.
5. **The contact:**
   - clinic or lab name;
   - the contact's name;
   - work e-mail;
   - optional phone;
   - optional message (with the no-patient-data line);
   - consent to be contacted, with a link to the privacy notice.
6. **Send.** The page says that Kevin will answer, that nothing is ordered yet
   and nothing is charged. An e-mail confirms it.

### 6.2 Prices

- **Not shown until Kevin decides** (decision 2). Without prices the button
  says "Request an offer".
- With prices, the page sums them from a price list the code does not know (a
  file in `website/`), and the button says "Request this Wivo".
- The request is the same either way.

### 6.3 What happens with the request

- It goes to the admin console as a request of kind `order` (§7).
- In the console Kevin sees the chosen modules, mode, seats and country, and
  with one click prepares the licence command
  (`scripts/make-license.mjs sign --modules …`). **The console still signs
  nothing** (docs/ADMIN-CONSOLE.md principle 3): the command runs on Kevin's
  machine with the YubiKey, as today.
- A new clinic's project and installer follow RIGA-GO-LIVE.md part B and
  clinics/README.md, also unchanged.

## 7. Requests into the admin console

### 7.1 The shape

- **The website writes nothing to a database itself.** It posts to one Edge
  Function, `site-intake`, in the admin console's Supabase project.
- The function checks, cleans and stores the request in one table. The anon
  key gets nothing, as the console's rule says (docs/ADMIN-CONSOLE.md §1.6).
- The function uses the console project's service key, which lives only in
  that function (CLAUDE.md's rule, applied to the console).

**The table** `site_request`, in the console's schema, with RLS, `aal2` and
the audit trigger like every console table:

| Column | Notes |
|---|---|
| `id`, `created_at` | |
| `kind` | `feature` or `order` |
| `language` | the page's language |
| `query` | feature: the search question (≤ 200 characters) |
| `modules`, `mode`, `seats`, `country` | order: checked against `features.json`'s module keys and a country list |
| `org_name`, `contact_name`, `email`, `phone` | lengths limited; e-mail checked for form |
| `message` | ≤ 2 000 characters; free text, shown only to Kevin |
| `consent_at` | when the visitor agreed to be contacted |
| `status` | `new`, `answered`, `became_clinic`, `declined`, `spam` |
| `clinic_id` | set by Kevin when an order becomes a clinic (links to `clinic`) |
| `ip_hash` | a peppered hash for the rate limit (§7.2), never the IP itself |
| `site_version` | `features.json`'s version, so Kevin knows what the visitor saw |

**In the console:**
- a "Requests" page: new first, filters by kind and status, and one click
  "Make a clinic of this", which fills a new `clinic` and `contact` from it;
- the feature requests summed by question, so Kevin sees what is asked for
  most.

### 7.2 Against abuse

The security review found how a public form gets flooded
(docs/SECURITY-REVIEW-2026-11.md, E1). The intake is built against that from
the start:

- **The visitor's IP** is taken only from Cloudflare's `cf-connecting-ip` (or
  the last hop the platform adds). It is never taken from a header the caller
  writes.
- **Limits:**
  - per IP: 5 requests an hour;
  - for the whole site: 200 a day, after which requests are refused with a
    friendly message and Kevin gets one e-mail;
  - both are counted in the table, so they survive a restart of the function.
- **Cloudflare Turnstile** on the form (decision 3: it is a third-party check,
  without cookies). Plus a hidden honeypot field and a minimum time on the
  page (3 s).
- **Only the listed fields are stored.** Anything else in the body is dropped.
  Lengths are checked, and so are module keys against `features.json`.
- **CORS:** only `https://wivodent.com` and its language paths' origin.
- **Errors:** the page gets a fixed message. The function's log gets only a
  code, never the request body (review finding E2).

### 7.3 What Kevin hears

- An e-mail per new request (Resend, the same account as the app's mail). It
  carries the kind, the organisation and the modules, and a link to the
  console. **No free text in the e-mail:** that stays in the console.
- The visitor gets a confirmation e-mail with what they asked for, in their
  language, and no tracking pixels.

### 7.4 Personal data

- **What:** a business contact (name, work e-mail, optional phone) and what
  they asked for. Never anything about patients.
- **Legal basis:** consent and pre-contract steps. The privacy notice says
  what is kept, why, for how long, and how to have it deleted (one e-mail
  to Kevin).
- **How long:**
  - a request that did not become a clinic is deleted after 12 months by a
    scheduled job in the console project;
  - one that became a clinic follows the clinic's contract (ADMIN-CONSOLE §7).
- **Where:** the console's project, in the EU (Stockholm), like the clinics.
- **The lawyer** reads the privacy notice and the consent text before launch
  (decision 4).

### 7.5 Later: the app's "Request a feature"

- docs/ROADMAP.md ("After 2.1.0") plans the app's Settings tile to write to
  the console. It can use the same table with `kind = feature` and a
  `source = app`, through the same function.
- It needs a per-clinic key so the console knows which clinic it is,
  as ADMIN-CONSOLE §5 plans for clinic reports. **Not part of the website
  work**; noted here so the table is made ready for it (`source`, nullable
  `clinic_id`).

## 8. Content and legal

- **Every claim checked against the code** before launch: each chapter text,
  the "Safe by design" lines, and the feature search's catalogue. That check
  is done again in the release review of any release that changes one.
- **Pages:**
  - home;
  - features (the search, full page);
  - Build your Wivo;
  - security (a plain page of what is true);
  - contact;
  - privacy notice;
  - terms of use of the site;
  - company details (imprint).
- **The lawyer:** privacy notice, consent text, the "not a medical device"
  line, and the security page's wording (decision 4).
- **Pictures:**
  - only the AI video's frames, Wivo's own screenshots and the logo;
  - screenshots use demo data only (the demo seed, `scripts/demo-seed.mjs`),
    never a clinic's;
  - no stock photos of patients.
- **Brand:** `brand/Wivo Logo 2000.png` is a raster image. The hero needs the
  logo as clean SVG paths (one path per piece, so the pieces can break apart
  in §4.2). That is a design task before anything else (§11, P0).

## 9. Performance and accessibility budgets

| What | Desktop | Phone |
|---|---|---|
| Largest paint | < 1.8 s | < 2.5 s (4G) |
| JavaScript before the first paint | 0 kB | 0 kB |
| JavaScript in all (hero + story + search) | < 120 kB gz | < 120 kB gz |
| Frames, downloaded while scrolling | 6–10 MB | 2–3 MB, or none with Save-Data |
| Layout shift | < 0.05 | < 0.05 |
| Lighthouse (performance, accessibility, SEO) | ≥ 95 | ≥ 90 |

- Text contrast is at least 4.5:1 on the dark background, and focus rings are
  visible.
- Every control works with the keyboard. The search results are announced
  (`aria-live`).
- The story's text order is the chapter order in the HTML.
- A check in the site's CI step runs Lighthouse on the built pages and fails
  under the budget.

## 10. Security headers

From the first deploy, in `website/public/_headers` (lessons from the review,
W1 and W3):

```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self' https://challenges.cloudflare.com; connect-src 'self' https://<console-project>.supabase.co https://challenges.cloudflare.com; img-src 'self' data:; style-src 'self'; font-src 'self'; frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
```

- The site has no inline scripts, so `script-src 'self'` works. The site's one
  outside address is the console's intake function.
- `includeSubDomains` covers `app.` and `admin.` too. That is right, but it
  is a step Kevin confirms (decision 11), because it cannot be undone quickly.

## 11. Build order

The website is not a step on the app's version ladder (docs/ROADMAP.md): it
changes nothing in a clinic's Wivo. It runs alongside the 2.2.x/2.3.x
releases. The catalogue (P1) is the only part that touches the app's
repository code.

| Phase | What | Size | Needs |
|---|---|---|---|
| **P0** | Copy (en), the logo as SVG pieces, the AI video and its frames, design of the four screens (hero, one chapter, search, Build your Wivo) | M | decisions 6, 7; a designer or Kevin |
| **P1** | `shared/features/catalogue.ts` with its test, `website/scripts/features.mjs`, about 60 features for what 2.2.4 does | M | — |
| **P2** | The static site: pages, layout, the hero with particles, `_headers`, Cloudflare Pages project `wivo-site` | M | decision 1; Kevin: DNS and the Pages project |
| **P3** | The scroll story: canvas, frame loading, the phone sequence, the still fallback | M | P0's frames |
| **P4** | The feature search, with green, red and "Request this feature" | S | P1 |
| **P5** | `site-intake` and `site_request` in `wivo-admin`, the console's Requests page, e-mails | M | decisions 3, 4; the lawyer's text |
| **P6** | Build your Wivo | S | P1, P5; decision 2 |
| **P7** | Estonian, Russian, Latvian; Lighthouse in CI; the claims check; launch | M | native speakers (ROADMAP-2.5 §4) |

## 12. Decisions for Kevin

1. **Where the code lives:** `website/` in this repository (recommended,
   §2), or a repository of its own.
2. **Prices on the site:** none ("Request an offer"), from-prices, or a full
   price list in Build your Wivo.
3. **Turnstile on the forms:** yes (recommended), or only the honeypot and the
   limits.
4. **The lawyer:** privacy notice, consent, the not-a-medical-device line, the
   security page.
5. **Languages at launch:** English only, or all four.
6. **The typeface:** Inter or Geist (both free to self-host), or a paid one.
7. **The AI video:** which tool, its licence for commercial use, and who
   renders it.
8. **The frames in Git:** plainly (about 13 MB), or with Git LFS.
9. **Planned work in the search:** red only (recommended), or red with "On our
   list".
10. **What the search learns:** nothing, a daily count of red questions, or
    the question only with a request.
11. **HSTS with `includeSubDomains`:** yes once `app.` and `admin.` are
    confirmed HTTPS only (they are, on Pages).
12. **The domain:** `wivodent.com` at the apex on Cloudflare (DNS there
    already?), `www` redirecting to it.

## 13. Risks

- **A green that is not true** is the worst outcome for a sales page. The
  catalogue's test, and the rule that only built work is in it, are what stop
  that. A feature switched off by a licence is still green (it exists). Its
  card says which module it needs.
- **The story's weight on a phone.** The shorter sequence, the 20-frame memory
  window and the Save-Data fallback keep it small. Measure it on a mid-range
  Android before launch.
- **The form as a spam target.** §7.2 is built for it from the start. The
  first week after launch, Kevin looks at the Requests page daily.
- **MDR wording** creeping into marketing copy. The catalogue test covers the
  catalogue. The chapter texts and pages get the same check in the claims
  review (§8).
- **The console exposed to the internet.** Only `site-intake` is public in
  the console project, and it can only insert one kind of row. The console's
  pages stay behind Cloudflare Access and the second factor.
