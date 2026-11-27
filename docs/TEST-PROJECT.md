# Võltsandmetega testprojekt (`dev:fake`)

Oma Supabase'i projekt, kus on **ainult väljamõeldud andmed**: üks Läti labor
"Fakeville Dental Lab", kuus inimest, 40 tööd, 30 patsienti. Selle peal saab
kõike proovida, ka kahe inimesena korraga, ilma et ükski päris nimi ekraanile
tuleks. Testkoopias on päris andmed (see tehti tootmisest), seepärast on
igapäevaseks proovimiseks see projekt.

**Ühtegi parooli ega võtit käsureale.** Iga samm küsib need varjatult.
PowerShelli ajalugu on fail kettal, mida keegi ei tühjenda.

---

## Mis seal on

| Mis | Kui palju | Märkus |
|---|---|---|
| Kliinik | 1 | "Fakeville Dental Lab", riik **LV**, keel inglise |
| Inimesed | 6 | omanik, arst, disainer, tehnik, raamatupidaja, vastuvõtt (eri õigustega) |
| Töötüübid | 10 | Wivo kataloogist, **piltidega**, hindadega (sild ka mahuhinnaga) |
| Valikud | 10 | oma hindadega, nt All-on-4 → **Framework: Metal bar** 400 € (raamatukogus 600 €) |
| Mallid | 3 | Default (kliiniku etappidest), "Implant work" (inimestega), "Quick repair" |
| Tööd | 40 | igas etapis, mõned kiirtööd, mõned üle antud ja makstud, implantaaditöödel valikud valitud, igal neljandal märge |
| Patsiendid | 30 | ilmselgelt võltsnimed ("Fakey McFakeface", "Mocky Testington" …), isikukoode ei ole |
| Kliendid | 4 | kolm kliinikut ja üks eraarst |
| Arved | 5 | eri olekutes (Lätis on arved rakenduses peidus; vaata Eesti seadega) |
| Palgareeglid | 5 | üks **ainult valikuga** "Metal bar" (tehnik saab 80 €) |
| Ladu | 5 artiklit | üks aegumas, üks otsakorral |

Kontod (parool on see, mille seemne ajal valid):

| Konto | Nimi | Roll |
|---|---|---|
| `owner@fake.wivodent.com` | Olly Ownerfake | omanik, näeb kõike |
| `doctor@fake.wivodent.com` | Dr Dotty Fakesmile | arst: tööd, patsiendid, visiidid |
| `design@fake.wivodent.com` | Dana Pixelmock | disainer: tööd, ladu, etapid |
| `tech@fake.wivodent.com` | Tomas Testcrown | tehnik: tööd, ladu |
| `money@fake.wivodent.com` | Penny Payrollson | raamatupidaja: palgad, maksed (patsiente ei näe) |
| `desk@fake.wivodent.com` | Sammy Samplewell | vastuvõtt: tööd lugeda, patsiendid, failid |

Iga konto lisab esimesel sisselogimisel teise teguri (autentimisrakendus),
nagu päris kasutaja.

---

## 1. Uus projekt (üks kord)

Dashboardis, sinu kontol: **New project**.

| Väli | Väärtus |
|---|---|
| Name | `wivo-fake` |
| Region | Central EU (Frankfurt) |
| Database password | genereeri, pane paroolihaldurisse |

Kirjuta üles **Project ref** (aadressis `supabase.com/dashboard/project/<REF>`).

## 2. Kõik migratsioonid

Sama mis demo puhul: `docs/DEMO-SETUP.md` samm 2 (`fresh-schema.mjs`, siis
psql). Pärast seda on projekt tühi, aga skeem on täielik.

## 3. Võltskliinik sisse

```powershell
node scripts/seed-fake-clinic.mjs
```

Skript küsib (kõik varjatult):

1. **Connection string**: Dashboard → **Connect** → **Session pooler**. Kleebi
   (parooli võib sealt välja jätta).
2. **Database password**, kui see stringis polnud.
3. **Kontode parool** kaks korda (vähemalt 12 märki, ilma `'` ja `\`).
4. Lõpuks kirjuta **projekti id** nähtavalt kinnituseks.

Skript **keeldub** tootmisest, testkoopiast ja iga kliiniku projektist
(`clinics/*.json`) nende id järgi. SQL ise keeldub igast andmebaasist, kus on
juba mõni muu kliinik või mõni kasutaja väljaspool `@fake.wivodent.com`. Kõik
jookseb **ühe tehinguna**: kas kõik või mitte midagi. Teist korda jooksutades
ei lisandu midagi.

Lõpus näed tabelit: clinic 1, people 6, customers 4, patients 30, jobs 40,
templates 3, invoices 5, pay rules 5, stock items 5.

psql otsitakse `C:\Program Files\PostgreSQL\<uusim>\bin\psql.exe` alt; mujal
olles pane `$env:PSQL_PATH = "…\psql.exe"` (see on tee, mitte saladus).

## 4. Rakendus võltsprojekti vastu

1. Kopeeri `config/test-fake.env.example` → `config/test-fake.env` (gitis ei
   ole) ja pane sinna projekti URL ja **anon** võti (Project Settings → API).
   Mitte kunagi service_role ega secret võtit: rakendus ei käivitu siis.
2. ```powershell
   npm run dev:fake
   ```
   Akna ümber on kollane raam ja üleval **FAKE DATA**.
3. Teine inimene kõrvale (eraldi sisselogimine ja seaded):
   ```powershell
   npm run dev:fake:2
   ```

`dev:fake` on test-režiim, ainult teine aadress: kõik päringud mujale peale
selle projekti keelatakse enne saatmist, tootmine ja testkoopia keelatakse
nende id järgi, ja kaustad on omad (`%APPDATA%\wivo-test-fake`, `…-2`).

## 5. Telefon

`npm run mobile:dev` loeb `.env`-i. Võltsprojekti jaoks pane ajutiselt
`.env.local`-i sama URL ja anon võti (see fail on gitis ignoreeritud) ja ava
telefonis arvuti aadress.

## Uuesti alustada

Lihtsaim: kustuta projekt Dashboardis ja tee sammud 1–3 uuesti. Eraldi
reset-skripti ei ole, sest võltsprojektis pole midagi, mida hoida.
