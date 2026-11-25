# Wivo 2.2.1: raport

**Haru:** `testing`. Midagi pole pushitud. Versiooni ei tõstetud (package.json on
endiselt 2.2.0) ja release'i ei tehtud. Andmebaasiga ei ühendunud. **Migratsioone
pole**, järgmine on endiselt 131.

**Kontrollid (viimane seis):**
- Täis testikomplekt (`npx vitest run --mode unit`): 213 faili, 2868 testi, kõik
  rohelised.
- `tsc` (web ja node): roheline.
- Build õnnestus nii arvutile (`electron-vite build`) kui telefonile
  (`vite build --config vite.mobile.config.ts`).

## Commitid

| Osa | Hash | Mis |
|---|---|---|
| 1. Minimaalne versioon | `a9ff6e0` | `min_version` allkirjastatud nimekirjas, `--min-version`, „Please update Wivo", salvestamise keeld |
| 1. Parandus | `be41d23` | Lugemise jälgede märkused kommentaarideks (SQL-viidete kaitsetest) |
| 1. Test mode | `50b7908` | Test mode loeb salvestatud miinimumi, et seda saaks käsitsi proovida |
| 2. Litsentsi lõpetamine | `d41f62e` | `terminate`, `--until`, juhend §7a |
| 3. Töötüübi pilt | `68029e6` | Kaardistuse parandus ja omaniku valik Settings → Prices |
| Raport | (see fail) | |

## 1. Minimaalne versioon

**Kuidas see töötab**
- Väljalasketööriist kirjutab allkirjastatud nimekirja (`updates.json`, index)
  uue välja `min_version`. Sellele annab allkirja sama update-võti (YubiKey C,
  slot 9c), sama ahelaga mis praegu. SQL-i ja kliiniku andmebaasi pole vaja.
- **Lipp:** `npm run release -- --clinic dentiks --min-version 2.2.1`. Sama lippu
  võtab ka `release:sign`.
- **Ilma uue versioonita, ühe puudutusega:**
  ```
  npm run release:sign -- --clinic dentiks --refresh --min-version 2.2.1
  npm run release:publish -- --clinic dentiks --refresh
  ```
  `--min-version off` eemaldab miinimumi.
- **Kui lippu ei anta,** jääb avaldatud miinimum alles. Uus release ei kustuta
  seda kogemata.
- **Tööriist keeldub,** kui miinimum on kõrgem kui nimekirjas olev release. Muidu
  ei oleks miinimumist allpool oleval arvutil millegagi uueneda.
- Enne allkirjastamist näitab tööriist rida „Minimum version: … (new / unchanged
  / was …)". YubiKey küsimus nimetab miinimumi samuti.

**Mida arvuti teeb**
- Arvuti loeb nimekirja 5 s pärast käivitust, iga 30 minuti järel ja „Check now"
  vajutamisel.
- Miinimumi võetakse arvesse ainult sellisest nimekirjast, mida arvuti
  aktsepteeriks ka uuenduse jaoks:
  - allkiri on õige;
  - kanal on `stable`;
  - nimekiri pole aegunud;
  - serial ei ole madalam kui juba nähtud;
  - release'i teade on selle kliiniku buildi jaoks.

  Teise kliiniku või main'i nimekiri ei muuda midagi.
- Viimane vastu võetud miinimum salvestatakse userData faili
  `release-minimum.json`. See kehtib kohe pärast taaskäivitust ka siis, kui
  nimekirja ei saa kätte või see on aegunud. Muudab ainult uuem kehtiv nimekiri.
- **Kui arvuti versioon on miinimumist madalam,** näeb kasutaja täisekraani
  „Please update Wivo":
  - tekst ütleb, mis versioon töötab ja mis on miinimum;
  - nupp **Update now** laeb uuenduse kohe alla. Siis muutub nupp **Restart and
    update** nupuks, mis taaskäivitab ja uuendab;
  - nupp **View only** peidab täisekraani. Üles jääb riba, millel on samuti
    „Update now".
- **Salvestamine:** andmebaasi klient keeldub salvestamisest enne, kui päring
  arvutist välja läheb. Vastus on sama, mille annab andmebaas vanale buildile
  (HTTP 426, `update_required`), nii et kõik ekraanid, mis salvestusvigu
  näitavad, ütlevad juba „Update Wivo".
- **Lugemine jääb:**
  - nimekirjad, tööd, failid, eelvaated ja eksport;
  - jäljed, mida lugemine jätab: töö avamise audit, faili allalaadimise luba,
    ekspordi auditikirje, teavituste loetuks märkimine.

**Otsused ja piirid**
- **Mõjub alles 2.2.1-st.** Dentiksi 2.2.0 arvutid miinimumi ei loe. Esimene
  release, mis saab miinimumi nõuda, on see, mis tuleb pärast 2.2.1.
- **Mis on lugemine ja mis salvestamine:**
  - lugemine on GET ning RPC-d, mis on andmebaasis `stable`;
  - funktsioonide nimekiri on `lib/releaseMinimum.ts`-is;
  - test võrdleb seda failiga `sql/checks/schema_check.sql`;
  - kui rakendus kutsub välja uue lugeva funktsiooni ja see nimekirjast puudub,
    test kukub läbi;
  - kõik muu, mida pole nimekirjas, loetakse salvestamiseks.
- **Muud piirid:**
  - konto muutmine (parool, e-post) on keelatud;
  - sisselogimine ja teine faktor töötavad;
  - Edge Function'itest on lubatud ainult `file-link`.
- **See pole turvakontroll,** sama nagu sql/104: kontroll on rakenduses endas.
  Andmebaasi reeglid (RLS, õigused) on kõigile buildidele samad.
- **Telefon ei ole mõjutatud.** Ta laeb igal käivitusel Cloudflare'ist uusima
  versiooni.
- **Ettevaatust:** miinimumist madalam arvuti saab tööd jätkata ainult siis, kui
  uuendus paigaldub. Pane miinimum alles siis, kui see release on avaldatud ja
  oled näinud, et üks masin selle paigaldas. Kui uuendus ebaõnnestub, kasuta
  `--refresh --min-version off`.

## 2. Litsentsi lõpetamine

- **`--until YYYY-MM-DD`** käskudega `sign` ja `renew`, `--months` asemel.
  Tööriist keeldub, kui antakse mõlemad, kui kuupäev pole päris kuupäev või kui
  see on minevikus.
- **`terminate WIVO1.… [--until …] --publish --clinic <id>`:**
  - sama sisu: nimi, plaan, kohad, org, aadress, moodulid;
  - `iat` = täna;
  - `exp` = `--until`. Kui `--until` puudub, siis täna + 14 päeva, või litsentsi
    enda lõpp, kui see tuleb varem.
- **Tööriist keeldub, kui:**
  - lõpp on hilisem kui vana litsentsi lõpp (see oleks pikendus);
  - antakse `--months`;
  - antakse tingimuste muutmise lipp;
  - litsents on juba lõppenud.
- **Tööriist ütleb enne allkirjastamist:**
  - vana ja uue litsentsi kuupäevad;
  - päeva, millest Wivo ainult loeb (lõpp + 14 päeva armuaega);
  - et võrguühenduseta lukustust pole.
- **Testiga kontrollitud:** hilisema `iat`-iga token asendab vana ka siis, kui
  selle `exp` on varasem (`src/main/licenceFeed.test.ts`, rakenduse reeglid). See
  kehtib ka tööriista `--publish` puhul, sest tööriist kasutab samu reegleid
  (`scripts/makeLicense.test.ts`). Vanem token, mis avaldatakse kogemata
  uuesti, ei too pikemat litsentsi tagasi.
- Juhend: docs/RELEASE.md §7a „Lepingu lõpetamine". Rakenduse loogikat ei
  muudetud: litsentsi vastuvõtmise reegel oli juba „hilisem väljaandmise päev".

**Piirid:**
- **Sama päev:** kui viimane litsents anti välja täna, keeldub `--publish`
  („not_newer"). Tööriist hoiatab selle eest. Sel juhul lõpeta järgmisel päeval
  või kleebi võti käsitsi.
- **Telefon** litsentsi ei kontrolli.
- **Võrguühenduseta masin** hoiab oma litsentsi kuni selle enda lõpuni. Seda ei
  ehitatud, nagu paluti.

## 3. Töötüübi pilt

**a) Kaardistuse viga: põhjus.** Settingsis ümber nimetatud töötüüp hoiab alles
oma vanad sünonüümid (`match`). Varem otsiti kataloogi täpset nime nii nime kui
ka sünonüümide seast korraga. Seepärast:
- „smile design", mis oli enne „Implantaadisild", leidis sünonüümi
  „implant bridge" ja sai implantaadisilla pildi;
- „Crown design", mis oli enne „Sild", leidis sünonüümi „bridge" ja sai silla
  pildi;
- „implant surgical guide" leidis üksiku sõna „implant" ja sai implantaadikrooni
  pildi.

Neid nimesid ma testis ilma sünonüümideta ei saanud valeks. Sünonüümidega sain
täpselt Dentiksi vead.

**Parandus:**
- Kõigepealt loetakse **tüübi enda nime** ja alles siis sünonüüme.
- **Mitmesõnaline fraas võidab üksiku sõna**, pikim enne. Fraasid on kataloogi
  kõik nimed neljas keeles (näiteks „Crown design (CAD)" ka kujul „crown
  design") ja variantide fraasid (titanium mesh, post and core jne).
- Fraas loeb ainult sõna algusest. Nii ei ole „Несъёмный ретейнер" sama mis
  „Съёмный ретейнер".
- Joonikoon: kirurgiline juhik kontrollitakse enne implantaati.

**Testid:**
- Dentiksi neli nime, nii vanade sünonüümidega kui ilma.
- **Kataloogi kõik mitmesõnalised nimed** (üle 60, neli keelt), igaüks nelja
  erineva vana sünonüümide komplektiga.

**b) Omaniku valik:**
- Kus: Settings → Prices töötüübi kaardil. Pildile klõpsamine või link „Change
  picture" avab ruudustiku.
- Ruudustikus on kõik 3D pildid (nimetatud kliiniku kataloogikeeles) ja kõik
  16 joonikooni. „Automatic" taastab automaatse valiku.
- Valik salvestub töötüübi juurde väljale `work_types[].pildiValik`, ilma
  migratsioonita:
  - 3D pildi id, näiteks `surgical-guide`;
  - või joonikoon, näiteks `icon:surgicalGuide`.
- Laadimisel visatakse muu väärtus ära. Kui faili enam pole, valitakse pilt
  automaatselt.
- Vanemad versioonid jätavad välja alles: work_types salvestatakse tervikuna.
- Valik kehtib nendes kohtades:
  - Lisa töö 1. samm (pilt ja joonikoon);
  - Prices'i kaart;
  - kataloogi „Added" kaart, mis näitab nüüd kliiniku enda tüübi pilti.
- **Tühjad lehed** näitavad üldist pilti (krooni), mitte ühte töötüüpi. Seal pole
  midagi, mida valik muudaks.

**c)** Lisa töö 1. sammus valikut pole, nagu paluti.

## Mida Kevin peab käsitsi kontrollima

**1. Minimaalne versioon (`npm run dev:test`):**
1. Pane test mode'i userData kausta fail `release-minimum.json` sisuga
   `{"min_version":"9.9.9","key_id":"x","serial":1}`. See on test mode'i oma
   kaust, `%APPDATA%` all nimega `…-test-copy`.
2. Käivita rakendus ja logi sisse. Peab näitama täisekraani „Please update Wivo",
   versioonidega 2.2.0 ja 9.9.9.
3. **View only:** üles jääb riba.
   - Nimekirjad, töö ja failid avanevad.
   - Töö salvestamine ütleb „Update Wivo…".
   - Võrgu vahekaardil ei lähe salvestuspäringut välja.
4. Kustuta fail ja taaskäivita: kõik töötab tavapäraselt.
5. „Update now" test mode'is midagi ei laadi (test mode ei uuenda). Päris voogu
   saab proovida alles paigaldatud 2.2.1-ga ja uuema release'iga.

**2. Litsents** (YubiKey'ga, kui päriselt lõpetad. Testida saab ka `--key`
testvõtmega):
1. `node scripts/make-license.mjs terminate WIVO1.… --key license-test-private.pem`
2. Kontrolli väljundis kuupäevi (täna, täna + 14) ja rida, mis ütleb, millal
   Wivo hakkab ainult lugema.

**3. Pilt (`npm run dev:test`, omanikuna):**
1. Settings → Prices: nimeta mõni tüüp ümber „smile design"-iks. Õige pilt peab
   tulema kohe.
2. Klõpsa pildile ja vali mõni teine pilt. Kontrolli, et see on sama Lisa töö
   1. sammus ja kataloogi „Added" juures.
3. Vali joonikoon, siis „Automatic".
4. Dentiksis peaksid pärast uuendust „implant surgical guide", „smile design" ja
   „Crown design" näitama õigeid pilte ilma käsitsi valimata.

## Järgmised sammud (Kevin)
1. Vaata üle ja pushi `testing`.
2. Versiooni tõstmine 2.2.1-le ja release Dentiksile (`npm run release -- --clinic
   dentiks`) on eraldi samm.
3. **2.2.1 release'iga pole veel mõtet miinimumi panna,** sest 2.2.0 arvutid seda
   ei loe. Garyle öeldud taaskäivitus jääb 2.2.1 jaoks endiselt vajalikuks.
