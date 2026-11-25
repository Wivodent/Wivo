# Öine töö 2026-11-24/25: Wivo 2.1.0 (Dentiks)

Haru: `testing`. Midagi ei pushitud, haru ei vahetatud, ühegi andmebaasiga ei
ühendutud, release/sign/publish skripte ei käivitatud. Iga osa on eraldi commit.
Ühtegi osa ei tulnud revertida.

**Hommikul kõigepealt (enne Dentiksi release'i):**

1. **`VITE_WIVO_CONTACT_EMAIL`** lisa faili `clinics/dentiks.env` (Wivo aadress,
   kuhu "Request a feature", "Contact Wivo" ja "Ask Wivo" kirjutavad). Ilma
   selleta neid nuppe ei näidata. Ma ei teadnud sinu aadressi ega mõelnud seda
   välja (`src/renderer/src/config/contact.ts`).
2. **Migratsioon `sql/127_profile_latvian_tax.sql`**: jooksuta testkoopias SQL
   Editoris, siis eraldi `notify pgrst, 'reload schema';`. Dentiksi projekti
   jõuab see allkirjastatud paketiga (`wivo-update`), nagu CLAUDE.md ütleb.
   Kood töötab ka ilma: ülalpeetavad = 0, pensionär = ei, ja nende salvestamine
   ütleb neutraalselt "pole veel saadaval". Maksuraamat töötab kohe (kasutab
   olemasolevat `maksuvaba_tulu` välja).
3. Release tavapäraselt: `npm run release -- --clinic dentiks` (docs/RELEASE.md).
   Versioon on `package.json`-is juba 2.1.0.

---

## Osade staatus

| Osa | Staatus | Commit |
|---|---|---|
| 1.1 Fookus kaob lahtrist | valmis | `39ccfade374c99fc116afc3240aa5fc9195eac3b` |
| 1.2 Moodulipõhised nupud ja menüü | valmis | `7d4f8abcf0cdc3b1800cc6a55a45fac52d7ce4f2` |
| 1.3 Arendajatekst Prices lehelt | valmis | `b1e0a760f0c4fa9069a5d08de702a1aa846c4f88` |
| 1.4 Email: kliiniku keel ja nimi, peitmine | valmis | `ad6fa97d2339bdaa2353bfa78aae5ca969a22337` |
| 1.5 → asendatud Läti palgamaksudega | valmis | `b575839ba9d731b6fc3827db954293451b8f9956` |
| 1.6 Eesti keel / Eesti asjad mujal | valmis (vt allpool, mis jäi) | `48ea7c7d9d5ae5bb4e2289cfccae25729c4949d8` |
| 2 Lisa töö → Production | valmis (vt otsused) | `805fe9ab4e5d600082a9130473843a3971c2bbdd` |
| 3 Lisa töö → Patient and order | valmis (vt otsused) | `6de71199caea71a3e8113e7a005e47b1f43902fc` |
| 4 Settings → Prices | valmis | `de760634c93806577b610f2503321d594839e965` |
| 5 Payroll inimese leht | valmis | `f2bb7bef0b3fa5261127c92cfce54036e759344f` |
| 6 Settings → Job stages | valmis | `1ead234da511393e13d5b1309394901c593cd10e` |
| 7 Settings avaleht + "Set up your clinic" | valmis | `f2284a0c3a526cd0dda272c9ef8151da55c2ca70` |
| 8.1 Request a feature (mailto) | valmis, sama commit kui 7 | `f2284a0c3a526cd0dda272c9ef8151da55c2ca70` |
| 8.2 "Unsorted" | valmis | `88f827720dd5cb76789360b9c6943da90bf82475` |
| Ikoonid: üks komplekt | valmis | `e208919a1cc4b08db7bf23efa838142226b8bd56` |
| 9 Puhastus-SQL | valmis (vt riskid) | `de2e079889c742ba687f379bca4a417072e55a8d` |
| 9 ROADMAP + WORKTYPE-OPTIONS-PLAN | valmis | `c4586c58349aac59abc59c72d9c97e0653a1d40c` |
| 9 Versioon 2.1.0 + What's new | valmis | `b3b0693b45c884b243d51ca97fa4440931fe1312` |
| 9 See raport | valmis | järgmine commit pärast versioonitõusu |

---

## Latvia payroll

Üks reeglifail riikide kaupa ja aasta järgi: `shared/payroll/countryTax.ts`
(`LATVIA_RULES[2026]`). Eesti on endine loogika muutmata kujul (kliiniku
seadetes olevad määrad); Eesti testid ei muutunud.

- Läti 2026: töötaja VSAOI 10.5%, tööandja 23.59%; pensionär 9.25% / 20.77%;
  tulumaks 25.5% (maksustatav = bruto − töötaja VSAOI − 550 €, kui maksuraamat
  on meie juures − 250 € iga ülalpeetava kohta, mitte alla 0); kui bruto < 780 €,
  arvutatakse VSAOI 780 € pealt ja hinnangus on selle kohta märkus.
- **Kontrolltest** (`shared/payroll/countryTax.test.ts`, roheline): bruto 2000,
  maksuraamat jah, 1 ülalpeetav → töötaja VSAOI **210.00**, maksustatav 990.00,
  tulumaks **252.45**, neto **1537.55**, tööandja VSAOI 471.80, kulu kliinikule
  **2471.80**.
- Payroll → inimene → **More settings → Tax profile (Latvia)**: "Tax booklet with
  us" (jah/ei), "Dependents" (−/+), "Pensioner" (jah/ei). Eesti väljad (II sammas,
  töötuskindlustus, neto-kokkulepe) Lätis ei paista.
- Palgalehe hinnang (paremal küljel) Läti määradega, all tekst *"Estimate based
  on Latvian rates 2026. Not an accounting payslip."*
- Kliiniku kulu: Payroll ülevaade (inimese kaupa, pensionär ja miinimumpalk
  arvesse võetud), Finance ja Statistics (23.59%, ilma inimesepõhiste
  erisusteta), Settings → Taxes näitab Läti määrasid ainult lugemiseks.
- Muud riigid peale EE ja LV: maksuprofiil ja hinnang peidus, ainult bruto.
- Andmed: `ulalpeetavad` ja `pensionar` tulevad sql/127-ga, peidetud kolleegide
  eest nagu sql/117 (`pay_settings()` tagastab need). Töötaja seadete JSON-it
  profiilil ei ole; `profiles.ui_prefs` on kõigile kliiniku liikmetele loetav,
  seega sinna neid panna ei saanud.
- Ei ole tehtud: 33% tulumaksuastet üle 8775 €/kuus ega raamatupidaja ekspordi
  Läti välju (ROADMAP-is).

---

## Mida Kevin peab hommikul käsitsi kontrollima (klikkidena)

Testkoopias (`npm run dev:test`), omanikuna, kliinik Lätis, kui saad (muidu Eestis):

1. **Settings** → avaneb ruutudega leht "What do you want to change?". Üleval
   kaart "Set up your clinic": kas tehtud/tegemata märgid vastavad tõele? Vajuta
   "Hide" → kaart kaob; all "Show the setup list" toob tagasi.
2. "Phones for staff" → **How to** → aknas õige telefoni aadress (Dentiksis
   wivo.dentiks.lv) ja kolm sammu. Esc ja klõps väljapoole sulgevad.
3. **Work types & prices** → mõni kaart → **Our cost** → "+ Add cost" → kirjuta
   nimesse "Abutment": kursor jääb lahtrisse. Tab → summa → Enter. Tee sama
   "Volume price" → "+ Add" ridadega ja "Full price" lahtris (proovi "12.5").
4. **‹ Settings** → **Clinic details** → kirjuta kliiniku nimesse: fookus ei
   kao (oli sama viga). All "Advanced" → Audit log / Database / Partnerships.
5. **Taxes** → Lätis: Läti määrad tekstina; Eestis: endised Eesti lahtrid.
6. **Stages & templates** → viis nummerdatud kaarti; 5 "Partner moves" on
   kokkuvolditud ja ainult partnerlusmooduliga.
7. Ülemine riba: WivoLab režiimis **ei ole "New visit"** nuppu.
8. **New job** → samm 4 (Production): kaardid tööüksuste kaupa, masin igal
   kaardil, tehnik ja disainer kaartide kohal; "i" nupud; "Print and design
   numbers" kokkuvolditud. Samm 5: kaks kasti + "Notes for the job"; ilma
   patsiendita ei lase edasi (nagu enne).
9. **Payroll** → ava inimene: üleval kolm ruutu ja "Confirm payout"; maksmata
   read; palgareeglid; **More settings** (töösuhe, maksuprofiil, kiirtöö
   kordaja, tunnid); paremal hinnang. Lätis: maksuraamat jah/ei muudab hinnangut.
   Enne sql/127 annab "Dependents +" teate "pole veel saadaval".
10. Lätis: **Email** ruutu ja menüüd ei ole (arved on Eesti dokumendid).
11. Külgmenüü: "Scanner files" (oli "Unsorted"), "i" pealkirja kõrval.
12. Töö kaart tahvlil: makstud töö "€" kõrval SVG linnuke (oli emoji).
13. "What's new" aken avaneb versiooniga 2.1.0 (inglise, eesti, vene keeles).
14. Telefon (`npm run mobile:dev`): avaleht, töö avamine, etapi liigutamine.

---

## Otsused, mis tegin ise

- **1.1:** salvestus oli juba 400 ms viitega koondatud; fookuse kao põhjus oli
  React-võti (nimi/väärtus võtmes) ja kliiniku andmete `Field` komponent, mis
  defineeriti renderi sees. Parandasin mõlemad ja lisasin `DraftInput`
  (kohalik tekst, salvestus blur/Enter peale) hinnakaardi lahtritesse.
  Payroll ja etapimallid kasutasid juba mustandit, seal viga polnud.
- **1.2:** "New visit" ainult kliinilise režiimi + kalendrimooduli +
  visiidiõigusega; Requests ainult kliinilises režiimis; Settings grupid
  mooduli järgi (Patient price list, Email, Partnerships, Job stages, Options,
  Machines). Overview "Open calendar" / "See all jobs" ainult, kui leht avaneb.
- **1.4:** puutumata (vaikimisi) arvekiri vahetatakse omaniku avamisel kliiniku
  keelseks (en/et/ru); muudetud kirja ei puututa. Edge Functioni tagavaratekst
  (eesti) jäi muutmata. Email peidus ka siis, kui riik pole Eesti.
- **1.6:** uue töö kirjelduse read ("Glasuur:", "Märkus:" …) kirjutatakse
  nüüd töö lisaja keeles; vanad tööd jäävad. Näidistekstid (Tallinn, +372,
  EE…, OÜ) riigi järgi (Lätis Rīga, +371, LV…).
- **2:** andmemudelis on masin tööüksuse kohta, aga tehnik ja disainer kogu
  töö kohta. Seega on kaardil töö nimi, hambad ja masin; tehnik ja disainer on
  üks rida kaartide kohal (mitte igal kaardil, mis lubaks midagi, mida töö ei
  salvesta). "Framework" valikud jäid välja (plaan: WORKTYPE-OPTIONS-PLAN.md).
- **3:** kujunduse lüliti "Our clinic / Another clinic / Dentist" ei vasta
  ühelegi andmeväljale, jäi välja. "Ordered by" = klient + kliendi viitenumber.
- **4:** "Set image file" lahter asendus all ribal "Ask Wivo" lingiga;
  olemasolevad pildid jäävad. Marginaali numbrit kaardile ei lisanud (uus
  arvutus). Ülejäänud hinnaseaded on "More price settings" all.
- **5:** "Mark as paid" = olemasolev "Confirm payout" (loogika sama).
- **6:** etappide järjekord muutub nooltega (lohistamist pole); reanupud on
  nüüd alati nähtavad.
- **7:** vasak menüü asendus avalehega; "Taxes" on uus leht (riik + maksud,
  tõstetud Prices alt); "Team & roles" ja "Pay rules" viivad Team ja Payroll
  lehele. Litsentsi bännerid avavad Licence lehe. Kontroll-leht ainult
  olemasolevatest andmetest; "peidetud" on selle arvuti valik (localStorage).
  Jobs lehele kontroll-lehte ei lisanud (ülesanne lubas "Settings ülaosas").
- **8.1:** e-kirja tekstis palve mitte kirjutada patsiendi andmeid.
- **8.2:** "Unsorted" = skanneri ekspordikausta failid, mis pole veel ühegi
  tööga seotud (lauaarvutis). Nimi ei öelnud seda, nüüd "Scanner files" + "i".
- **Ikoonid:** lucide-react oli olemas; emojid (✓ ✎ ⛓ 🔩) asendatud. PNG-ikoone
  nuppudes ei olnud. Töötüüpide pildid jäid nagu olid.
- **"i" nupud:** wizardi senine põhimõte oli "abi alati nähtaval"; sinu uus
  juhis ütleb "pikad selgitused i taha", seega `InfoButton` (klõpsuga, mitte
  hõljumisega).

## Riskid ja mis jäi

- **Puhastus-SQL vs CLAUDE.md:** reegel ütleb, et kliiniku projekt muutub ainult
  allkirjastatud uuendustega või seadistustööriistaga. Skript on sinu tellitud ja
  käsitsi käivitatav, aga see on erand: otsusta ise. Osa 2 peatub, kui org pole
  Dentiks. **Auditilogi ei kustu** (on append-only ka SQL Editoris, sql/114/115);
  testtööde kohta jäävad read (töö kood ja id, mitte patsiendi nimi). Üles
  laaditud failid tuleb kustutada Storage'ist käsitsi (osa 1 loeb need kokku).
  Skripti test: `sql/test/dentiksCleanup.test.ts` (teine kliinik jääb puutumata).
- **Settingsi navigeerimine muutus täielikult.** Turvateade avab endiselt
  Security; kontrolli, et töötaja (mitte omanik) näeb "My settings" ruute.
- **Hinnalahtrid salvestuvad blur/Enter peale**, mitte iga tähe järel.
- **Läti tööandja maks Finance/Statistics-is** on ühtne 23.59% (pensionär ja
  miinimumpalk ainult Payrollis).
- `MachinePicker.tsx` ei ole enam kasutusel (jätsin alles).
- Öise töö reeglite faili `docs/night-run/INSTRUCTIONS.md` repos ei ole;
  `docs/design` kausta ka mitte (kujundused tulid vestlusse), seega midagi
  sellest ei commititud.
- 10:00 tähtaeg: kõik on `testing`-us; release ja `riga` pointer on sinu teha.

## Kontrollid

- `tsc` (web ja node): rohelised (lähteseisus samuti).
- Seotud testid pärast iga osa: rohelised.
- Desktop build (`electron-vite build`) ja telefoni build
  (`vite build --config vite.mobile.config.ts`): õnnestusid, release'i ei tehtud.
- Täis testikomplekt: kõik jälgitud testifailid rohelised, ükski ei kukkunud. Ühes jooksus (`npx vitest run --mode unit`) jäi vitest pärast 138 läbitud faili kinni; algne jooks enne muudatusi jäi samamoodi kinni, nii et see ei ole öiste muudatuste viga. Ülejäänud 119 faili (sh mobile ja i18n testid) jooksid 20-kaupa eraldi: 119 faili, 1423 testi, kõik rohelised. Vitesti kinnijäämine täisjooksus tasub eraldi uurida.

## Lisa: testijooksu kinnijäämine ja töötüüpide 3D pildid

**Täis testijooks jäi kinni (parandatud, `f62b9e7`).** Põhjus ei olnud ükski
test, vaid Vite 5.4.21 viga. `scripts/yubikey/setup-plan.test.mjs` laeb
`scripts/yubikey/load-release.mjs`. Selles on `import()` `data:` aadressiga, mida
Vite ei oska analüüsida, ja Vite teeb selle kohta hoiatuse. Hoiatuse koodilõigu
koostaja (`generateCodeFrame`) jääb lõpmatusse tsüklisse, kui failis on CRLF
reavahetused (Windowsi töökoopias `text=auto` tõttu) ja `import()` on faili
lõpu lähedal. Vitesti põhiprotsess jäi 100% protsessoriga ringi käima ning
workerid ootasid. Mitu faili enne seda läbi sai, sõltus ajastusest (64, 89, 138).
Leidsin selle, kui peatasin protsessi Node inspectoriga.

Parandus on `/* @vite-ignore */` kommentaar selles `import()`-is. Lisasin selle
ka kahte teise sama mustriga skripti (`scripts/release-lib.mjs`,
`scripts/publish-licence.mjs`). Vite ei tee siis hoiatust ja Node ignoreerib
kommentaari, nii et skriptid töötavad täpselt nagu enne. Rakenduse koodi ei
muudetud. Teine võimalus oleks uuendada Vite't (uuemates versioonides on
`generateCodeFrame` parandatud), aga seda ma ei teinud.

Parandus raporti eelmisele lõigule: seal oli kirjas, et kõik testifailid on
rohelised. `.mjs` testid jäid sealt aga välja ja `setup-plan.test.mjs` ei
jõudnudki kunagi käia, sest just see jäi kinni. Nüüd jookseb täiskomplekt ühe
korraga, umbes 24 sekundiga: 202 faili, 2676 testi, kõik rohelised. Ka
`tsc` (web ja node) on roheline.

**Töötüüpide 3D illustratsioonid (`f21d88f`, `5a37bbd`).** Ühtegi pilti ei lisatud.
- Pildid lähevad kausta `src/renderer/src/assets/worktypes/3d/`, ingliskeelsete
  kebab-case nimedega. Kausta README-s on failinimede tabel.
- Kaardistus on failis `src/renderer/src/lib/workType3dMap.ts`. Pilt ei leita
  nime järgi, vaid töö liigi järgi (sama `workKindFor`, mis valib joonikooni ja
  loeb nime ning sünonüüme eesti, inglise ja vene keeles). Enne liiki
  kontrollitakse kitsamaid variante: All-on-4, All-on-6 ja titaanvõrk.
  Kui faili pole, langeb variant tagasi liigi pildile ja liik joonikoonile.
- Suur pilt on Lisa töö 1. sammu ruutudes (kast kasvab 56 px pealt 96 px
  peale), Hindade kaartidel ja tühjadel lehtedel: tööde tabel, Hinnad, kui
  töötüüpe pole või otsing ei leia midagi, ja 1. sammu otsing.
  Väikesed kohad on samad mis enne.
- Hindade kaardil on järjekord: töötüübile kinnitatud oma pilt (`pilt`), siis
  3D pilt, siis senine nime järgi leitud foto, siis joonikoon. Joonikoon
  asendab senist üldist pildiikooni.
- Muutus, mis on näha juba enne piltide lisamist: tühjadel lehtedel on nüüd
  krooni joonikoon teksti kohal.
- Test: `src/renderer/src/lib/workType3d.test.ts`. Muuhulgas kukub see, kui
  kausta pannakse pilt, mida kaardistus ei nimeta, sest selline pilt ei ilmuks
  kuskil.
