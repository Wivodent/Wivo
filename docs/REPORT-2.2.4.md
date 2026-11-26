# Wivo 2.2.4: raport

**Haru:** `testing`. Midagi pole pushitud. Andmebaasiga ei ühendunud: kõik
SQL on proovitud ainult kohalikus PGlite'is. Versioon on package.json-is
**2.2.4** ja see on viimane commit. **Migratsioonid: 131, 132, 133, 134**.
Järgmine number on 135.

**Kontrollid (viimane seis):**
- Täis testikomplekt (`npx vitest run --mode unit`): 222 faili, 2951 testi, kõik
  rohelised.
- `tsc` (web ja node): roheline.
- Build õnnestus nii arvutile (`electron-vite build`) kui telefonile
  (`vite build --config vite.mobile.config.ts`).
- Kahe aknaga käsitsi ei ole ma seda proovinud (vt „Mida Kevin kontrollib").

## Commitid

2.2.3 installer on tehtud commitist `cffabfb`. 2.2.4 on kõik, mis tuli pärast seda.

| Osa | Hash | Mis |
|---|---|---|
| Realtime publication | `4721850` | sql/131: kõik tellitud tabelid publicationisse; schema_check'i uus liik `realtime` |
| 1. Failid ja etapi inimesed | `7a212ee` | sql/132, `useRealtimeInvalidate`, tellimused `job_file` ja `job_stage_person` |
| 2. Mall ühe sammuna | `18587ba` | sql/133 `save_workflow_template`; neli eraldi päringut eemaldatud |
| 3. Väikesed asjad plokist A | `b881701` | sql/134: märkmed, etapi vaikimisi inimesed, J5; broneeringu ajad |
| Versioon | (viimane) | CHANGELOG, What's new (en, et, ru), 2.2.4 |

## 1. Failid ja etapi inimesed teises arvutis kohe

- **Tellimused.** Uus hook `useRealtimeInvalidate(table, keys)`. Igal tabelil
  on **oma kanal**. Kui kanal nimetab tabelit, mis publicationis pole, võib
  Supabase kogu kanali tagasi lükata, ja tööde nimekiri ei tohi koos sellega
  kurdiks jääda.
  - `job_file` laadib töö failid ja eelvaated uuesti. Partneri ekraanil seda
    tellimust ei ole: labori failiread pole talle loetavad, nii et teadet ei
    tuleks.
  - `job_stage_person` laadib töö etapid ja tööde nimekirja uuesti (tahvli
    palgaetapid loevad samu inimesi).
  - Lisaks laadib iga `jobs` teade uuesti ka etapiriba. Teises arvutis tehtud
    etapimuutus muudab töö staatust, aga etapiriba loetakse eraldi.
- **sql/132.** Lisab need kaks tabelit publicationisse sama idempotentse
  mustriga nagu 131. Käivita **eraldi päringuna**, pärast 131.
- **Kes mida kuuleb.** Mõlemat tabelit saab lugeda ainult oma organisatsioonis
  (`job_file_select`, `job_stage_person_select`). Partner realtime'i kaudu
  midagi ei saa. Rakendus ei loe teate sisu, vaid ainult laadib uuesti. Replica
  identity jääb primaarvõtmeks.
- **Test.** `realtimePublication.test.ts` leiab nüüd ka `useRealtimeInvalidate`
  tellimused: 17 tellitud tabelit ja 18 publicationis (`messages` sql/066-st).
  Kontrollib ka, et 132 üksi lisab ainult need kaks.

## 2. Mall ühe tehinguna (sql/133)

- **`save_workflow_template(id, name, stages, expected_updated_at)`** salvestab
  nime, etapid ja inimesed ühe kutsega. PostgREST käivitab selle ühe
  tehinguna, nii et salvestub kõik või mitte midagi.
- **`SECURITY INVOKER`:** iga lauset kontrollivad tabelite enda reeglid, nagu
  enne. Vaja on „Manage stages" õigust, oma kliinikut, oma kliiniku inimesi ja
  teist faktorit. Midagi ei laiendatud.
- **Kaitse samaaegse muutmise eest (2.2.3):** salvestatakse ainult avatud
  versiooni peale. Vastasel juhul tuleb viga `WV003` ja midagi ei kirjutata.
  Rakendus näitab bännerit „Someone else changed this while you were editing"
  ja Reload-nuppu.
- **Neli eraldi päringut on eemaldatud** (nimi, etappide kustutamine, etappide
  lisamine, inimeste lisamine). Varuvarianti vanale andmebaasile ei ole, sest
  palusid vana viisi eemaldada.
- **Testid.** `sql/test/saveTemplate.test.ts` kontrollib:
  - uut malli ja uuesti salvestamist;
  - `WV003` juhtu;
  - **tõrget poole pealt:** kolmas etapp lükatakse tagasi, ja vanad etapid
    jäävad alles;
  - teise kliiniku inimest, õiguse puudumist, teist kliinikut, välja logitud
    kasutajat ja kliinikuta kasutajat.

  `lib/saveTemplate.test.ts` kontrollib, et tehakse üks kutse ja ükski tabel
  ei saa otse kirjutust.

## 3. Mida valisin ploki A järgmistest asjadest

ROADMAP-2.5 järgi on 2.2.4 teema „ühe sammu salvestused": märkmed RPC kaudu,
mall ühe tehinguna, etapi vaikimisi inimesed samamoodi, ja J5. Tegin need kõik.
Lisaks tegin STATUS-e nimekirjast #11. Ükski neist ei vaja sinu otsust.

**sql/134 ja rakenduse muudatused:**

| Mis | Kuidas |
|---|---|
| **Märkmed** (STATUS #4) | `add_job_note` lisab ja `remove_job_note` eemaldab märkme, kumbki **ühe UPDATE-iga rea luku all**. Märkme id ja aeg tulevad andmebaasist. Märkmete paneel ei loe enam nimekirja ega kirjuta seda tagasi. `SECURITY INVOKER`: otsustab `jobs_update` (Edit jobs, oma kliinik, kustutamata töö), triggerid töötavad nagu enne. |
| **Etapi vaikimisi inimesed** (STATUS #10) | `save_stage_default` kustutab ja lisab ühe kutsega. **Leidsin testis vea:** ilma „Manage stages" õiguseta laskis RLS kustutamisel mitte midagi leida ja tühi lisamine läks läbi, nii et ekraan arvas, et salvestas. Nüüd lükkab funktsioon selle selgelt tagasi. |
| **J5** (BACKLOG turvakontroll 3) | `jobs.template_id` ei saa pärast töö loomist muuta (`guard_job_template`, sama muster nagu `guard_job_orderer`). SQL Editor ja teenusfunktsioonid ilma kasutajata jäävad vabaks. Rakendus ise seda välja ei muuda. |
| **Veebibroneeringu ajad** (STATUS #11, migratsioonita) | Liidetakse sellega, mida teine omanik vahepeal salvestas (`merge3`), ja kirjutatakse ainult rea `updated_at` peale. Eri päevad jäävad mõlemad alles. Sama päev mõlemalt: midagi ei kirjutata, tuleb bänner ja Reload. |

**Testid:** `sql/test/oneStepSaves.test.ts` kontrollib:
- kaks samaaegset märget jäävad mõlemad alles;
- eemaldamine hoiab järjekorra;
- tagasilükkamised ei kirjuta midagi;
- vaikimisi inimesed asendatakse tervikuna ega jää kunagi pooleldi tühjaks;
- õiguseta salvestus lükatakse tagasi;
- J5.

`merge3` sai lisaks testi broneeringu aegade kohta.

**Mida ma ei teinud ja miks:**
- **2.2.5 (SEC1, SEC3, SEC4):** need oleneb turvaülevaatest, mille alustad sina.
- **PH5 (telefoni CSP):** iga kliiniku telefonirakendusel on alates osast B oma
  aadress ja oma Supabase projekt, aga `_headers` on üks fail kolmele Pages
  projektile. Õige `connect-src` tähendaks iga buildi jaoks oma väärtust. Vale
  poliitika lõhub rakenduse deploy'l ja seda saab proovida ainult brauseris
  deploy'tud koopia peal (RUN-2 §6). Jätan selle sulle või hilisemaks, kui
  build kirjutab `_headers`'i kliiniku kaupa.
- **2.2.6 (F6, failid ainult `file-link` kaudu):** esmalt tuleb tõsta
  miinimumversiooni ja see on väljalaske otsus.
- **2.2.7–2.2.8:** need on suured (L).

## Mida Kevin kontrollib

1. **Migratsioonid test-koopias, järjekorras:**
   1. 131 eraldi päringuna;
   2. 132 eraldi päringuna;
   3. 133;
   4. 134;
   5. `notify pgrst, 'reload schema';`;
   6. `schema_check.sql` ja `trigger_check.sql`: ükski rida ei tohi tulla, ka
      liik `realtime` mitte.
2. **Kaks akent** (`npm run dev:test` ja `npm run dev:test:2`, mõlemas uus
   sisselogimine koos koodiga):
   - lisa ühes aknas tööle fail, see peab teises ilmuma ilma uuesti avamata;
   - muuda etapi inimesi;
   - lisa mõlemas peaaegu korraga märge, mõlemad peavad jääma;
   - salvesta sama mall mõlemas, teine peab saama bänneri;
   - muuda etapi vaikimisi inimesi;
   - broneeringu ajad: eri päev mõlemas aknas, siis sama päev.
3. **Järjekord Riias** (RELEASE.md §5): **andmebaas enne rakendust**.
   `npm run release -- --clinic dentiks` näitab uusi migratsioone 131–134 ja
   `release:sign` küsib kinnitust.
   - Kui 2.2.4 jõuab arvutisse enne 133 ja 134, ei saa salvestada malli, etapi
     vaikimisi inimesi ega märget. Ekraan ütleb siis neutraalselt „not
     available yet".
   - Kui puudub 131 või 132, jääb realtime vaikseks (nagu testkoopias oli).
