# Töö tüüpide pildid

Pane siia iga töö tüübi pilt. Failinimi peab olema **töö tüübi nimi väiketähtedes**,
täpitähed asendatud ja tühikud sidekriipsuga — sama reegel, mida rakendus kasutab
pildi otsimiseks.

| Töö tüüp             | Failinimi                |
|----------------------|--------------------------|
| Kroon                | `kroon.png`              |
| Abutmendile kroon    | `abutmendile-kroon.png`  |
| Implantkroon         | `implantkroon.png`       |
| Sild                 | `sild.png`               |
| Viniir               | `viniir.png`             |
| Laminaat             | `laminaat.png`           |
| Inlay                | `inlay.png`              |
| Onlay                | `onlay.png`              |
| Täidis               | `taidis.png`             |
| Proteez              | `proteez.png`            |
| All-on-X             | `all-on-x.png`           |
| Allon4               | `allon4.png`             |
| Kaitse / splint      | `kaitse-splint.png`      |
| Retainer             | `retainer.png`           |
| Disain               | `disain.png`             |

Reeglid:
- Lubatud vormingud: `.png`, `.jpg`, `.jpeg`, `.webp`, `.svg`
- Soovituslik suurus: ruut, vähemalt 400×400 px
- Faili puudumisel näidatakse töö tüübi värviga täidetud kohatäidet — midagi katki ei lähe
- Pildid pakitakse rakendusse ehitamise ajal, seega **uue pildi lisamisel tuleb
  rakendus uuesti käivitada** (dev-serveris piisab salvestamisest)

Nime saab ka käsitsi üle kirjutada: Seaded → Hinnad → töö tüübi kaardil "Pildi fail".

Uue töö vormi tööliikide kaardid neid pilte ei kasuta: seal on oma joonised
(`components/NewJobWizard/jobtype/WorkKindIcon.tsx`, 15 tööliiki). Pildid on
endiselt töö kaardil ja Seadetes.
