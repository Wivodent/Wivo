# Wivo 2.2.0: raport (Dentiks)

**Haru:** `testing`. Midagi pole pushitud. Versiooni ei tõstetud ja release'i ei tehtud.
Andmebaasiga ei ühendunud.

**Kontrollid (viimane seis):**
- Täis testikomplekt (`npx vitest run --mode unit`) jookseb ühe korraga: 207 faili,
  2736 testi, kõik rohelised.
- `tsc`: web ja node rohelised.
- Build õnnestus nii arvutile (`electron-vite build`) kui telefonile
  (`vite build --config vite.mobile.config.ts`).

## Commitid

| Osa | Hash | Mis |
|---|---|---|
| Pildid | `441bcf2` | 56 WebP pilti, teisendusskript, valge alus |
| 4. Läti tööandja maks | `191fb42` | Finance/Statistics inimese järgi |
| 4. Testkoopia env | `c255caf` | README: kust test mode seaded võtab |
| 1. Implantaadid | `23f29cb` | Teeth: tööriistariba, „+" hamba kohal, kokkuvõte |
| 2. Ordered by | `8611409` | Patient & order lüliti + migratsioon 128 |
| 3. Töötüübi valikud | `7afbbbc` | Raamatukogu, grupid, nupud, hind ja kulu |
| 5. Kataloog | `19ecd76` | Lisa kataloogist, 43 tööd |
| ROADMAP | `42656b0` | Mis jäi 2.2.0-st järgmisse |

## Mis valmis

### 1. Implantaadid hammaste valikul (Lisa töö → Teeth)
- „Implants" ja „Dentist view" nupud on hambakaardi seest välja toodud ja asuvad
  kaardi kohal tööriistaribal, 2D/3D kõrval. Seda ainult Lisa töö vormil; töö
  lehel on kaart endine (uued omadused on valikulised).
- **Iga valitud hamba kohal on väike „+" nupp.** Klõps muudab hamba implantaadiks
  (must ring ja välgu märk), teine klõps eemaldab. Tekst „+ Implant" ei mahtunud
  34 px laiuse hamba kohale, seega on nupul „+" märk; tekst on tooltip'is ja
  ekraanilugeja jaoks. 3D vaates on samad nupud rida kaardi all
  („14 + Implant").
- **Implantaatidel põhinevad tööd** märgivad valitud hamba kohe implantaadiks:
  implantaadi kroon ja sild, abutment, All-on-4/5/6, hübriid- ja katteprotees.
  Liik loetakse töötüübi sõnadest kolmes keeles (`workTypeRules.implantBased`)
  või kataloogi kirjest, mitte nimest. Silla puhul saab vahelülidelt märgi maha
  võtta.
- **All-on-X (terve lõualuu) puhul ei märgita midagi ise**, sest nelja
  implantaadi peal on kaksteist hammast. Implantaadid klõpsatakse sinna, kus nad on.
- Kaardi all on kokkuvõte, nt „4 teeth · 2 implants (14, 11) · 2 pontics (13, 12)".
  Vahelülid näidatakse implantaatidel põhineva silla puhul.
- „Screw / abutment" väli ilmub alles siis, kui vähemalt üks implantaat on
  märgitud, ja küsib ainult implantaatide kohta.
- Muutus: implantaati saab nüüd märkida iga tüübi hambale, mitte ainult
  „implant/abutment" nimega tüübile. Vana test, mis seda keelas, on uuendatud.

### 2. „Ordered by" lüliti (Lisa töö → Patient & order)
- Kolm valikut kujunduse järgi:
  - **Our clinic:** Doctor (meie inimene);
  - **Another clinic:** kliinik ja nende tellimuse number;
  - **Dentist / technician:** inimene ja tellimuse number.
- Kui hambaarste ega tehnikuid veel pole, näidatakse vihjet.
- Vaikimisi valik: kliiniline kliinik alustab „Our clinic"-ust, labor
  „Another clinic"-ust. Mustand, kus klient on juba valitud, alustab
  „Another clinic"-ust.
- Klientide all on uus „Type" lüliti: Clinic / Dentist or technician.
- Review samm näitab, kes tellis.
- Andmemudel vajas muutust: **migratsioon 128** (allpool). `jobs.ordered_by`
  (töö looja, WORKFLOW-STAGES §2.6a) jäi puutumata. Arst on eraldi väli
  `order_doctor`, sest looja ja tellinud arst võivad olla eri inimesed.

### 3. Töötüübi valikud (esimene versioon)
- **Üks raamatukogu.** Valik (nt „Metal bar") on defineeritud üks kord:
  - nimi, lisahind kliendile ja meie kulu, töö või hamba kohta;
  - arhiveeritav, mitte kustutatav, sest vana töö peab oma hinna alles hoidma.
- Töötüübil on **valikugrupid**, mis viitavad raamatukogu valikutele id järgi.
  Grupp on kas „vali üks" (koos „None"-ga) või „vali mitu". Üks valik võib
  olla mitme töötüübi grupis.
- **Seaded → Hinnad:**
  - iga töötüübi kaardil on „Options" plokk: grupid, „Kas saab valida mitu?",
    valiku lisamine raamatukogust või uue tegemine;
  - kaartide all on raamatukogu („Options" osa).
- **Lisa töö → Production:** iga tööüksuse kaardil on grupi kohta suured
  nupud, koos valiku pildiga, kui see on olemas
  (`assets/worktypes/3d/options/<id>.webp`). Pildita valik näitab ainult teksti.
- **Hind:** iga valitud valik on hinnas eraldi rida („All-on-4 · Metal bar").
  Kiirtöö korrutab ka seda.
- **Kulu:** Finance ja Statistics lisavad selle töö kuludesse.
- **Review** näitab valitud valikuid.
- Kõik on jsonb-s, migratsiooni pole vaja:
  - raamatukogu: `clinic_settings.pricing.tooValikud`;
  - grupid: `work_types[].valikuGrupid`;
  - töö valik: `work_items[].valikud`.
- **Järgmisse versiooni** (ROADMAP-is): lisaetapid valiku järgi, palgareeglid
  valiku järgi, kohustuslik grupp, valikud töö lehel ja kaardil, reprice.

### 4. Väiksed
- **Läti tööandja maks** Finance/Statistics-is on nüüd inimese järgi:
  pensionär 20,77%, teised 23,59%, kaalutud tema brutoga
  (`employerRateForStaff`). Eesti ja muud riigid on endised.
- **Testkoopia env:** `.env.test`-i ei loeta enam üldse. `npm run dev:test`
  võtab URL-i ja anon võtme failist `config/test-copy.env`. See fail on gitis,
  täidetud ja sisaldab ainult kahte avalikku väärtust. `.env.test` kaotati
  teadlikult, sest GitHub Desktop peitis selle haru vahetusel ära (kolm korda
  2026-11-03).
  - `.env.test.example`-it ma **ei teinud**: see juhataks faili juurde, mida
    rakendus ei loe.
  - README-s on nüüd osa „Test mode": kust väärtused tulevad ja kuidas need
    täita, kui testkoopia kunagi vahetub. Ühtegi võtit ei lisatud.
  - Kui `dev:test` sul ei käivitu, saada mulle veateade: see tuleb mujalt.

### 5. Töötüüpide kataloog
- `shared/pricing/workTypeCatalogue.ts`: 43 kirjet, üks iga pildi kohta (id =
  failinimi). Kirjel on:
  - nimed en/et/ru/lv;
  - liik (crown, bridge, implant, denture, guard, model, digital, other);
  - hinnaühik;
  - implantaatidel põhinev või mitte;
  - soovitatud valikugrupid.
- Valikuid on 13, üks iga valiku pildi kohta. All-on-4 soovitab „Framework":
  metal-bar, zirconia-framework, cocr-framework, peek-bar ja „Attachments":
  multi-unit, ti-base.
- **Hinda ega kulu kataloogis pole.** Test kukub, kui kuskile tekib.
- **Seaded → Hinnad → „Add from catalogue":**
  - suurte 3D piltidega ruudustik, liigi järgi grupeeritud;
  - otsing kõigis keeltes;
  - igal ruudul „+ Add" või „Added ✓";
  - hoiatus „You already have: X", kui sama liigi töö on juba teise nimega
    olemas. „+ Add" jääb siis ikka alles.
- **Lisamine** teeb tavalise töötüübi kliiniku keeles:
  - õige hinnaühik, hind tühi;
  - teised keeled on sünonüümid, nii et vormi reeglid ja pilt töötavad ka
    ümbernimetamise järel;
  - soovitatud grupid. Raamatukogust puuduvad valikud lisatakse hinnata.
  - Olemasolevaid töötüüpe ei muudeta. Kui nimi on juba võetud, saab uus
    töötüüp numbri („Zirconia crown 2").
- „Set up your clinic" nimekirjas on „Work types" ja „Prices" nüüd üks samm,
  „Work types & prices", mis avab otse kataloogi.
- Lätikeelsed nimed on olemas, aga `clinics.default_language` lubab praegu
  ainult en/et/ru. Seega Dentiks (inglise keel) saab ingliskeelsed nimed.

### Pildid
- Python Pilloniga teisendasin 56 pilti: 43 töötüüpi ja 13 valikut. Igaüks on
  384×384 WebP kvaliteediga 85.
- Skript: `node scripts/optimize-worktype-images.mjs`. `sharp`-i projektis
  pole, seega teeb töö `scripts/optimize-worktype-images.py`. Vaja on Python 3
  ja `pip install pillow numpy`. Uue teegi lisamine ühe aastas paar korda
  käivitatava skripti jaoks ei tasunud end ära.
- Originaalid (PNG, kokku 62 MB) on kaustas `assets-src/worktypes/3d/`, mis on
  `.gitignore`-is. Neid ei commititud.
- **Taust:** ükski originaal polnud läbipaistev, kõik olid RGB peaaegu valgel
  taustal. Proovisin tausta läbipaistvaks teha, aga see ei tulnud puhtalt:
  lõige läks valgete hammaste ja kroonide sisse ning tausta müra jäi tumedale
  kaardile täppidena. Jätsin tausta, tegin selle puhtaks valgeks ja rakendus
  näitab pilte valgel ümaral alusel, ka tumedal valitud kaardil. Kui hiljem
  tulevad läbipaistvad originaalid, jätab skript läbipaistvuse alles.
- **Suurus:** kõik WebP pildid kokku 296 210 baiti (umbes 289 KB), 2–9 KB
  pilt. Kogu kaust koos README-ga on 298 840 baiti.
- **Nimed vs varasem nimekiri** (2.1.0 README tabel): klappisid `bridge`,
  `veneer`, `night-guard`, `surgical-guide`, `all-on-4`, `all-on-6`,
  `titanium-mesh`. Teistsugused nimed:
  - `implant-crown` → `crown-implant`;
  - `crown` → `crown-zirconia` (ja `crown-metal-ceramic`, `crown-temporary`);
  - `denture` → `denture-full`;
  - `inlay` ja `onlay` → `inlay-onlay`;
  - `retainer` → `retainer-fixed` ja `retainer-removable`.

  Puudu on `implant-bridge`, `laminate`, `filling`, `all-on-x` ja `ibt`: need
  näitavad joonikooni. Kaardistus järgib nüüd failinimesid (ühtegi faili ei
  nimetatud ümber). Uued failid, mida tabelis polnud, said kataloogi kirjeteks.

## Migratsioonid

**`sql/128_order_source.sql`** (uus; käivitab Kevin, testkoopias, pärast 127-t):
1. `jobs.order_source` ('own' | 'clinic' | 'person'; NULL = pole öeldud).
2. `jobs.order_doctor`: viide `profiles(id)` peale, `on delete set null`.
   Trigger lubab ainult sama kliiniku liiget.
3. `customers.kind` ('clinic' | 'person', vaikimisi 'clinic'). Seda saab lugeda
   iga liige, nagu kliendi nime (sql/118).
4. `audit_field_rules()` uuesti, koos kahe uue veeruga. Lõpus
   `select public.lock_anon_functions();`.

**Vanad tööd ja kliendid:** midagi ei kirjutata ümber. Iga vana töö
`order_source` ja `order_doctor` on NULL ning töö näeb välja nagu enne: tema
klient on endiselt tema klient. Iga vana klient on 'clinic'.

**Enne migratsiooni** töötab rakendus edasi:
- tööd salvestatakse ilma uute veergudeta;
- kõik kliendid on kliinikud;
- kliendi tüübi salvestamine jäetakse vahele.

**Kevini sammud testkoopias:**
1. Kui `sql/127` pole veel tehtud, tee see enne.
2. SQL Editoris käivita `sql/128_order_source.sql` tervikuna.
3. Eraldi päringuna käivita `notify pgrst, 'reload schema';`.
4. Read-only kontroll: `sql/checks/schema_check.sql` ja
   `sql/checks/trigger_check.sql` peavad mõlemad andma null rida. Mõlemad on
   128 jaoks uuesti genereeritud.

## Mida Kevin peab käsitsi kontrollima (`npm run dev:test`, testkoopia, omanikuna)

1. **Teeth:**
   - Lisa töö → vali „Implantkroon": vali hambad 14 ja 15. Mõlemad on kohe
     implantaadid (must ring), kokkuvõte ütleb „2 implants (15, 14)" ja
     „Screw / abutment" väli on näha.
   - Klõpsa 15 kohal „+": märk kaob.
   - Vali „Implantaadisild" 13–16 ja võta 14 ning 15 pealt märk maha.
     Kokkuvõttes peab olema „2 pontics".
   - Tavalisel „Kroon" tüübil märgitakse hammas ainult „+" nupuga.
   - Proovi ka 3D vaadet (nupud on rida kaardi all) ja „Dentist view" nuppu
     tööriistaribal.
2. **Patient & order:**
   - Lülita kolme valiku vahel.
   - „Our clinic" juures vali arst; „Another clinic" juures vali klient ja
     tellimuse number.
   - Salvesta. Töö reas peavad SQL-is olema `order_source` ja `order_doctor`,
     ainult loe, ära muuda.
   - Klientide all märgi üks klient „Dentist or technician"-iks: ta ilmub
     kolmanda valiku alla.
3. **Valikud:**
   - Seaded → Hinnad: lisa raamatukogusse „Metal bar" (lisahind 400, kulu 120).
   - All-on-X kaardil lisa grupp „Framework" ja sinna Metal bar.
   - Lisa töö → All-on-X: Production sammus on Framework nupud (Metal bar
     pildiga, None).
   - Review hinnas peab olema eraldi rida „All-on-X · Metal bar 400 €".
   - Kui töö on valmis, peab Finance'is kulu sisaldama 120 €.
4. **Kataloog:**
   - Seaded → Hinnad → „Add from catalogue".
   - Otsi „zirconia" ja lisa: see muutub „Added ✓"-ks ja hinnakaart ilmub
     tühja hinnaga.
   - Lisa All-on-4: raamatukogusse tulevad soovitatud valikud ilma hinnata.
   - Kroonidel peab olema „You already have: Kroon".
   - „Set up your clinic" → „Work types & prices" peab avama kataloogi.
5. **Läti:** Lätis (kui testkoopia kliinik on Lätis) märgi üks inimene
   pensionäriks. Finance'i tööandja maks peab olema väiksem kui 23,59% tema
   brutost.
6. **Pildid:** vaata valitud (tumedat) tööliigi ruutu Lisa töö 1. sammus.
   Valge alus peab välja nägema sihilik.

## Otsused ja riskid

- **Vana versiooni aken:** 2.1.x rakendus kirjutab hinnad (`pricing`) ilma
  valikute raamatukoguta. Järgmine 2.2.0 salvestus paneb selle tagasi, sest
  kohalik koopia jääb alles. Kui Riia kasutab 2.2.0-i, tasub minimaalne
  versioon tõsta 2.2.0 peale (docs/MIN-VERSION.md, ROADMAP).
- **„Ordered by" pole veel töö lehel ega tabelis.** Seda küsitakse ainult uue
  töö vormil.
- **„Tellija" etapi inimene** (§2.6a) on endiselt töö looja, mitte valitud arst.
- **Kataloogi tööd, mille sõnadest ei saa hambaid järeldada,** ütlevad ise,
  mida nad küsivad (`WorkType.hambaviis`). Näiteks digitaalne skaneering,
  alainer ja spordikaitse ei küsi hambaid; hammustusvall ja igemmask küsivad
  lõualuud.
- **Implant bridge** kataloogis pole, sest pilti pole (ROADMAP).
