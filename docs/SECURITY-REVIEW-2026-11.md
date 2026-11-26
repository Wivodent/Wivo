# Wivo turvaülevaade, november 2026

**Seis:** haru `testing`, commit `63caa72` (Wivo 2.2.4), migratsioonid kuni 134.
**Kuidas tehtud:** loetud kood ja `sql/` migratsioonid. Andmebaasi kohta tegin
ainult lugevaid kataloogipäringuid kohalikus PGlite'is, mis ehitatakse kõigist
migratsioonidest (`sql/test/harness.ts`, `freshDb()`). Ühegi päris projektiga
(test-koopia, produktsioon, Riia) ei ühendunud. Koodi ega andmebaasi ei muutnud.
**Ei ole kaetud:**
- `wivo-admin` repo;
- Supabase'i ja Cloudflare'i armatuurlaua seaded (Auth piirangud, sessiooni
  kestus, Storage'i ülempiir, HSTS);
- päris rünnakutest ehk pentest;
- partneri vaadete sisu, mis on sql/092 testidega juba kaetud ja mida siin uuesti
  rida-realt läbi ei käidud.

Raskus: **kriitiline** (andmed lekivad praegu ilma eelduseta),
**kõrge** (otse ära kasutatav), **keskmine** (vajab eeldust või on
kaitse-sügavuses auk), **madal** (väike mõju või ainult sisemisele kasutajale).

**Kokkuvõte:**
- Kriitilist leidu ei ole.
- Üks kõrge leid: avalik broneeringuvorm, mille päringupiirangust saab mööda.
- Keskmisi leide on kuus: Electroni karastus, CSP puudumine, failide
  allkirjastatud lingi kestus, töötaja parooli määramine, logid ja
  anon-õigused.
- Andmebaasi põhi on tugev:
  - RLS on igal tabelil;
  - teist faktorit nõutakse kõikjal;
  - teise kliiniku ridu ei näe, ja seda kontrollib generiline test iga tabeli kohta;
  - anon-võtmega ei saa käivitada ühtegi funktsiooni;
  - auditilogisse saab ainult lisada ja seal pole nimesid.

---

## 1. RLS

**Mis on korras (kontrollitud kataloogist ja olemasolevatest testidest):**
- `public` skeemis on 56 tabelit ja **igaühel on RLS sees**
  (`securityAdvisor.test.ts`: `rls_disabled_in_public`).
- **55 tabelil on piirav `mfa_required` reegel** (sql/098). Ainus erand on
  `profiles`, ja see on tahtlik: ainult parooliga (aal1) sessioon tohib lugeda
  oma profiili rida. Seda piirab `db_pre_request`, mis keelab aal1-l kõik muu,
  ka funktsioonid (`requireMfa.test.ts`).
- **Teise kliiniku andmed:** `rlsTenantIsolation.test.ts` käib läbi iga tabeli,
  ka hiljem lisatud tabelid. Ta loob kliinikule A rea ja kontrollib, et kliinik B
  ega anon ei näe ega muuda seda.
- 13 tabelit on ilma `org_id`/`clinic_id` veeruta: `invoice_lines`,
  `messages`, `job_share` ja teised. Nende reeglid käivad vanema rea kaudu
  (`payout_id in (select id from worker_payouts)`, `in_channel(...)`), ja sama
  test katab needki.
- **Anon:** ühelgi reeglil pole otse rolli `anon`. Reeglid, mis on PUBLIC-ile,
  tuginevad `auth.uid()`/`my_org_id()` väärtusele, mis anon'il on null. Seega
  anon ei näe ühtegi rida (`anonFunctions.test.ts`: „reading a table still gets
  nothing").
- **Õigusteta reeglid:** kuuel tabelil on RLS ilma lubava reeglita (`wivo_*`
  ledger, `bug_report`). Neid loevad ainult definer-funktsioonid ja teenuse võti.

**Leiud:**

| # | Raskus | Kus | Mis | Kuidas ära kasutada | Parandus | Migratsioon |
|---|---|---|---|---|---|---|
| R1 | madal | Supabase'i vaikimisi õigused, 51 tabelit | Anon-rollil on tabeliõigused (SELECT, INSERT, …). Praegu peatab need RLS. | Ainult siis, kui mõni tulevane reegel kogemata lubab anon'i. | Võta anon'ilt kõik tabeliõigused (SEC4). Lisa test, et anon'il pole ühtegi tabeliõigust. | jah |
| R2 | info | `profiles` | Tabelil pole `mfa_required` reeglit. See on tahtlik: kaitse on `db_pre_request`-is. | Kui `pre_request` ühel päeval PostgREST-i seadetest kaob, näeb aal1 sessioon profiile oma kliinikus. | Lisa `schema_check.sql`-i kontroll, et `db_pre_request` on seadistatud. Märkus: see on armatuurlaua/konfi asi. | ei |

## 2. SECURITY DEFINER funktsioonid

**Mis on korras:**
- 199 definer-funktsiooni ja **igaühel on `search_path`**: 194-l `public`, 5-l
  `public, extensions`. Ükski `search_path` ei sisalda skeemi, kuhu
  `authenticated` või `anon` saaks objekte luua.
- **Anon ei saa käivitada ühtegi funktsiooni** peale `pre_request` ja
  `require_mfa_for_api` (sql/101, `anonFunctions.test.ts`). Iga uus migratsioon
  lõpeb `lock_anon_functions()`-iga.
- `authenticated` saab käivitada 100 funktsiooni, mis ei ole triggerid. Lugesin
  kehad läbi selle järgi, kas need kontrollivad kliinikut ja õigust. Kõik peale
  allolevate kontrollivad kliinikut ja õigust, kas otse
  (`my_org_id()`, `has_perm`, `can_read_own_job`, `is_org_admin`) või abifunktsiooni
  kaudu:
  - ladu kontrollib `my_stock_item`: `stock.write` ja oma kliinik, rea luku all;
  - failid kontrollib `may_read_job_files`: oma töö või jagamine;
  - etapid kontrollib `may_edit_job_stages`.

  Partneri eest kaitseb sql/092 (`partner_no_identity` testid).
- Definer-vaateid pole: kõik 5 vaadet on `security_invoker`.

**Leiud:**

| # | Raskus | Kus | Mis | Kuidas ära kasutada | Parandus | Migratsioon |
|---|---|---|---|---|---|---|
| D1 | keskmine | `admin_set_worker_password` (sql/030, 113); rakenduses `WorkersPage.tsx:252` | Omanik määrab töötaja parooli. **Auditikirjet ei teki**. Värsket teist faktorit ei nõuta (`admin_delete_worker` nõuab `require_own_mfa()` kaudu). Töötaja avatud sessioone ei lõpetata. Parool läheb RPC parameetrina läbi PostgREST-i. | Omaniku avatud masinast saab vaikselt töötaja parooli vahetada, ja jälge ei jää. Sisselogimiseks on vaja ka töötaja teist faktorit, nii et otsene ülevõtmine pole lihtne. Aga muutus on jälgimatu ja vana sessioon jääb kehtima. | Vii see `team-account` Edge Functioni sisse (Auth Admin API) koos värske teise faktoriga (`accountSecurity`). Lisa auditikirje `permission`/`password_set` ilma paroolita ja lõpeta töötaja sessioonid (`auth.sessions`). Võta RPC-lt `authenticated` õigus ära. Lisaks: veateated on SQL-is eesti keeles ja ekraan näitab neid toorelt (i18n reegel). | jah |
| D2 | madal | `chat_prune()` (sql/065), `purge_visit_requests()` (sql/059) | Mõlemad on volatile ja kustutavad andmeid **kõigis kliinikutes** samal projektil. `authenticated` saab neid käivitada (öine pg_cron jookseb `postgres`-ina). | Iga sisselogitud kasutaja saab säilitusaja kustutuse teha varem kui öösel. Kustub ainult see, mis niikuinii kustuks. | Võta mõlemalt `authenticated` õigus ära (rakendus neid ei kutsu). | jah |
| D3 | madal | `clinic_has_members(uuid)` (sql/083) | Vastab iga kliiniku uuid kohta, kas sel on liikmeid. | Teise kliiniku olemasolu kinnitamine, aga ainult siis, kui uuid on juba teada (seda pole võimalik ära arvata). | Jäta nii: funktsioon on `clinic_read` reeglis, ja reegel jookseb kutsuja õigustega, seega ei saa õigust ära võtta. Võib piirata ainult `created_by = auth.uid()` kliinikutega. | valikuline |

## 3. Storage

**Mis on korras:**
- Kaks bucketit: `job-files` (500 MB, kõik tüübid) ja `bug-reports` (10 MB,
  ainult pildid). Kumbki **pole avalik**.
- **`job-files`:**
  - lisamine käib ainult avatud „pesasse" (`upload_slot_open` /
    `preview_slot_open`, mille teeb `register_job_file`);
  - lugemine käib ainult kehtiva `file_download_grant` kaudu (kasutaja,
    rada, 2 minutit);
  - **UPDATE ja DELETE reegleid pole**, nii et olemasolevat faili üle
    kirjutada ei saa;
  - storage'il on samuti `mfa_required`.
- `bug-reports`-il pole SELECT reeglit: faile loeb ainult teenuse võti.
- **Failinimed** tehakse töö koodist (`TAL-26-0001_design_v1.stl`), mitte
  üleslaadija nimest, nii et partner patsiendi nime failinimest ei näe.
- **`file-link`:** kontrollib teist faktorit ja `request_file_download`-i
  (auditikirje + õigus), annab 60 sekundi lingi ja paneb faili alla laadima
  (`download: name`).

**Leiud:**

| # | Raskus | Kus | Mis | Kuidas ära kasutada | Parandus | Migratsioon |
|---|---|---|---|---|---|---|
| S1 | keskmine | `lib/fileLink.ts` varutee, `PatientExport.tsx:67`, `JobFiles.tsx:83` ja sql/072 grant-reegel | Kui `file-link` vastab muu veaga kui 403, teeb rakendus ise grant'i ja **allkirjastatud URL-i, mille kestuse valib klient**. 2-minutilise grant'i ajal saab sama sessioon teha ükskõik kui pika eluga lingi. | Inimene, kellel on (või oli) õigus faili näha, teeb aastase lingi, ja see jääb tööle ka pärast tema õiguste äravõtmist. Lisaks auditeeritakse ainult esimest küsimist. | F6 (ROADMAP 2.2.6): varutee eemaldada, alles jääb ainult `file-link`. Seejärel võtta `job_files_select` grant-reegel ära (pärast miinimumversiooni tõstmist). Patsiendi eksport ja eelvaated samuti Edge Functioni kaudu. | jah |
| S2 | madal | `job-files` bucket | MIME-piirangut pole. HTML/SVG fail serveeritakse `*.supabase.co` aadressilt. | Pahatahtlik HTML fail avaneb Storage'i domeenil, mitte rakenduse omal, seega sessioonile ligi ei pääse. Eelvaate lingid (`createSignedUrls`) ei sunni faili alla laadima. | Eelvaadetele lubada ainult `image/webp`/`png` (`set_job_file_preview`). Teistele failidele alati `download`. | ei |

## 4. Edge Functions

**Mis on korras:**
- **Teenusfunktsioonid** (`send-notifications`, `send-invoices`):
  `verify_jwt = false`, aga funktsioon ise nõuab **selle projekti teenuse
  võtit**, mida võrreldakse konstantse ajaga (`serviceAuth.ts`, testitud).
- **Kasutaja funktsioonid** (`account-security`, `team-account`, `wivo-update`,
  `file-link`) kutsuvad andmebaasi **kasutajana** (anon-võti + kasutaja token,
  `x-wivo-version` edasi) ja kontrollivad teist faktorit enne teenuse võtme
  kasutamist (`sessionHasMfa`).
- CORS `*` on neil Bearer-tokeni tõttu ohutu, sest brauser ei saada tokenit ise.
- **`public-booking`:**
  - CORS on lubatud aadresside nimekirjaga (`PUBLIC_BOOKING_ORIGINS`, `Vary: Origin`);
  - vastused on fikseeritud sõnastusega (`respond.ts`) ja sisemine viga lehele ei jõua;
  - makse kinnitus käib allkirjastatud Montonio tokeniga ja summa võetakse enda reast.
- Teavitused (push, e-post) **ei sisalda patsiendi nime ega töö koodi**
  (`pushText.ts`, `send-notifications`).

**Leiud:**

| # | Raskus | Kus | Mis | Kuidas ära kasutada | Parandus | Migratsioon |
|---|---|---|---|---|---|---|
| E1 | **kõrge** | `_shared/ratelimit.ts:13` `ipKey()` | IP võetakse **esimesest** `X-Forwarded-For` väärtusest. Seda kirjutab kutsuja ise, sest proksid lisavad oma väärtuse lõppu. Selle peal on nii minutipiirang (`take`) kui ka püsiv „6 taotlust tunnis IP kohta" (`recentRequestCount`, `ip_hash`). | Skript saadab iga päringuga uue välja mõeldud `X-Forwarded-For` päise. Piirang ei hakka kunagi tööle, ja kliiniku postkasti saab täita lõputu hulga võltstaotlustega (nimi + telefon). CORS ei takista, sest see on brauseri reegel. Kontrolli test-koopia peal ühe `curl`-iga, mis saadab oma päise. | Võta usaldusväärne IP: platvormi lisatud **viimane** hüpe või `cf-connecting-ip`. Lisa **kliiniku kohta tunnipiir** kõigist IP-dest kokku (nt 30/h), mis ei olene IP-st. Hiljem CAPTCHA (Turnstile), mis on Kevini otsus. | ei (tunnipiir loeb olemasolevat tabelit) |
| E2 | madal | `public-booking/index.ts:463`, `:393`; `_shared/montonio.ts:155` | `console.error(err)` kirjutab terve vea logisse. Andmebaasi viga võib sisaldada `Failing row contains (… nimi, telefon …)`, ja Montonio vastuse keha võib sisaldada kliendi andmeid. | Patsiendi nimi ja telefon satuvad Supabase'i funktsioonilogidesse, kus säilitus ja ligipääs on teised. | Logi ainult vea koodi ja lühikest põhjust (nagu `wivo-update` juba teeb). Ära logi keha. | ei |
| E3 | madal | `public-booking` `returnPage()`; seade `tagasiUrl` | `tagasiUrl` pannakse lingiks ainult jutumärke asendades. Skeemi ei kontrollita, nii et `javascript:` on võimalik. | Ainult kliiniku omanik saab seda seada. Patsient klikib lingil ja käivitub skript funktsioonide domeenil. Väike mõju. | Luba ainult `https:`, nii salvestamisel kui ka lehe tegemisel. | ei |
| E4 | madal | `file-link/index.ts:45` | 403 vastus tagastab andmebaasi `error.message`. | Teeb funktsioonide sisemuse kirjeldused nähtavaks. Andmeid ei leki. | Fikseeritud sõnum. | ei |

## 5. Telefoni veeb (Cloudflare Pages)

**Mis on korras:**
- `src/renderer/mobile-static/_headers`:
  - `X-Frame-Options: DENY`;
  - CSP `frame-ancestors 'none'; object-src 'none'; base-uri 'self'`;
  - `nosniff`;
  - `Referrer-Policy: no-referrer`;
  - `Permissions-Policy` (kaamera ainult endale).
- `dangerouslySetInnerHTML` kasutust ei ole. Kasutaja tekst renderdatakse
  Reactiga. `RichText` teeb lingiks ainult `http(s)` aadressi ja `target="_blank"`
  kasutab `rel="noreferrer"`.
- Sessioon kestab rakenduses 12 tundi ja „Sign out everywhere else" töötab.

**Leiud:**

| # | Raskus | Kus | Mis | Kuidas ära kasutada | Parandus | Migratsioon |
|---|---|---|---|---|---|---|
| W1 | keskmine | `mobile-static/_headers`, `mobile.html` | Puudub `script-src` ja `connect-src` (PH5). | Kui kuskil tekib XSS, saab skript sessiooni (supabase-js hoiab selle `localStorage`'is, koos refresh tokeniga) ära saata ükskõik kuhu. | `script-src 'self'` ja `connect-src` **iga kliiniku buildi oma Supabase aadressiga**: build kirjutab `_headers`'i (`build-clinic.mjs`). Kontrolli deploy'tud koopia peal brauseri konsoolis. | ei |
| W2 | madal | Supabase Auth | 12 tunni piir kehtib ainult rakenduses. Kopeeritud refresh token kehtib kauem. | Varastatud token jääb kehtima. | Supabase'i armatuurlaual „Time-box user sessions" (RUN-2 §6), Kevini samm. | ei |
| W3 | madal | Cloudflare | HSTS-i pole `_headers`'is. | Esimene `http://` päring on avatud allasurumisele (downgrade). | `Strict-Transport-Security: max-age=31536000` `_headers`'isse või Cloudflare'i SSL seadetesse. | ei |

## 6. Arvutirakendus (Electron)

**Mis on korras:**
- `contextIsolation` on sees (vaikimisi; preload kontrollib `process.contextIsolated`).
- `nodeIntegration` on väljas.
- **Uuendused:** `verifyDownloadedApp` kontrollib allkirjastatud release
  statement'it (YubiKey), sha512-te ja suurust, kanalit ja buildi. Vale fail
  lükatakse tagasi ja seda ei installita (`updater.ts:265-271`).
- **Litsents:** Ed25519 kontroll põhiprotsessis
  (`license.ts`). Testvõtit loetakse ainult siis, kui build pole pakitud.
- **IPC:**
  - jälgitava kausta lugemine on piiratud valitud kaustaga (`isInside`, testitud);
  - helifailid käivad ainult nimemustri järgi;
  - PDF tehakse peidetud aknas, kus JavaScript on väljas.

**Leiud:**

| # | Raskus | Kus | Mis | Kuidas ära kasutada | Parandus | Migratsioon |
|---|---|---|---|---|---|---|
| A1 | keskmine | `src/preload/index.ts:134` | `exposeInMainWorld('electron', electronAPI)` (`@electron-toolkit/preload`) annab rendererile **terve `process.env`-i**, **iga IPC kanali** (`invoke`/`send`/`sendSync`) ning `webFrame`/`webUtils`. Rakendus `window.electron`-i ei kasuta. | Iga XSS või võõras leht aknas saab kätte masina keskkonnamuutujad (arendaja masinas võivad seal olla tokenid) ja kutsub iga põhiprotsessi handlerit. | Eemalda `window.electron`. Jäta alles ainult `window.wivo`. | ei |
| A2 | keskmine | `src/main/index.ts:79-81` | `setWindowOpenHandler` annab **iga** aadressi `shell.openExternal`-ile, ka `file:`, `smb:` ja Windowsi protokollikäsitlejad. | XSS või kasutaja tekstis olev link (praegu filtreerib `RichText` need välja) avab kohaliku faili või protokolli. Windowsis on see tuntud tee koodi käivitamiseni. | Luba ainult `https:`, `mailto:`, `tel:`. | ei |
| A3 | keskmine | `src/main/index.ts` (`will-navigate` puudub) | Põhiakent ei kaitsta navigeerimise eest. | Link ilma `target`-ita viib põhiakna võõrale lehele, ja see leht saab preloadi (`window.wivo`, praegu ka `window.electron`). | `will-navigate`: luba ainult rakenduse enda aadress. | ei |
| A4 | keskmine | `src/renderer/index.html` | Arvutiaknal **CSP-d pole** (on ainult `updater.html`-il). | XSS-i korral pole ühtegi piiret. | `<meta http-equiv="Content-Security-Policy">`: `script-src 'self'`, `connect-src` litsentsi API aadressiga (`licensedApiOrigins`). Arvutis on kõik aadressid teada. | ei |
| A5 | madal | `JobReadView.tsx:221` | Prindiaken kirjutab `document.write`-iga `job.patsient` **toorelt** `<title>`-isse. | Patsiendi nimi `</title><script>…` käivitaks skripti rakenduse päritolus. Electronis lükkab `setWindowOpenHandler` tühja akna tagasi, nii et pakitud rakenduses see praegu ei jookse. **Aga see tähendab ka, et printimine arvutis tõenäoliselt ei toimi.** | Pealkiri teksti kaudu (`w.document.title = …`), ja printimine põhiprotsessi kaudu (nagu PDF). | ei |
| A6 | madal | `wivo:git-pull` | Arendaja abivahend, mis jookseb `git pull origin main` rakenduse kaustas. Pakitud rakenduses ei ole see kaust repo. | A1 kaudu saab seda kutsuda, aga pakitud rakenduses ei juhtu midagi. | Registreeri ainult siis, kui build pole pakitud (`!app.isPackaged`). | ei |

## 7. Saladused

**Mis on korras:**
- `config/test-copy.env` sisaldab ainult test-koopia URL-i ja anon-võtit. Seda
  kontrollib `config/testCopyEnv.test.ts`: teenuse võti, `sb_secret_`,
  privaatvõti või muu saladus annab vea.
- `.env`, `.env.test`, `clinics/*.env` ja `riga.env` on `.gitignore`-is. Kohalik
  `.env` sisaldab ainult `VITE_SUPABASE_URL` ja `VITE_SUPABASE_ANON_KEY`.
- Bundle'isse jõuavad ainult `VITE_*`/`MAIN_VITE_*`: URL, anon-võti, Sentry DSN,
  VAPID avalik võti ja kontakt. Kõik need on oma olemuselt avalikud.
- Repos olevad `.pem` failid on avalikud sertifikaadid ja testide fixture'id.
  Neis pole `PRIVATE KEY`.
- `sb_secret_N7UND0…` testis on Supabase CLI kohaliku keskkonna avalikult
  teada vaikimisi võti.

**Leiud:** puuduvad.

## 8. Logid ja auditilogi

**Mis on korras:**
- **Auditilogi** (sql/114):
  - sinna saab ainult lisada, ka SQL Editorist ei saa muuta ega kustutada;
  - töö on seal koodi järgi ja patsient id järgi, **mitte kunagi nime järgi**;
  - välja sisu salvestatakse ainult siis, kui `audit_field_rules` seda selgelt
    lubab;
  - eksport salvestab ainult ridade arvu ja filtrid (sql/106);
  - test annab vea, kui veerul pole reeglit.
- **Sentry** (`shared/privacy/scrub.ts`):
  - `sendDefaultPii: false`;
  - kasutaja, `extra` ja lokaalsed muutujad visatakse ära;
  - e-post, isikukood ja telefoninumber kustutatakse;
  - konsooli ja sisestuse breadcrumb'e ei saadeta.

**Leiud:**

| # | Raskus | Kus | Mis | Kuidas ära kasutada | Parandus | Migratsioon |
|---|---|---|---|---|---|---|
| L1 | madal | `shared/privacy/scrub.ts` | Nimed jäävad alles, kui need on andmebaasi veas: `Key (patsient)=(Mari …) already exists`, `Failing row contains (…)`. | Patsiendi nimi võib jõuda Sentry'sse vea teksti sees. | Lõika ära `Key (…)=(…)` ja `Failing row contains (…)` kujud, ning `details` väljad. | ei |
| L2 | madal | Edge Functions | Vt E2. | | | |

---

## Parandusplaan 2.2.5

Järjekord: kõigepealt see, mida saab ära kasutada ilma sisselogimiseta, siis
kaitse sügavuses, siis migratsioonid. Kõik peale märgitute on ilma Kevini
otsuseta.

| Samm | Leiud | Mis | Migratsioon |
|---|---|---|---|
| 1 | E1 | `ipKey` usaldusväärsest hüppest ja kliiniku tunnipiir kõigist IP-dest. Test kahe välja mõeldud `X-Forwarded-For`-iga. | ei |
| 2 | A1, A2, A3, A6 | Electron: `window.electron` ära, `openExternal` ainult `https`/`mailto`/`tel`, `will-navigate` valve, `git-pull` ainult pakkimata buildis. | ei |
| 3 | A4, A5 | Arvuti CSP `index.html`-i. Prindiakna pealkiri tekstina ja printimine põhiprotsessi kaudu (parandab ühtlasi printimise). | ei |
| 4 | D1 | Töötaja parool `team-account` kaudu: värske teine faktor, auditikirje, sessioonide lõpetamine. RPC õigus ära. | **jah (135)** |
| 5 | D2, R1 | `chat_prune`/`purge_visit_requests` õigus `authenticated`-ilt ära. Anon'ilt kõik tabeliõigused ära (SEC4), koos testiga. | **jah (135)** |
| 6 | E2, E4, L1 | Logidest ainult koodid. Sentry puhastab ka andmebaasi vea kujud. `file-link` fikseeritud sõnumiga. | ei |
| 7 | E3, S2 | `tagasiUrl` ainult `https:`. Eelvaated ainult pildina, failid alati allalaadimisena. | ei |
| 8 | W1 | Telefoni CSP: build kirjutab `_headers`'isse kliiniku `connect-src`. **Kevin** kontrollib deploy'tud koopia brauseris. | ei |
| 9 | W2, W3 | **Kevin:** Supabase'i „Time-box user sessions", HSTS (Cloudflare), Auth rate limits ja „leaked password protection" armatuurlaual. | ei |
| hiljem | S1 | F6 (2.2.6): ainult `file-link`. Esmalt miinimumversioon, siis grant-reegel ära. | jah |
| hiljem | E1 | CAPTCHA broneeringuvormile: **Kevini otsus** (teenus, privaatsus). | ei |

**Mida jätkata pärast seda:**
- välise konsultandi pentest (SEC1);
- 100 kutsutava definer-funktsiooni süsteemne test, kus iga funktsioon on
  kolme rolli all: teine kliinik, õiguseta töötaja ja partner. Praegu on see
  test ainult tabelite kohta (SEC3);
- `wivo-admin` repo eraldi ülevaade.
