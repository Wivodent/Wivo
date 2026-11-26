# Kliiniku seadistus: samm-sammult (näide: Dentiks Riias)

**Uue kliiniku oma projekt, telefon ja installer.** Nimed käivad kliiniku järgi,
mitte riigi või linna järgi. Selle juhendi näide on esimene kliinik Dentiks
(Riias), mis seadistati 23.11.2026. Selle päris väärtused on failis
`clinics/dentiks.json`. Uue kliiniku jaoks tee kõik samamoodi: kus siin on
`dentiks` või Dentiksi väärtus, pane uue kliiniku oma. Lõpuks lisa
`clinics/<id>.json` (clinics/README.md). Mõned nimed tehti enne seda reeglit
ja jäävad nii: Supabase'i projekt `wivo-riga`, Resendi võtmed `riga-…` ja
Cloudflare'i haru `riga`. Uuel kliinikul on need `wivo-<id>`, `<id>-…` ja `<id>`.

See on sinu käsiraamat, Kevin. **Üks käsk korraga**, Maci Terminalis, repo
kaustast (`~/dev/Wivo`), haru `testing`. Iga samm ütleb, mida pärast nägema
peaksid. Kui midagi läheb teisiti, **peatu seal** ja küsi; ära paranda
käsitsi edasi.

Taust: `RIGA-GO-LIVE.md` („Monday 23.11.2026") ja `docs/RIGA-TEMPORARY.md`
(installer ja Cloudflare). Sarnane juhend demole: `docs/DEMO-SETUP.md`.

> **Parandatud 25.11.2026 päris seadistuse (23.11) järgi:** projekti loomise
> lülitid (1), `psql -P pager=off` (2.3), Vaulti ja funktsioonide võti on
> `sb_secret` (3, 8.4), Resendi kirjed ja võtmete järjekord (6), mallide
> teemarida (7.3), telefoni aadress on `wivo-dentiks.pages.dev` (5, 8.4, 10).
> **Hiljem:** Dentiksi telefon on kliiniku oma domeenil `https://wivo.dentiks.lv`
> (Cloudflare'i kohandatud domeen). Allpool on see aadress kõikjal, kuhu
> inimesed jõuavad: 5, 8.4 ja 10 (`docs/CLINIC-ROLLOUT.md` 1.5).
> Juhend kirjutati Maci jaoks. Windowsi käsud on `docs/CLINIC-ROLLOUT.md`-s.
> Järgmised installerid: `docs/RELEASE.md` ja `docs/CLINIC-ROLLOUT.md`.

> **Parool ega võti ei lähe kunagi käsureale.** zsh-i ajalugu
> (`~/.zsh_history`) on fail kettal. Iga samm allpool küsib parooli varjatult
> või paned võtme otse dashboardi.

> **Claude ei ühendu Riia projektiga kunagi** (CLAUDE.md). Kõik allpool teed
> sina, oma masinas ja dashboardis.

---

## 0. Enne alustamist

**0.1. Migratsioon 125 testkoopias.** Kõik proovitakse enne testkoopias
(CLAUDE.md). Testkoopia SQL Editoris, järjekorras:

1. kogu `sql/125_mail_quota.sql` sisu, Run;
2. eraldi päring: `notify pgrst, 'reload schema';`
3. `sql/checks/schema_check.sql` ja `sql/checks/trigger_check.sql` → null rida.

Uut baseline'i Riiale ei tee enne, kui need on testkoopias läbi.

**0.2. Tööriistad.** Kontrolli, et need on olemas; puuduva paigalda
(Homebrew):

| Mis | Kontroll | Puudub? |
|---|---|---|
| git, Node 22 | `node --version` | `brew install node@22` |
| psql | `/opt/homebrew/opt/libpq/bin/psql --version` | `brew install libpq` |
| Supabase CLI | `supabase --version` | `brew install supabase/tap/supabase` |
| ykman (YubiKey) | `ykman --version` | `brew install ykman` |

psql jääb täispika teega, PATH-i teda ei panda.

**0.3. Kood.** Puhas `testing`, sama mis GitHubis:

```sh
git switch testing
```

```sh
git pull
```

```sh
git status --short
```

Viimane ei trüki midagi.

**0.4. Paroolihaldurisse tuleb kirja** (iga samm ütleb, millal): Riia
andmebaasi parool, Riia ref, anon/publishable key, kaks Resendi võtit,
VAPID-i paar, omaniku parool.

---

## 1. Supabase'i projekt (Stockholm, Pro)

Dashboard (supabase.com) → **Riia organisatsioon** → **New project**:

| Väli | Väärtus |
|---|---|
| Organization | Riia oma (mitte sinu isiklik) |
| Name | `wivo-riga` |
| Region | **North EU (Stockholm)** `eu-north-1` |
| Database password | **Generate**, kohe paroolihaldurisse |
| Plan / Compute | Pro, vaikimisi suurus |
| **Grant API access automatically** (Data API) | **sees** |
| **Enable RLS automatically** (automaatne RLS uutele tabelitele) | **väljas** |

Need kaks lülitit on uue projekti vormis (Security / Advanced). Nii töötas
Riia päris seadistus (23.11): migratsioonid panevad iga tabeli RLS-i ja
reeglid ise (sql/098, `ensure_mfa_policies`), automaatne RLS segaks
baseline'i.

Projekt on valmis ~2 minutiga. Pane kirja:

- **Project ref** (URL-is: `supabase.com/dashboard/project/<REF>`);
- **Project URL**: `https://<REF>.supabase.co`;
- **anon / publishable key**: Project Settings → API Keys.

**Kaks võtit, mõlemad Project Settings → API Keys:**

- **Legacy `service_role`** (Legacy API keys, algab `eyJ`): ainult
  baseline'i jaoks (samm 2), sest sql/052 ja sql/056 keelduvad võtmest, mis
  ei alga `eyJ`-ga. **Kui seda vahekaarti ei ole, peatu ja anna teada.**
- **Secret key** (`sb_secret_…`, Secret keys): see läheb pärast baseline'i
  Vaulti ja funktsioonide saladusse (samm 3 ja 8.4). **Uues projektis vastab
  värav legacy JWT-ga tehtud taimerikutsele 401** (nii juhtus 23.11), seega
  taimer kasutab `sb_secret` võtit.

**Spend cap** (Organization → Billing): jäta sisse. Pro sisaldab 100 GB
Storage'it; üle selle ütleb Supabase ette, mitte arvel.

---

## 2. Baseline psql-iga

Kõik migratsioonid sql/000 … sql/125 ühe failina. Skript lisab Vaulti
**Riia** teenusevõtme ja võtab maha arvete croni, mis on sql/052-s tootmise
aadressiga (Riia arveid ei saada).

**2.1. Tee fail** kodukausta, ainult sinule loetav. Skript küsib **legacy**
`service_role` võtit (`eyJ…`) varjatult (keeldub tootmise võtmest); samm 3
vahetab selle Vaultis `sb_secret` võtme vastu:

```sh
umask 077; node scripts/fresh-schema.mjs > ~/riga-baseline.sql
```

Oota: `~/riga-baseline.sql` on ~700 KB (`ls -lh ~/riga-baseline.sql`).

**2.2. Ühendusstring.** Dashboard → **Connect** → **Session pooler** (port
5432). Kopeeri string ja **kustuta sealt `:[YOUR-PASSWORD]`**, nii et jääb:

```
postgresql://postgres.<REF>@aws-0-eu-north-1.pooler.supabase.com:5432/postgres
```

(Host on see, mida Connect näitab; `aws-0` võib olla `aws-1`.) Mitte
Transaction pooler (6543), mitte otseühendus (ainult IPv6).

**2.3. Jooksuta.** `-W` küsib andmebaasi parooli varjatult,
`ON_ERROR_STOP=1` peatab esimese vea peal, **`-P pager=off`** hoiab
väljundi lehitsejast eemal: ilma selleta jääb psql pika väljundi juures
lehitseja taha ootama ja baseline jääb poolikuks (23.11):

```sh
/opt/homebrew/opt/libpq/bin/psql "postgresql://postgres.<REF>@aws-0-eu-north-1.pooler.supabase.com:5432/postgres" -W -P pager=off -v ON_ERROR_STOP=1 -f ~/riga-baseline.sql
```

Lõpus `NOTIFY` ja mitte ühtegi `ERROR`-it. `NOTICE`-id (`skipping`,
`already exists`) on normaalsed. **Kui tuleb `ERROR`:** kopeeri viimased 30
rida ja faili nimi, mille juures see juhtus (`-- ═══ 0xx_…` rida üleval), ja
peatu. Ära jooksuta faili uuesti ega paranda midagi käsitsi.

**2.4. Kustuta fail** (sees on teenusevõti):

```sh
rm ~/riga-baseline.sql
```

**2.5. Kontrolli skeemi.** Dashboard → SQL Editor, kleebi
`sql/checks/schema_check.sql`, Run → **null rida**. Siis sama
`sql/checks/trigger_check.sql`-iga → **null rida**.

---

## 3. Vault: funktsioonide aadress (teavituste cron)

sql/077 kutsub iga minut `send-notifications`-it, kui Vaultis on selle
projekti funktsioonide aadress. SQL Editoris:

```sql
select vault.create_secret('https://<REF>.functions.supabase.co', 'wivo_functions_url');
```

**Võti `sb_secret` peale.** Baseline pani Vaulti legacy `service_role` JWT-i,
millega uue projekti värav vastab taimerile 401. Vaheta see secret key
vastu (Project Settings → API Keys → Secret keys, `sb_secret_…`). SQL
Editoris, oma võtmega:

```sql
select vault.update_secret((select id from vault.secrets where name = 'wivo_service_role_key'), '<sb_secret_… võti>');
```

Sama võti läheb sammus 8.4 funktsioonide saladusse `WIVO_SERVICE_SECRET_KEY`
(`_shared/serviceAuth.ts` võrdleb neid). **Ära salvesta seda päringut**
(SQL Editori snippet): kui Editor selle ise salvestas, kustuta see.

Kontroll (kaks rida: `wivo_functions_url`, `wivo_service_role_key`):

```sql
select name from vault.secrets order by name;
```

Kontroll, et võti on `sb_secret` (näitab ainult algust):

```sql
select left(decrypted_secret, 10) from vault.decrypted_secrets where name = 'wivo_service_role_key';
```

→ `sb_secret_`.

Cron kutsub funktsiooni, mis tuleb alles sammus 8. Seni vastab ta 404-ga; see
on normaalne.

---

## 4. Kopa piir (suured failid)

KT-seeria ZIP-ina on 150–600 MB, STL-i täiskaar 20–80 MB. Kaks seadet, selles
järjekorras (kopa piir ei saa olla suurem kui üldine):

1. **Project Settings → Storage → Upload file size limit:** `1 GB`.
2. **Storage → `job-files` → Edit bucket → Restrict file upload size:**
   `1 GB`. Ära muuda „Public bucket" lülitit (peab olema väljas).

---

## 5. Authi põhiseaded

Dashboard → **Authentication**:

1. **URL Configuration**
   - Site URL: `https://wivo.dentiks.lv`
   - Redirect URLs: lisa `https://wivo.dentiks.lv/auth/confirm`

   Mõlemad on kliiniku telefoni aadress (`phoneUrl`; Cloudflare `wivo-dentiks`,
   selle kohandatud domeen, samm 10):
   kutse ja parooli link tulevad sinna tagasi.
2. **Sign In / Providers → Email**
   - Confirm email: sees. Secure email change: sees.
   - Email OTP Expiration: `86400` (24 h: kutse ja parooli link).
   - Minimum password length: `10`.
3. **Sign In / Providers → „Allow new users to sign up": VÄLJA.** Kontod
   teeb omanik Wivos (team-account), see töötab ka nii
   (docs/ACCOUNTS.md §5).
4. **Multi-Factor → TOTP:** sees (vaikimisi). Ilma teise tegurita ei näe
   keegi midagi (sql/098).

---

## 6. Resend: domeen `wivo.dentiks.lv` ja DNS Iljale

**6.1. Domeen.** resend.com, **Riia konto** → **Domains → Add Domain** →
`wivo.dentiks.lv`, region **EU (Ireland)** `eu-west-1`.

**6.2. Kirjed Iljale.** Resend näitab kirjeid; **kopeeri nimed ja väärtused
Resendist täpselt**, need on selle konto omad. 23.11 seisuga on need
**kaks CNAME-kirjet ja DKIM-i TXT** (nimed `dentiks.lv` tsooni sees):

| Tüüp | Nimi | Väärtus |
|---|---|---|
| CNAME | `rsend.wivo` | Resendist |
| CNAME | `send.wivo` | Resendist |
| TXT | `resend._domainkey.wivo` | DKIM, Resendist (`p=MIGf…`) |
| TXT | `_dmarc.wivo` | `v=DMARC1; p=none;` (soovituslik) |

Kui Resend näitab teistsuguseid nimesid, kehtib Resend: tabel on 23.11 seis.
(Varem olid siin MX ja SPF TXT `send.wivo` all; Resend ei näita neid enam.)

Iljale lisaks:
- `dentiks.lv` enda MX, SPF ja muud kirjed **jäävad puutumata**; alamdomeen
  ei vaja neist ühtegi.
- Kui teenusepakkuja tahab täisnime: `resend._domainkey.wivo.dentiks.lv`
  jne.
- `wivo.dentiks.lv`-ile endale A/CNAME kirjet ei ole vaja.

**6.3. Kinnita.** Kui Ilja ütleb, et kirjed on sees: Resend → **Verify DNS
Records**, oota, kuni kõik on **Verified** (minutid kuni paar tundi).
Kontroll (trükib Resendi väärtuse): Macis `dig +short CNAME send.wivo.dentiks.lv`,
Windowsi PowerShellis:

```powershell
Resolve-DnsName -Type CNAME send.wivo.dentiks.lv
```

**6.4. Kaks võtit, alles pärast kinnitust.** Tee võtmed **alles siis, kui
domeen on Resendis _Verified_**. Enne kinnitust tehtud võtmega annab saatmine
vea „not authorized to send emails from …" (23.11); siis kustuta võti ja tee
uus. Resend → **API Keys → Create API Key**, mõlemad **Sending access**,
domeen ainult `wivo.dentiks.lv`:

- `riga-auth-smtp`: Supabase Authi SMTP (samm 7);
- `riga-functions`: Edge Functions (samm 8).

Iga võti näidatakse üks kord: kleebi kohe sinna, kus teda kasutatakse (ja
paroolihaldurisse).

**Päevapiir:** tasuta plaan on 100 kirja päevas (3000 kuus), Authi kirjad
kaasa arvatud. Kui piir täitub: funktsiooni logis hoiatus, logirida tabelis
`mail_quota_hit` ning omanikule kella- ja telefoniteavitus „Tänane e-kirjade
piir on täis" (sql/125). Teavituste e-kirjad proovitakse uuesti iga minut
ööpäeva jooksul; kutse ja parooli link tuleb järgmisel päeval uuesti saata.

---

## 7. Supabase Authi SMTP Resendi kaudu

**7.1.** Authentication → **Emails → SMTP Settings → Enable Custom SMTP**:

| Väli | Väärtus |
|---|---|
| Sender email | `no-reply@wivo.dentiks.lv` |
| Sender name | `Wivo` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | `riga-auth-smtp` võti |

Save.

**7.2.** Authentication → **Rate Limits**: e-mails per hour `30`.

**7.3.** Authentication → **Emails → Templates**. Kleebi teema ja sisu
failidest. Teema on faili alguse kommentaaris real `Subject:`: kopeeri ainult
tekst pärast `Subject: `. **Teema lõppu ei tohi jääda `-->`** (see on
kommentaari lõpp, mitte teema osa; 23.11 jäi see kirja pealkirja). Sisu
kleebi ilma selle kommentaarita:

- `docs/auth-email-templates/reset-password.html` → **Reset password**
- `docs/auth-email-templates/invite.html` → **Invite user**
- `docs/auth-email-templates/change-email.html` → **Change email address**

**7.4. Proovi.** Authentication → Users → **Invite user** oma aadressiga. Kiri
tuleb `no-reply@wivo.dentiks.lv`-ilt; Resend → **Emails** näitab
*Delivered*. Siis kustuta see kasutaja (Users → … → Delete user).

---

## 8. Edge Functions

**8.1. Logi CLI sisse** (avab brauseri; token läheb macOS-i võtmehoidjasse,
mitte faili):

```sh
supabase login
```

**8.2. Neli funktsiooni.** Iga käsk eraldi. **Ära kunagi jooksuta
`supabase link`-i** (CLAUDE.md); iga käsk saab `--project-ref`-i.

```sh
supabase functions deploy send-notifications --project-ref <REF> --no-verify-jwt --use-api
```

```sh
supabase functions deploy team-account --project-ref <REF> --no-verify-jwt --use-api
```

```sh
supabase functions deploy account-security --project-ref <REF> --no-verify-jwt --use-api
```

```sh
supabase functions deploy file-link --project-ref <REF> --use-api
```

Igaüks lõpeb `Deployed Functions on project <REF>`. (`file-link` jääb
gateway JWT-kontrolliga, nagu testkoopias.) `send-invoices`, `public-booking`
ja `wivo-update` Riiale ei lähe: arveid ja veebibroneeringut Riia ei kasuta,
uuendused tulevad installeriga.

Kui CLI ütleb, et `--use-api` on tundmatu: `brew upgrade supabase` ja uuesti.

**Kui kliinik kasutab veebibroneeringut (`public-booking`, alates 2.2.5):**
ilma Turnstile'i saladuseta ei võta funktsioon ühtegi taotlust vastu
(„Online booking is not set up yet"). Cloudflare'is: Turnstile → Add site
→ kliiniku kodulehe domeen. Siis:

```sh
supabase secrets set --project-ref <REF> \
  TURNSTILE_SECRET_KEY=<salavõti> TURNSTILE_SITE_KEY=<saidivõti> \
  PUBLIC_BOOKING_ORIGINS=https://<kliiniku-koduleht> IP_HASH_PEPPER=<juhuslik pikk tekst>
supabase functions deploy public-booking --project-ref <REF> --use-api
```

Kodulehe vidin peab Turnstile'i näitama (`/services` annab `turnstileSiteKey`)
ja saatma selle tokeni taotluses väljana `turnstileToken`.

**8.3. VAPID-i paar** telefoni pushi jaoks:

```sh
node scripts/vapid-keys.mjs
```

Trükib kaks rida. Mõlemad paroolihaldurisse. `VAPID_PUBLIC_KEY` läheb ka
Cloudflare'i (samm 10), `VAPID_PRIVATE_KEY` **ainult** funktsiooni saladusse.

**8.4. Saladused.** Dashboard → **Edge Functions → Secrets → Add new
secret**, ükshaaval:

| Nimi | Väärtus |
|---|---|
| `WIVO_SERVICE_SECRET_KEY` | sama `sb_secret_…` võti, mis sammus 3 Vaulti läks |
| `RESEND_API_KEY` | `riga-functions` võti |
| `NOTIFY_FROM` | `Wivo <no-reply@wivo.dentiks.lv>` |
| `APP_LINK` | `https://wivo.dentiks.lv/job/{id}` |
| `VAPID_PUBLIC_KEY` | 8.3 esimene rida (ilma `VAPID_PUBLIC_KEY=`-ita) |
| `VAPID_PRIVATE_KEY` | 8.3 teine rida |
| `VAPID_SUBJECT` | `mailto:` + sinu aadress |
| `BUG_REPORT_TO` | sinu aadress (vearaportid) |

**`EMAIL_ALLOW_ONLY` Riiale EI pane** (see on ainult testkoopia oma).

**8.5. Kontrolli croni.** Oota 2 minutit. SQL Editoris:

```sql
select status_code, left(content::text, 120) as answer, created
  from net._http_response order by created desc limit 3;
```

`200` ja vastus `{"ok":true,…}`. `401` = Vaulti võti ja
`WIVO_SERVICE_SECRET_KEY` ei ole sama `sb_secret` võti (või Vaultis on veel
legacy JWT, samm 3), `404` = funktsioon pole üleval.

---

## 9. Installer ja telefoni haru (Dentiksil `riga`)

**9.1. Kliiniku fail `clinics/<id>.json`** (git jälgib seda, sees on ainult
avalikud väärtused; clinics/README.md). Dentiksi fail:

```json
{
  "id": "dentiks",
  "name": "Dentiks",
  "releasesRepo": "Wivodent/wivo-dentiks-releases",
  "phoneUrl": "https://wivo.dentiks.lv",
  "supabaseRef": "fwsrnsdrlrlmjfkkkhvp",
  "cloudflareProject": "wivo-dentiks",
  "phoneBranch": "riga"
}
```

**9.2. Avalik võti `clinics/<id>.env`.** Git seda faili ei jälgi. Sees on üks rida:

```
VITE_SUPABASE_ANON_KEY=<anon / publishable key>
```

**9.3. Paketid:**

```sh
npm ci
```

**9.4. Ehita** (allkirjastatud release'i jaoks hoopis `docs/CLINIC-ROLLOUT.md`):

```sh
npm run dist:clinic -- --clinic dentiks
```

See võtab ~5 minutit. Lõpus näed installeri teed (`dist-dentiks/`), commiti,
kliiniku refi, **SHA-256**-e ja käsku telefoni haru liigutamiseks. Kirjuta SHA-256 üles. Kui ta keeldub („Refused: …"),
loe rida: iga rida ütleb, mida teha.

> **Macis ei ole Windowsi installerit veel lõpuni proovitud.** Kui
> electron-builder ütleb midagi `wine`-i kohta, ehita Windowsi masinas
> (`docs/CLINIC-ROLLOUT.md`, samad käsud PowerShellis) ja jätka siit.

**9.5. Telefon samast versioonist.** Cloudflare'i `wivo-dentiks` ehitab haru
`riga` (`phoneBranch`). Kopeeri käsk, mille `dist:clinic` lõpus trükkis (sama commit mis
installeril):

```sh
git push origin <installeri täispikk commit>:refs/heads/riga
```

Esimene kord teeb haru. Edaspidi **iga uue installeriga** sama käsk uue
commitiga. Ta pole kunagi `--force`: git keeldub, kui commit ei ole `riga`
praegusest eespool, nii et `riga` järgib alati `testing`-ut. Kui `dist:clinic`
ütles „First push testing", pushi enne `testing`.

---

## 10. Cloudflare `wivo-dentiks`

Nagu `docs/RIGA-TEMPORARY.md` osa B, päris seadistuse (23.11) järgi:

- **Pages, mitte Workers:** Workers & Pages → Create → **Pages** → Connect to
  Git. (Workersi vorm näeb sarnane välja, aga ehitab teist asja.)
- **Project name: `wivo-dentiks`** → aadress `https://wivo-dentiks.pages.dev`.
- **Custom domains → `wivo.dentiks.lv`** (kliiniku oma domeen; seda kasutavad
  inimesed ja see on `phoneUrl`). Cloudflare ütleb, millise CNAME-i Ilja
  DNS-i paneb; oota, kuni olek on **Active**.
- **Production branch: `riga`** (mitte `testing`).
- **Preview branches: None** (Settings → Builds → Branch control).
- **Environment variables: Production'i all** (mitte Preview), neli:
  - `VITE_SUPABASE_URL` = Riia Project URL
  - `VITE_SUPABASE_ANON_KEY` = Riia anon / publishable key
  - `VITE_VAPID_PUBLIC_KEY` = 8.3 avalik võti (ilma selleta ei saa telefon
    pushi sisse lülitada)
  - `VITE_PHONE_URL` = `https://wivo.dentiks.lv` („What's new" näitab
    seda, mitte app.wivodent.com-i; alates 2.0.5)

Build command `npm run mobile:build`, output `dist-mobile`, `NODE_VERSION`
`22`. Kontroll: ava `https://wivo.dentiks.lv`, Network-vaates lähevad
päringud ainult `<REF>.supabase.co`-sse.

---

## 11. Omanik ja kliinik

**11.1. Omaniku konto.** Supabase → Authentication → Users → **Add user →
Create new user**: Riia omaniku e-post, ajutine parool (≥ 10 märki,
paroolihaldurisse), **Auto Confirm User: sees**. Kirja ei saadeta.

**11.2. Esimene sisselogimine Windowsis** (omaniku arvuti või sinu Windows):
paigalda installer (kontrolli enne `Get-FileHash .\Wivo-Riga-Setup-<versioon>.exe`
= SHA-256), ava Wivo, logi omanikuna sisse. Wivo nõuab kohe **teist tegurit**:
omanik skannib QR-i oma telefoni autentimisrakendusega. Siis **„Set up your
clinic"**: nimi, aadress, registrikood, „Create clinic and start".

Litsentsita on menüü peaaegu tühi; see on õige, litsents tuleb järgmisena.

**11.3. Kliiniku ID.** Supabase SQL Editoris:

```sql
select id, name from public.clinics;
```

Üks rida. `id` on litsentsi `--org`.

---

## 12. Litsents YubiKey C-ga

YubiKey C Maci külge. Üks käsk (PIN ja puudutus):

```sh
node scripts/make-license.mjs sign --org <kliiniku id> --api https://<REF>.supabase.co --name "<kliiniku nimi>" --modules jobs,payroll,stock --seats 10 --months 12
```

Enne trükkimist trükib ta nime, `10 kasutajat`, aadressi ja moodulid, ning
kontrollib allkirja C avaliku võtmega. Siis tuleb `WIVO1.…` token. Kontrolli
veel kord eraldi:

```sh
node scripts/make-license.mjs verify <token> --public 2238a030d6895e917a01e56228a2dc65e2e5a3e9b4a12fc16b66784edf48f5ca
```

`OK · v2 · <nimi> · kuni <kuupäev>`. (See on YubiKey C avalik võti,
`src/main/license.ts`.)

Omaniku Wivos: **Settings → Licence**, kleebi token, Install. Licence-leht
näitab Riia aadressi ja kolme moodulit. Punane bänner = vale aadress: peatu.

(`--seats` on tokenis, aga Wivo ei jõusta seda veel; 10 on kokkulepe.)

---

## 13. Kümme kontot ja rollid

Omaniku Wivos: **Team → Add staff member**. Kaks viisi:

- **E-postiga:** kutse läheb Resendi kaudu (läheb 100 päevapiiri sisse; 10
  kutset on probleemita). Inimene määrab lingist parooli.
- **Kasutajanimega** (`nimi@KOOD`), ilma e-postita: omanik annab parooli
  ise üle. Parooli taastamine käib siis omaniku kaudu.

Iga konto juures **Apply role** (eelseade), siis vajadusel õigused käsitsi.
Eelseaded: tehnik, arst, raamatupidaja, sekretär, juhataja, IT.
**Juhataja, raamatupidaja ja IT ei näe patsiendi nime** (neil pole
`jobs.read`-i ega `patients.read`-i); ära lisa neid käsitsi.

Täida Riiaga (omanik on 1. rida):

| # | Nimi | E-post või kasutajanimi | Eelseade | Etapid |
|---|---|---|---|---|
| 1 | | | omanik | |
| 2 | | | arst | Skaneering; kabinetis Disain, Freesimine |
| 3 | | | arst | |
| 4 | | | tehnik (digi) | Disain, Printimine/Freesimine |
| 5 | | | tehnik (käsitsi) | Viimistlus |
| 6 | | | tehnik | |
| 7 | | | IT | Vastuvõtt |
| 8 | | | juhataja | |
| 9 | | | raamatupidaja | |
| 10 | | | sekretär | |

Iga inimene lisab esimesel sisselogimisel teise teguri (sql/098). Ilma selleta
näeb ta tühja ekraani: ütle seda neile ette.

---

## 14. Riia etapid ja kaks malli

Omaniku Wivos: **Settings → Job stages**.

**14.1. Etapikogu** (lehe alumine osa, „Workflow"). Pane täpselt need, selles
järjekorras; vaikimisi etapid, mida pole, eemalda. Riia kasutab ingliskeelset
Wivot, seega nimed inglise keeles (või nii, nagu Riia tahab; nimi on vaba
tekst):

| # | Nimi (EN) | ET |
|---|---|---|
| 1 | Scanning | Skaneering |
| 2 | Intake | Vastuvõtt |
| 3 | Photogrammetry | Fotogramm-meetria |
| 4 | Design | Disain |
| 5 | Printing / Milling | Printimine/Freesimine |
| 6 | Finishing | Viimistlus |
| 7 | Done | Valmis |

Viimane etapp on alati „valmis". Vaikemall (`default`) järgib seda nimekirja
ise: kõik etapid järjest.

**14.2. Mall „Crown, lab"** (Kroon labor). **Workflow templates → New
template**:

| Etapp | Lüliti / reegel | Vastutaja | Palk |
|---|---|---|---|
| Scanning | — | ☑ „The doctor who orders the job does it" | No pay |
| Intake | — | IT (rida 7) | No pay |
| Photogrammetry | **Only when: digital scan + more than one implant** | ☑ tellija arst | No pay |
| Design | — | digitehnik (rida 4) | **Design** |
| Printing / Milling | — | digitehnik (rida 4) | No pay |
| Finishing | — | käsitsi tehnik (rida 5) | **Piecework** |
| Done | — | — | No pay |

Save template. Kui vorm ütleb vea (punane rida), loe see; nt üks palgaliik
saab olla ainult ühel etapil.

**14.3. Mall „Crown, in clinic"** (Kroon kabinetis): arst skannib, disainib
ja freesib, tehnik viimistleb.

| Etapp | Vastutaja | Palk |
|---|---|---|
| Scanning | ☑ tellija arst | No pay |
| Design | ☑ tellija arst | No pay |
| Printing / Milling | ☑ tellija arst | No pay |
| Finishing | käsitsi tehnik (rida 5) | **Piecework** |
| Done | — | No pay |

Intake ja Photogrammetry seda malli ei kasuta.

**Palgaliigid on minu ettepanek** (Design disainijale, Piecework
viimistlejale; arst kabinetis palka ei saa). **Kinnita Riiaga enne
esimest palgakuud**; malli muutmine hiljem ei muuda juba tehtud tööde palka.

**14.4. Tagavara** („Who a stage falls back to"): Printing / Milling →
digitehnik, Finishing → käsitsi tehnik. Kasutatakse, kui mall kedagi ei
nimeta (nt vaikemall).

---

## 15. Kontrollnimekiri: enne, kui Riia kasutama hakkab

Kõik peab olema ☑. Iga rida on üks proov päris projektis.

**Andmebaas ja ühendus**
- [ ] `schema_check.sql` ja `trigger_check.sql` → null rida (2.5)
- [ ] `net._http_response`: `send-notifications` vastab `200` (8.5)
- [ ] Installeri SHA-256 klapib; Settings → Licence näitab Riia aadressi ja
      Jobs, Payroll, Stock; punast bännerit ei ole
- [ ] Telefonis `wivo.dentiks.lv`: päringud ainult `<REF>.supabase.co`-sse
- [ ] `riga` haru commit = installeri commit (Cloudflare → Deployments
      näitab sama lühikest commiti)

**Kontod**
- [ ] Kõik 10 kontot logivad sisse, igaühel teine tegur
- [ ] Raamatupidaja ja juhataja: tööde ja palga vaates **ühtegi patsiendi
      nime** ei ole
- [ ] Sign-up on väljas (5.3)

**E-post**
- [ ] Kutse jõuab kohale `no-reply@wivo.dentiks.lv`-ilt (Resend → Emails:
      *Delivered*)
- [ ] „Forgot password?" töölaual → kiri tuleb, link avab
      `wivo.dentiks.lv/auth/confirm` ja uus parool töötab
- [ ] Teavituse e-kiri: tehnikul on „E-mail me the same notifications"
      sees, töö liigub tema etapile → kiri tuleb minuti jooksul

**Töövoog**
- [ ] Uus töö mallist „Crown, lab", digitaalne, **kaks implantaati** →
      Photogrammetry on etappide hulgas; ühe implantaadiga → ei ole
- [ ] Uus töö mallist „Crown, in clinic" arsti kontolt → Scanning, Design,
      Printing / Milling on arsti peal
- [ ] Tehnik näeb „I started" ja „Next stage" ainult oma etapil; liigutab
      töö edasi, järgmise etapi inimene saab kellateavituse
- [ ] KT-fail (ZIP, ~300 MB) laeb üles ja alla (kopa piir, samm 4)
- [ ] Palgaleht: proovitöö Design ja Finishing read on õigetel inimestel
- [ ] Proovitööd kustutatud enne starti

**Telefon ja omanik**
- [ ] Omaniku telefonis Wivo avakuvale lisatud, Settings → **Notifications on
      this phone** sees. Proov: proovitöö Design-etapile pannakse omanik,
      tehnik liigutab töö Design-ile → omaniku telefon saab pushi. (Sama tee
      kaudu jõuab omanikuni päevapiiri teade.)
- [ ] Omanik teab: „Tänane e-kirjade piir on täis" kellas tähendab, et
      kutsed ja parooli lingid tuleb järgmisel päeval uuesti saata

**Pärast starti, mitte enne** (RIGA-GO-LIVE.md): täielik turvaülevaatus
7.12-ni, osa B (litsents kannab ühendust), vene keel.
