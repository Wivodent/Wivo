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

Pilt ei leita töötüübi nime järgi (nimed on kliiniku keeles ja kliinik võib
neid muuta). Kaardistus on failis `src/renderer/src/lib/workType3dMap.ts`:
1. kitsam variant töötüübi nime või sünonüümide sõnade järgi (eesti, inglise,
   vene keeles), nt All-on-6 → `all-on-6.webp`;
2. muidu töö liigi järgi (sama liik, mille järgi valitakse joonikoon):

| Töö liik            | Pilt                   |
|---------------------|------------------------|
| Implantaadi kroon   | `crown-implant.webp`   |
| Kroon               | `crown-zirconia.webp`  |
| Sild                | `bridge.webp`          |
| Viniir, laminaat    | `veneer.webp`          |
| Inlay, onlay        | `inlay-onlay.webp`     |
| Proteez             | `denture-full.webp`    |
| All-on-X            | `all-on-4.webp`        |
| Kaitse / splint     | `night-guard.webp`     |
| Retainer            | `retainer-fixed.webp`  |
| Kirurgiline juhik   | `surgical-guide.webp`  |
| Implantaadisild, täidis, IBT | pilti pole (joonikoon) |
