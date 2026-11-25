# Töötüüpide 3D pildid

Suured pildid, mida näidatakse Lisa töö 1. sammu ruutudes, Seaded → Hinnad
kaartidel, töötüüpide kataloogis ja tühjadel lehtedel. Väikestes kohtades jääb
joonikoon. Kui pilti pole, näidatakse joonikooni.

`options/` kaustas on töötüübi valikute pildid (nt `metal-bar.webp`), mida
näidatakse valiku nupul.

## Uue pildi lisamine

1. Pane originaal (PNG, mis tahes suurus) kausta `assets-src/worktypes/3d/`
   (valiku pilt: `assets-src/worktypes/3d/options/`). Failinimi on ingliskeelne
   kebab-case ja sama mis kataloogi kirje id (valiku puhul valiku id), nt
   `crown-zirconia.png`. See kaust on `.gitignore`-is: originaale ei commitita.
2. Käivita `node scripts/optimize-worktype-images.mjs` (või ainult üks pilt:
   `node scripts/optimize-worktype-images.mjs crown-zirconia`). See teeb siia
   384×384 WebP faili (kvaliteet 85). Vaja on Python 3 ja `pip install pillow numpy`.
3. Commiti ainult `.webp` fail. Pildid pakitakse rakendusse ehitamise ajal.

Originaalid on valgel taustal ja ilma läbipaistvuseta. Skript teeb tausta
puhtaks valgeks ja lõikab pildi objekti ümber ruuduks. Tausta ei eemaldata,
sest valgel taustal valged hambad ei tule puhtalt välja. Rakendus näitab pilte
valgel ümaral alusel. Kui originaalil on juba läbipaistev taust, jääb see alles.

## Milline pilt millisele töötüübile

Iga pilt on üks töötüüpide kataloogi kirje (`shared/pricing/workTypeCatalogue.ts`,
Seaded → Hinnad → Lisa kataloogist): failinimi on kirje id. Valiku pilt
(`options/`) on kataloogi valiku id. Test (`src/renderer/src/lib/workType3d.test.ts`)
kukub, kui pildil pole kirjet või kirjel pole pilti.

Pilt ei leita töötüübi nime järgi (nimed on kliiniku keeles ja kliinik võib
neid muuta). Järjekord (`src/renderer/src/lib/workType3d.ts`):
1. kataloogist lisatud töötüüp: selle kirje pilt (`katalog`), mis nimega tahes;
2. töötüüp, mille nimi või sünonüüm on täpselt kataloogi kirje nimi mõnes
   keeles (nt „Metallkeraamiline kroon"): selle kirje pilt;
3. kitsam variant sõnade järgi eesti, vene ja inglise keeles
   (`workType3dMap.ts` `VARIANT_3D_FILES`, nt „Proteesi parandus",
   „Spordikaitse", „Бюгельный протез", All-on-6); täpsem enne üldisemat;
4. töö liigi järgi (`workType3dMap.ts`): kroon → `crown-zirconia`, sild →
   `bridge`, implantaadisild → `implant-bridge`, implantaadi kroon →
   `crown-implant`, täidis → `filling`, proteez/protees → `denture-full`,
   All-on-X → `all-on-4`, kaitse/splint/nightguard → `night-guard`, retainer →
   `retainer-fixed`, viniir ja laminaat → `veneer`, inlay ja onlay →
   `inlay-onlay`, kirurgiline juhik → `surgical-guide`; IBT: joonikoon.

Test (`workType3d.test.ts`) hoiab nimekirja nimedest, mida kliinikud oma
töötüüpidele panevad, ja millise pildi igaüks saab. Uus sünonüüm: lisa sõna
`VARIANT_3D_FILES`-i ja nimi testi.

Uue pildi jaoks lisa kataloogi kirje (või valik) sama id-ga.
