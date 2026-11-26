# Wivo 2.2.5: raport

**Haru:** `testing`. Midagi pole pushitud. Andmebaasiga ei ühendunud: kõik SQL
on proovitud ainult kohalikus PGlite'is. Versioon on package.json-is
**2.2.5** ja see on viimane commit. **Migratsioon: 135.** Järgmine number
on 136.

**Kontrollid (viimane seis):**
- Täis testikomplekt: 228 faili, 2984 testi, kõik rohelised.
- `tsc` (web ja node): roheline.
- Build õnnestus nii arvutile kui telefonile. Arvuti `index.html`-is on CSP
  meta. Telefoni `_headers`'is on Report-Only CSP ja HSTS.
- Käsitsi ei ole ma midagi proovinud (vt „Käsitsi testid").

## Commitid

| Osa | Hash | Mis |
|---|---|---|
| Turvaülevaade | `74707e0` | docs/SECURITY-REVIEW-2026-11.md |
| Kodulehe plaan | `4211ee0` | docs/WEBSITE-PLAN.md + ROADMAP |
| P1 + P6 | `704abe4` | Broneeringu IP, kliiniku piir, Turnstile; logid ja Sentry |
| P2 | `b9c2d33` | Electron: `window.electron` ära, välised aadressid, navigeerimise valve |
| P3 + P8 | `1ef5ac8`, `988f52a` | Arvuti CSP, prindiaken; telefoni CSP (Report-Only) ja HSTS |
| P4 + P5 + P7 | `dba2412` | sql/135, töötaja parool `team-account` kaudu, õigused, eelvaade, tagasilink |
| Versioon | (viimane) | CHANGELOG, What's new (en, et, ru), CLINIC-SETUP, 2.2.5 |

## Mis tehti (plaani punktid 1–8)

1. **Broneeringu IP (E1).**
   - **IP:** `clientIp()` võtab esimesena `CF-Connecting-IP`-i (selle kirjutab
     Cloudflare ise üle). Kui seda pole, võtab `X-Forwarded-For`-i **viimase**
     väärtuse, mille lisas platvorm. Esimest väärtust, mille kirjutab saatja, ei
     kasutata kunagi. Selle järgi käivad kõik piirangud ja salvestatud `ip_hash`.
   - **Kliiniku koondpiir:** 30 taotlust tunnis kõigist IP-dest kokku.
   - **Turnstile:** `/request` kontrollib vidina tokenit kliiniku
     `TURNSTILE_SECRET_KEY`-ga ja lubatud domeenide vastu.
     - Kui salavõtit pole, vastab funktsioon 503 „Online booking is not set
       up yet" ega võta midagi vastu.
     - `/services` annab vidinale `turnstileSiteKey`.
   - **Vidin** on kliiniku kodulehel, mitte selles repos. Seal tuleb Turnstile
     näidata ja token saata väljana `turnstileToken`. Kuni seda pole, ei võta
     funktsioon taotlusi vastu.
   - Riia ei kasuta praegu broneeringut (`public-booking` pole seal deploy'tud),
     nii et Dentiksi jaoks pole siin midagi teha.
2. **Electron (A1–A3, A6).**
   - `window.electron` on eemaldatud. See andis lehele terve `process.env`-i
     ja iga IPC kanali, ja rakendus ei kasutanud seda.
   - `setWindowOpenHandler` avab väljas ainult `https:`, `mailto:` ja `tel:`.
     Muu aadress (`file:`, `smb:`, protokollid) jäetakse vahele.
   - `will-navigate` ja `will-redirect` hoiavad akna Wivo enda lehel.
   - Ükski aken ei luba `<webview>`-d.
   - `git-pull` ei tee installitud rakenduses midagi.
   - Märkus: MFA ekraani „Open in app" (`otpauth:`) link arvutis enam midagi
     ei ava. Arvutis skännitakse QR-kood telefoniga; see link on telefoni jaoks.
3. **Arvuti CSP (A4) ja prindiaken (A5).**
   - **CSP** on meta-sildina `index.html`-is, ainult pakitud buildis, sest
     arenduses on React refresh inline-skript.
   - Kontrollisin valmis bundle'i vastu: `eval`-i ja `new Function`-it pole,
     WebAssembly't pole, inline-skripti pole, ja ainus worker tuleb rakenduse
     enda failist.
   - CSP lubab:
     - skriptid ainult rakendusest endast;
     - Supabase'i üle https ja wss;
     - Sentry `sentry-ipc:` kaudu;
     - `blob:` ja `data:` PDF-ide, piltide ja allalaadimiste jaoks.
   - **Prindiaken:** töö print avas varem `window.open('')`, mille Electron
     tagasi lükkas. Seega **töö printimine arvutis ei töötanud**. Nüüd prinditakse
     peidetud raamist samas aknas ja pealkiri on tekst, mitte HTML.
4. **Töötaja parool (D1, sql/135).**
   - **Kolm sammu `team-account` kaudu:**
     1. `authorize_password_set`: omanik, sama kliinik, kood viimase 5 minuti
        seest (sql/120), mitte kunagi teine omanik;
     2. GoTrue Admin API seab parooli;
     3. `complete_password_set` (ainult service role): auditikirje
        `password_set` ilma paroolita, ja töötaja kõik sessioonid ning
        push-tellimused lõpetatakse.
   - Team leht küsib enne koodi (`FreshCodeDialog`).
   - Vana `admin_set_worker_password` on suletud. 2.2.4 arvuti saab teate, et ei
     tohi.
   - Juba välja antud ligipääsutoken kehtib veel kuni tunni. Sessioonid ja
     refresh-tokenid lõpevad kohe.
5. **Õigused (D2, R1, sql/135).**
   - `chat_prune` ja `purge_visit_requests` saab käivitada ainult öine töö.
   - Anon-võtmel pole `public` skeemis ühelgi tabelil, vaatel ega järjestusel
     ühtegi õigust, ka hiljem loodavatel mitte (vaikeõigused).
6. **Logid (E2, E4, L1).**
   - Edge Functionid logivad ainult koha, vea koodi ja puhastatud sõnumi.
     Tagasi lükatud rida, `details`, `hint` ega keha logisse ei jõua.
   - Montonio puhul logitakse ainult staatus.
   - Sentry lõikab ära `Failing row contains (…)`, `Key (…)=(…)`, `DETAIL`
     ja `HINT` väärtused.
   - `file-link` vastab fikseeritud sõnumiga.
7. **Tagasilink ja eelvaade (E3, S2).**
   - Makse tagasilink on ainult `https:`. Muu aadressi puhul linki ei näidata.
   - Eelvaade peab olema PNG, WebP või JPEG ja kuni 5 MB
     (`confirm_job_file_preview`).
8. **Telefoni CSP ja HSTS (W1, W3).**
   - Iga telefonibuild kirjutab `_headers`'isse
     `Content-Security-Policy-Report-Only` päise, kus on täpselt selle buildi
     `VITE_SUPABASE_URL` (https ja wss) ja Sentry host.
   - Lisaks `Strict-Transport-Security: max-age=31536000`.
   - Senine jõus olev `frame-ancestors`/`object-src`/`base-uri` jääb alles.

**F6 (allkirjastatud lingi kestus serveri poolt): ei saa teha ilma 2.2.6-ta.**
Supabase Storage'il pole serveripoolset ülempiiri allkirjastatud lingi
kestusele: kestuse valib see, kes lingi teeb. Senine varutee (grant ja
`createSignedUrl` rakenduses) annab selle valiku kliendile. Ainus serveripoolne
hoob on võtta ära `job_files_select` grant-reegel, nii et kasutaja ei saa ise
üldse allkirjastada. See tähendab, et kõik peab käima `file-link` kaudu (60 s),
mis on täpselt 2.2.6: esmalt miinimumversioon, siis reegel ära, ja patsiendi
eksport ning eelvaated Edge Functioni kaudu.

**Tegevuse märk töökaardil: tegemata.** Seda „eelmist ülesannet" ei leidnud ma
koodist, dokumentidest ega varasematest vestlustest, ega tea, mida märk peab
näitama. Kirjelda see, ja ma teen selle (migratsioon oleks 136).

## Dentiks: täpsed sammud

Dentiksi projekt: `fwsrnsdrlrlmjfkkkhvp` (clinics/dentiks.json). **Kõigepealt
sama test-koopias** (`jhqyvancrzykxhzwnost`), siis Dentiksis. Järjekord:
**andmebaas → funktsioonid → rakendus.**

### 1. Andmebaas (SQL Editor, järjest)

`npm run release -- --clinic dentiks` näitab, mis puudub. Kui 2.2.4 pole veel
Dentiksis, on puudu ka 131–134.

1. `sql/131_realtime_publication.sql` (**üksi**).
2. `sql/132_realtime_files_stage_people.sql` (**üksi**).
3. `sql/133_save_template_one_step.sql`.
4. `sql/134_one_step_notes_defaults_template.sql`.
5. `sql/135_security_review_fixes.sql`. Kui teade ütleb
   `default privileges of supabase_admin not changed: not allowed from this
   session`, on see oodatud: Supabase'i enda tööriistade vaikeõigusi SQL
   Editor muuta ei saa. Sinu (`postgres`) tabelid on kaetud.
6. Eraldi päringuna: `notify pgrst, 'reload schema';`

### 2. Lugevad kontrollid (SQL Editor)

```sql
-- schema_check.sql ja trigger_check.sql (sql/checks/): ühtegi rida
-- Realtime: 18 rida
select tablename from pg_publication_tables
 where pubname = 'supabase_realtime' and schemaname = 'public' order by 1;
-- Anon: 0
select count(*) from information_schema.role_table_grants
 where grantee = 'anon' and table_schema = 'public';
-- Suletud: false, false, false
select has_function_privilege('authenticated', 'public.chat_prune()', 'execute'),
       has_function_privilege('authenticated', 'public.purge_visit_requests()', 'execute'),
       has_function_privilege('authenticated', 'public.admin_set_worker_password(uuid,text)', 'execute');
-- Uus: true (authorize), false (complete authenticated'ile)
select has_function_privilege('authenticated', 'public.authorize_password_set(uuid)', 'execute'),
       has_function_privilege('authenticated', 'public.complete_password_set(uuid,uuid,uuid)', 'execute');
```

### 3. Edge Functionid (enne rakenduse uuendust)

```sh
supabase functions deploy team-account --project-ref fwsrnsdrlrlmjfkkkhvp --no-verify-jwt --use-api
supabase functions deploy account-security --project-ref fwsrnsdrlrlmjfkkkhvp --no-verify-jwt --use-api
supabase functions deploy file-link --project-ref fwsrnsdrlrlmjfkkkhvp --use-api
```

Kui `send-notifications` on Dentiksis, siis ka see (puhastatud logi):
`supabase functions deploy send-notifications --project-ref fwsrnsdrlrlmjfkkkhvp --no-verify-jwt --use-api`.
`public-booking` Riiale ei lähe (CLINIC-SETUP 8.2).

### 4. Rakendus

- `npm run release -- --clinic dentiks` (RELEASE.md). `release:sign` küsib
  kinnitust, et 135 on rakendatud.
- Telefon: Cloudflare'i projekt `wivo-dentiks` ehitatakse `riga` harust, kui sa
  selle edasi liigutad. Tema `_headers` saab `VITE_SUPABASE_URL`-ist
  Dentiksi aadressi.

**Kui järjekord läheb sassi:** 2.2.5 arvuti vanema `team-account` funktsiooniga
ütleb parooli määramisel „failed". Funktsiooni deploy parandab selle. 2.2.4
arvuti 135-ga andmebaasi peal saab parooli määramisel „no permission".

## Käsitsi testid

### A. Arvuti CSP (kas midagi katki ei läinud)

1. `npx electron-vite preview --mode test`: ehitab ja käivitab buildi koos
   CSP-ga, test-koopia vastu. **F12** avab DevToolsi.
2. Consoles ei tohi olla ühtegi `Refused to …` rida, kui käid läbi need sammud:
   - sisselogimine koos koodiga;
   - tööde tahvel;
   - töö avamine;
   - faili eelvaade (pilt);
   - PDF failivaates;
   - 3D hambakaart;
   - märge;
   - fail kahe akna vahel (`npm run dev:test:2` teises aknas);
   - helid;
   - patsiendi eksport (zip ja PDF);
   - arve print.
3. Kui mõni `Refused` tuleb, saada mulle rida: lisan selle aadressi
   `config/csp.ts`-i.

### B. Printimine

1. Ava töö ja vajuta printeri nuppu: avaneb printimise dialoog koos töölehega.
2. Patsient nimega `<b>Test</b>`: pealkirjas on täpselt see tekst, mitte
   paks kiri.

### C. Lingid

1. Märke või vestluse `https://` link avaneb sinu brauseris.
2. `mailto:` avab e-posti programmi.
3. Wivo aken ise ei liigu kuhugi.

### D. Töötaja parool

1. Team → töötaja → „Set a new password" → avaneb koodi dialoog → kood →
   valmis.
2. Töötaja teises aknas (`dev:test:2`): tunni jooksul (ligipääsutokeni kestus)
   viiakse ta sisselogimisse. Uus parool töötab.
3. Settings → Audit log näitab „Password set: <nimi>, signed out of every
   device".
4. Vale või aegunud kood: tuleb teade ja parooli ei muudeta.

### E. Telefoni CSP (Report-Only) eelvaate deploy'l

1. Push `testing` → Cloudflare ehitab `wivo-test` (wivo-test.pages.dev).
   Projekt `wivo` ei tohi teha eelvaateid (CLAUDE.md).
2. Päis:
   ```sh
   curl -sI https://wivo-test.pages.dev/ | grep -iE "content-security|strict-transport"
   ```
   Peab näitama `Content-Security-Policy-Report-Only: … https://jhqyvancrzykxhzwnost.supabase.co wss://jhqyvancrzykxhzwnost.supabase.co …`
   ja `Strict-Transport-Security`.
3. Chrome'is wivo-test.pages.dev → DevTools → Console → **„Preserve log"** sisse.
   Käi läbi:
   - sisselogimine;
   - avaleht;
   - töö;
   - kaamera;
   - failid;
   - seaded;
   - teavitused;
   - lehe uuesti laadimine (service worker).

   Report-Only ei blokeeri midagi, vaid kirjutab `[Report Only] Refused to …`.
   Iga selline rida on aadress, mille CSP jõusse panek blokeeriks.
4. Sama telefonis: Androidis `chrome://inspect` USB kaudu, iPhone'is Safari →
   Develop.
5. Kui nädal on puhas, muudame päise jõusse (järgmine väljalase:
   `Content-Security-Policy-Report-Only` → `Content-Security-Policy`).

### F. Broneering (kui test-koopias on `public-booking`)

1. Cloudflare'i **testvõtmed**: saidivõti `1x00000000000000000000AA` ja
   salavõti `1x0000000000000000000000000000000AA` (lasevad alati läbi).
   Salavõti `2x0000000000000000000000000000000AA` lükkab alati tagasi.
2. **Ilma `TURNSTILE_SECRET_KEY`-ta:** POST `/request` → 503
   `BOOKING_NOT_READY`.
3. **Tokenita:** 403 `HUMAN_CHECK`.
4. **Võltsitud `X-Forwarded-For` iga päringuga uus:** pärast 5 päringut 429.
   Kõigil ridadel `visit_requests.ip_hash` sama:
   ```sql
   select ip_hash, count(*) from visit_requests
    where created_at > now() - interval '1 hour' group by 1;
   ```

### G. Anon-võti

```sh
curl -s "https://jhqyvancrzykxhzwnost.supabase.co/rest/v1/jobs?select=id" -H "apikey: <test-koopia anon>"
```

See peab andma vea (permission denied või second factor), mitte `[]`.
