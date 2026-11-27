# Öine töö 2026-11-27

Haru: `testing`. Midagi ei pushitud, haru ei vahetatud, ühegi andmebaasiga ei
ühendutud (ainult PGlite testides), release/sign/publish ega functions deploy
ei käivitatud. Versiooni ei tõstetud (package.json on endiselt 2.2.5). Iga osa
on eraldi commit. Ühtegi osa ei tulnud revertida.

**Commit'id järjekorras:** `8d9cc55` (1), `781074a` (2), `1a87ad4` (3),
`d1ed403`, `917b559`, `10c3e5e` (4), `f437c28` (raport), `7eef159`,
`f2c3e05` (5), `35cf1d9` (testi parandus).

**Lõpus (pärast viimast commit'i `35cf1d9`):** täis testid rohelised
(239 faili, 3073 testi), `tsc` (web + node) puhas, `npm run build` (desktop)
ja `npm run mobile:build` (telefon) õnnestusid.

**Ausalt:** kaks testi loevad ainult gitis olevaid faile (`git grep`), nii et
need kukkusid alles pärast commit'i `917b559`: telefoni Network-režiimis oli
üks kõvasti kirjutatud "LV" ja `appVersion` test pidas Networki
`network-token` funktsiooni kliiniku funktsiooniks. Mõlemad parandatud
(`7eef159`, `35cf1d9`). Vahepealsetes commit'ides on seega üks-kaks punast
testi; lõppseis on roheline.

---

## Osade staatus

| Osa | Staatus | Commit(id) |
|---|---|---|
| 1 Võltsandmetega testprojekt | **valmis** | `8d9cc55` |
| 2 "Uus tegevus" märk töökaardil | **valmis** | `781074a` |
| 3 Failid ainult file-link kaudu (F6) | **valmis** (migratsioon ootab miinimumversiooni) | `1a87ad4` |
| 4A Network keskne projekt | **valmis** (failid `network/`) | `d1ed403` |
| 4B Kliiniku pool | **valmis** | `d1ed403`, `917b559` |
| 4C Tellimused (vorming, kliendi ja kliiniku ekraanid) | **valmis** | `d1ed403`, `917b559` |
| 4D Networki kasutaja pool | **valmis** telefonirakenduse Network-režiimina | `917b559` |
| 4E Testid | **valmis** | samad |
| 4F docs/NETWORK-SETUP.md | **valmis** | `10c3e5e` |
| 4 Ladu ja arved kliendile | **ei tehtud** (plaanis järgmiseks, N13) | — |
| 5 Vene keel | **valmis** valitud ekraanidele (1124 võtit + 159 uut) | `7eef159`, `f2c3e05` |
| 5 Läti keel | **plaan** (allpool) | see raport |

## Migratsioonid järjekorras

| # | Fail | Mis | Millal Dentiksis |
|---|---|---|---|
| 136 | `sql/136_job_seen.sql` | `job_seen` (ainult enda read, realtime), `mark_job_seen`, `job_activity`, `clinics.activity_seen_from`, `add_job_note` kirjutab ka `by` | kohe, koos uue versiooniga (vanad versioonid ei häiri) |
| 137 | `sql/137_files_only_through_file_link.sql` | võtab ära storage'i lugemisreegli `job_files_select` | **alles pärast**, kui kõik masinad on uuel versioonil (miinimumversioon) |
| 138 | `sql/138_network_portal.sql` | Network-tellimused (6 tabelit, funktsioonid, teavitused) | kui Networki projekt on olemas ja Gary tahab (litsents `portal`) |

Kõik kolm on idempotentsed. `sql/checks/schema_check.sql` on uuendatud
(trigger_check ei muutunud: uusi triggereid pole). Iga uus tabel: `org_id`,
RLS, `ensure_mfa_policies()`, leketest (üldine `rlsTenantIsolation` +
oma test); iga uus funktsioon: `lock_anon_functions()`. Networki projekti
migratsioon: `network/sql/001_network.sql` (ainult Networki projekti!).

CLAUDE.md "next one is" on nüüd **139**.

---

## Dentiksi sammud (täpne järjekord)

Enne kõike: sama järjekord **testkoopias** ja/või **võltsprojektis**
(docs/TEST-PROJECT.md), proovitud klikkidena (allpool).

1. **file-link uus versioon** (tagasiühilduv: vana `{ fileId }` töötab samamoodi):
   ```powershell
   npx supabase functions deploy file-link --project-ref fwsrnsdrlrlmjfkkkhvp
   ```
   Pärast seda töötavad nii vanad (2.2.5) kui uued rakendused.
2. **SQL Editor → `sql/136_job_seen.sql`**, siis eraldi `notify pgrst, 'reload schema';`.
   Vanad versioonid ei märka midagi (lisav muudatus).
3. **Release** uue versiooniga (sina valid numbri, nt 2.2.6) ja
   miinimumversiooniga **sama numbrini**:
   ```powershell
   npm run release -- --clinic dentiks --min-version <uus versioon>
   ```
   (docs/RELEASE.md: allkirjastamine, avaldamine, `riga` haru liigutamine
   telefoni jaoks). Soovi korral ka andmebaasi pool:
   `select public.set_app_min_version('<uus versioon>', true, 'files only through file-link');`
4. **Oota**, kuni kõik Dentiksi masinad on uuel versioonil (Settings →
   Updates / uuenduste logi). Vanema versiooni eelvaated ja patsiendi eksport
   lakkaksid 137 järel töötamast; allalaadimised mitte (need käisid juba
   file-link kaudu).
5. **SQL Editor → `sql/137_files_only_through_file_link.sql`**. Kontroll:
   ```sql
   select policyname, cmd from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'job_files%';
   -- üks rida: job_files_insert | INSERT
   ```
   Seejärel proovi: faili üleslaadimine (ka suur, TUS), eelvaade, allalaadimine,
   patsiendi eksport.
6. **Hiljem, Network:** docs/NETWORK-SETUP.md osa A (üks kord), siis osa B
   Dentiksile: `sql/138`, `network-client` (`--no-verify-jwt`) deploy,
   litsents `portal`, omanik lülitab sisse.

**Miks see järjekord, mitte "deploy → migratsioon → release":** kui 137
jookseks enne, kui kõik on uuel versioonil, jääksid vanade versioonide
eelvaated ja patsiendi eksport failideta (nende rakendus allkirjastas
lingid ise). Uus versioon ei vaja enam storage'i lugemisreeglit.

---

## Mida Kevin peab hommikul käsitsi kontrollima (klikkidena)

Eeldus: võltsprojekt tehtud (docs/TEST-PROJECT.md: uus projekt,
migratsioonid kuni 138, `node scripts/seed-fake-clinic.mjs`,
`config/test-fake.env`).

**Osa 1: võltsprojekt**
1. `node scripts/seed-fake-clinic.mjs`: küsib kõike varjatult; proovi
   meelega kleepida testkoopia ühendusstring → peab keelduma ("TEST COPY").
2. Lõpus tabel: clinic 1, people 6, customers 4, patients 30, jobs 40,
   templates 3, invoices 5, pay rules 5, stock items 5.
3. `npm run dev:fake` → kollane raam, üleval **FAKE DATA**. Logi sisse
   `owner@fake.wivodent.com` (lisab teise teguri).
4. Tahvel: tööd kõigis etappides; Settings → Prices: 10 töötüüpi piltidega,
   All-on-4 → Framework: Metal bar 400 €; Payroll: Tomas → reegel "Metal bar
   made" (ainult valikuga); Ladu: 5 artiklit, üks aegumas.
5. `npm run dev:fake:2` → teine aken, logi sisse `design@fake.wivodent.com`.

**Osa 2: "uus tegevus" märk** (kaks akent nagu ülal)
6. Aken 1 (omanik): ava mõni töö, mis on Dana (disainer) oma, lisa märge.
7. Aken 2 (Dana): selle töö kaardil sinine märk (märkme ikoon); hiir peale →
   "1 new: note · by Olly Ownerfake". Aken 1 kaardil märki **ei ole**.
8. Aken 2: ava töö → märk kaob. Kui Dana on ka telefonis sees
   (`npm run mobile:dev`), kaob märk ka seal kohe.
9. Lisa aknas 1 fail ja liiguta etappi → aknas 2 märk numbriga "2".

**Osa 3: failid** (pärast `file-link` deployd võltsprojekti ja 137)
10. Töö → Files: lae fail üles, eelvaade (pilt/STL) näha, "Save" laeb alla.
11. Patsient → Export: zip tuleb koos failidega.
12. Kui midagi ei tööta: 137 tagasi võtmiseks käsitsi
    `create policy "job_files_select" …` sql/072 järgi (ära muuda faile).

**Osa 4: Network** — docs/NETWORK-SETUP.md osa C (8 sammu).

**Telefon:** `npm run mobile:dev` → avaleht (märgid), töö avamine, etapi
liigutamine, `/network` (ilma `VITE_NETWORK_URL`-ita: "not set up").

---

## Osa 1: võltsandmetega testprojekt

- `sql/demo/fake-clinic.sql`: üks SQL-fail (testitav PGlite'is täpselt
  sellisena, nagu ta jookseb), `<FAKE_PASSWORD>` kohatäide. Väravad failis
  endas: parool asendatud; ühtegi teist kliinikut; ühtegi kasutajat väljaspool
  `@fake.wivodent.com`. Teist korda jooksutades ei lisandu midagi.
- `scripts/seed-fake-clinic.mjs`: küsib **varjatult** ühendusstringi,
  andmebaasi parooli ja kontode parooli (kaks korda), keeldub tootmise,
  testkoopia ja iga `clinics/*.json` projekti id järgi, jooksutab psql-i
  **ühe tehinguna** (`--single-transaction`, `ON_ERROR_STOP`), parool
  `PGPASSWORD` keskkonnas (mitte käsureal).
- `npm run dev:fake` / `dev:fake:2`: test-režiim, ainult teine aadress
  (`config/test-fake.env`, gitis ignoreeritud; `.example` on gitis), oma
  kaustad `%APPDATA%\wivo-test-fake(-2)`. Rakendus keeldub tootmisest ja
  testkoopiast id järgi ka siis, kui fail neile osutab.
- Töötüübid on kataloogist (`katalog`, `pildiValik`), test kontrollib, et
  nimi, ühik, valikud ja pilt vastavad kataloogile.
- **Otsus:** GoTrue loeb `auth.users` tokeniveerge stringina; seemne loodud
  kasutajatel on need `''` (mitte NULL), muidu ebaõnnestuks iga sisselogimine
  ("Database error querying schema"). **Risk:** `sql/demo/seed.sql` (vana
  demo) ei tee seda; kui demokontod sisse ei saa, on põhjus see.
- Failid (skaneeringud) seemnes puuduvad: Storage'i objekte SQL-iga ei tee.

## Osa 2: "uus tegevus" märk

- Tegevus olemasolevatest andmetest: failid (`job_file.completed_at`,
  `uploaded_by`), sõnumid (`messages` + `message_jobs`), etapid
  (`job_stage.started_*`, `done_*`), märkmed (`jobs.markused[].ts`).
- **Otsus:** märkmetel oli ainult autori nimi. `add_job_note` kirjutab nüüd
  ka `by` (kasutaja id), et enda märge ei oleks "uus" ka teises seadmes;
  vanemad märkmed võrreldakse nime järgi. See ei ole uus logi.
- `job_activity()` on **security invoker**: näitab ainult töid, faile ja
  sõnumeid, mida inimene ise lugeda tohib (tehnik oma töid, oma kanaleid).
- "Vanad tööd algavad nähtuna": `clinics.activity_seen_from` = migratsiooni
  hetk; inimese jaoks hiliseim sellest ja tema profiili loomisest.
- `job_seen` kirjutab ainult `mark_job_seen` andmebaasi kellaga (kliendi
  kell ei saa märke peita); realtime saadab rea ainult omanikule endale →
  märk kaob kohe ka teistes seadmetes.
- Märk: üks liik → ikoon, mitu → arv; tooltip "2 new: file, note · by Anna".
  Telefonis suurem.

## Osa 3: failid ainult file-link kaudu

- `file-link`: uus režiim `{ jobId, previews: true }` (300 s lingid) ja
  `{ orderFileId }` (osa 4). Loogika `_shared/fileLink.ts`, testitud.
  Kasutab nüüd `serviceClientKey` (töötab ka `sb_secret` võtmega).
- Rakendus: allalaadimine, eelvaated, patsiendi eksport → ainult file-link;
  **varutee (rakendus allkirjastab ise) on eemaldatud**. Funktsiooni puudumisel
  neutraalne "not available yet".
- Test kontrollib, et `src/` ei allkirjasta ühtegi `job-files` linki ega loe
  bucket'it otse (üleslaadimine lubatud).
- **Risk:** Supabase Storage'i üleslaadimine (`upsert: false`, TUS) ei peaks
  vajama lugemisreeglit; kontrolli võltsprojektis enne Dentiksit (samm 10).

## Osa 4: Wivo Network 1 + tellimused

Plaan ja otsused: **docs/PLAN-NETWORK-1.md** (N1–N13). Lühidalt:

- **Network** (`network/`): kontod (isik/ettevõte; tehnik/arst/kliinik/labor),
  kataloog (opt-in `listed`, muidu kutse koodiga), ühendused
  requested/confirmed/ended. Kõik nõuab teist tegurit. `network-token`
  annab 5-minutilise Ed25519 tõendi **ühele kliinikule** (domeen
  `WIVO-NETWORK-1\n`, mitte kunagi litsentsiks loetav). Network ei hoia
  tellimusi, faile, sõnumeid, hindu ega patsiente (test kontrollib: kolm
  tabelit, ühtegi sellist veergu).
- **Kliinik** (`sql/138`, `network-client`): tõend kontrollitakse
  funktsioonis Networki avaliku võtmega ja `aud` = kliiniku Networki number;
  siis andmebaas annab **8-tunnise sessiooni**, mida hoitakse ainult
  SHA-256-na. Iga kõne kontrollib andmebaasis: sessioon elus, ühendus
  kinnitatud, portaal sees. **Kliendil pole sisselogimist ega rolli
  kliiniku projektis**: `client_*` funktsioonid on ainult service rollile,
  igaüks leiab kliendi sessioonist ja puudutab ainult tema ridu.
- Omanik kinnitab → klient tekib **Clients** (isik) või **Clinics**
  (kliinik/labor) nimekirja, omanik valib, mida klient näeb (olek,
  sõnumid, failid, hinnad; vaikimisi hinnad väljas).
- Tellimus "Wivo order" v1 (**docs/WIVO-ORDER-FORMAT.md**): töötüüp
  kliiniku kataloogist, hambad, valikud, toon, tähtaeg, **patsiendi viide
  (≤40 märki, mitte nimi)**, märkused, failid. Tundmatu väli → tagasi.
- Kliinik: menüüs **Orders** sinise märgiga, kellukeses teavitus (ilma
  patsiendita), tellimus → **Accept** malliga (tavaline töö, failid töö
  failideks) või **Reject** põhjusega, sõnumid mõlemas suunas.
- Klient: telefonirakenduse **Network-režiim** `/network` (töötab ka arvuti
  brauseris): registreerumine, teine tegur (QR), profiil, kliiniku otsimine
  või kutse link `/network/join/<kood>`, ühenduse soov, minu kliinikud,
  New order, My orders (received / in progress / ready / sent / rejected),
  sõnumid, failid.
- Litsentsimoodul **`portal`** (vaikimisi väljas; arendusrežiimis ja
  telefonis on moodulid sees, aga andmebaasis on tellimused väljas, kuni
  omanik need lülitab).

**Testid (osa E):**
- konto A ei näe konto B tellimusi, faile ega sõnumeid (`networkPortal.test.ts`);
- Networki tõend ühe kliiniku jaoks ei kehti teises (`token.test.ts`,
  `networkClient.test.ts`, andmebaasi pool `networkPortal.test.ts`);
- lõpetatud ühendus (omanik või klient) ja välja lülitatud portaal →
  ligipääs kaob kohe;
- Network maas → antud sessioon kehtib kuni aegumiseni (andmebaas ei
  pöördu kunagi Networki poole; funktsioon kasutab tõendit ainult
  `connect`-is), pärast aegumist mitte;
- `client_*` ei käivitu sisseloginud kasutajale ega anon'ile;
- Networki skeem: konto näeb ainult ennast, kataloog ainult listed,
  kutse kood loetamatu, ühendusi saab muuta ainult funktsioonidega,
  ilma teise tegurita mitte midagi.

**Otsused, mis tegin ise:**
- **Sessioon on läbipaistmatu juhuslik tõend, mitte varjukasutaja kliiniku
  GoTrue's.** Nii ei pea muutma MFA reeglit (sql/098) ega anon'i reeglit
  (sql/101), ja kliendi piir on ühes kohas.
- **Network peegeldab, kliinik otsustab** (N7): Networki "confirmed" on see,
  mida konto rakendus kliinikult kuulis; ligipääsu jaoks seda ei usaldata.
- **Networki seadistus on Orders lehel** (omaniku kaart), mitte Settingsi
  uues jaotises: vähem koodi, sama koht kus tellimused.
- Kliendi ekraanid on telefonirakenduses, mitte eraldi rakendus (N12).
- **Ladu ja arved kliendile** jäid järgmiseks (lubatud, kui ei jõua).

**Riskid:**
- Ühtegi osa ei ole päris Supabase'is jooksnud. PGlite katab andmebaasi;
  GoTrue TOTP Networkis, Storage'i allkirjastatud üleslaadimine
  (`createSignedUploadUrl` + PUT) ja Edge Functionid on proovimata.
  docs/NETWORK-SETUP.md osa C on see proov.
- Telefoni CSP on Report-Only. Kui see kunagi jõustatakse, peab
  `connect-src` lubama Networki aadressi ja kliinikute `*.supabase.co`
  (praegu ainult raporteerib).
- Õigusnõunik (docs/WIVO-NETWORK.md): väliste tehnikute ja arstide kontod
  keskses projektis ELis; tellimustes võivad skaneeringud olla terviseandmed.
  Enne päris kasutust.
- Networki `network-token` deploy käsk (`--workdir network`): CLI versioon
  võib oodata `supabase/functions` struktuuri; juhend ütleb, mida teha.

---

## Osa 5: vene keel

Tõlgitud **1124 olemasolevat võtit** (ingliskeelsest allikast, kõik
kohatäited `{…}` kontrollitud), lisaks kõik täna lisatud uued tekstid vene
keeles (Network, Orders, märk, FAKE DATA: **159 võtit**). `ru.ts`-is on nüüd
~1610 võtit (oli ~170).

| Ekraan | Eesliide | Võtmeid |
|---|---|---|
| Lisa töö (viisard ja reeglid) | `wizard.`, `wizardRules.` | 289 |
| Payroll (ka palgareeglid, tiim, palgaread) | `workers.`, `earnings.`, `payLine.` | 288 |
| Töö leht | `jobDetail.` | 256 |
| Telefon, tahvel, menüü, sisselogimine, teine tegur, failid, hambad, nädalapäevad | `mobile.`, `board.`, `sidebar.`, `auth.`, `mfa.`, `files.`, `teeth.`, `common.`, `app.` | 239 |
| Jobs tabel | `tableView.` | 52 |
| Settings avaleht | `settingsHome.` | oli juba tõlgitud (43) |

**Jäi tõlkimata:** 31 võtit, mis on funktsioonid (mitmuse vormid), näitavad
inglise keelt; ülejäänud ekraanid (Settings sisu, Ladu, Statistika, Arved,
Kalender, Audit) on järgmise korra töö (ROADMAP-2.5 L1). **Soovitus:**
lase Riia töötajal üle vaadata eriti hambatehnika sõnad (культя, абатмент,
переделка) — tõlge on minu, mitte emakeelse tehniku oma.

## Osa 5: läti keel (ainult plaan)

- **Praegu:** liidese keel on `en`/`et`/`ru` kolmes kohas:
  `shared/i18n/index.ts` (`LANGS`), `profiles.language` check
  (`language = any(array['en','et','ru'])`) ja `clinics.default_language`
  check (sama). Kataloogil (`workTypeCatalogue.ts`) on läti nimed juba olemas
  (`CatalogueLang` sisaldab `lv`).
- **Migratsioon on vaja:** üks fail, mis vahetab kaks check-reeglit
  (`profiles_language_check`, `clinics_default_language_check`) `en, et, ru, lv`
  peale (`drop constraint if exists` + `add constraint`, idempotentne), +
  schema check uuesti. Andmeid ei muuda.
- **Kood:** `shared/i18n/lv.ts` (Partial nagu ru), `LANGS` + keelevalija,
  `dateLocale` (date-fns `lv`), Chromiumi keel (`src/main/uiLanguage.ts`:
  `lv-LV`), e-kirjade ja arvete keel eraldi (need ei käi `t()` kaudu).
- **Järjekord:** migratsioon enne rakendust (vana andmebaas keelduks
  `lv` salvestamisest; rakendus peab siis näitama neutraalset teadet).
  Tõlge: alustada samadest ekraanidest kui vene keelega.
