# Töötüüpide 3D illustratsioonid

Suured pildid, mida näidatakse Lisa töö 1. sammu ruutudes, Seaded → Hinnad
kaartidel ja tühjadel lehtedel. Väikestes kohtades jääb joonikoon. Kui pilti
pole, näidatakse joonikooni, nii et midagi katki ei lähe.

Failinimed on **ingliskeelsed, kebab-case**. Pilt ei leita töötüübi nime
järgi (nimed on kliiniku keeles ja kliinik võib neid muuta), vaid töö liigi
järgi. Kaardistus on failis `src/renderer/src/lib/workType3dMap.ts`.

| Töö liik                | Failinimi                |
|-------------------------|--------------------------|
| Implantaadi kroon       | `implant-crown.png`      |
| Implantaadisild         | `implant-bridge.png`     |
| Kroon                   | `crown.png`              |
| Sild                    | `bridge.png`             |
| Viniir                  | `veneer.png`             |
| Laminaat                | `laminate.png`           |
| Inlay                   | `inlay.png`              |
| Onlay                   | `onlay.png`              |
| Täidis                  | `filling.png`            |
| Proteez                 | `denture.png`            |
| All-on-X                | `all-on-x.png`           |
| Kaitse / splint         | `night-guard.png`        |
| Retainer                | `retainer.png`           |
| IBT                     | `ibt.png`                |
| Kirurgiline juhik       | `surgical-guide.png`     |

Kitsamad liigid, mis kontrollitakse enne (kui faili pole, kasutatakse liigi
pilti):

| Variant          | Failinimi            | Liigi pilt, kui faili pole |
|------------------|----------------------|----------------------------|
| All-on-4         | `all-on-4.png`       | `all-on-x.png`             |
| All-on-6         | `all-on-6.png`       | `all-on-x.png`             |
| Titaanvõrk       | `titanium-mesh.png`  | joonikoon                  |

Uue variandi jaoks lisa üks rida `VARIANT_3D_FILES` loendisse.

Reeglid:
- Vorming: `.png`, läbipaistva taustaga, täpselt tabeli failinimega
- Ruut, vähemalt 512×512 px
- Pildid pakitakse rakendusse ehitamise ajal: uus pilt vajab uut buildi
  (dev-serveris piisab salvestamisest)
- Kui töötüübile on oma pilt kinnitatud (töötüübi väli `pilt`), on see
  Hindade kaardil eespool
