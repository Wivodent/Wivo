# Wivo Network: seadistamine samm-sammult (Kevinile)

Mis see on ja miks: docs/PLAN-NETWORK-1.md. Tellimuse vorming:
docs/WIVO-ORDER-FORMAT.md. **Kõik siin on veel tegemata** (2026-11-27 öösel
kirjutatud, ainult failid).

> **Parool ega võti ei lähe käsureale.** Iga samm, mis vajab saladust,
> kasutab varjatud sisestust või faili, mis pärast kustutatakse.
> Iga `supabase` käsk saab `--project-ref`. `supabase link` mitte kunagi.

**Järjekord:** A (Network, üks kord) → enne proovi kõike B ja C
võltsprojektis (docs/TEST-PROJECT.md) → alles siis Dentiks.

---

## A. Networki projekt (üks kord)

### A1. Uus projekt

Dashboard → **New project**:

| Väli | Väärtus |
|---|---|
| Name | `wivo-network` |
| Region | Central EU (Frankfurt) |
| Database password | genereeri, paroolihaldurisse |

Pane kirja **ref** (`<NETWORK_REF>`), **URL** ja **anon key**
(Project Settings → API).

### A2. Sisselogimine ja teine tegur

Dashboard → Authentication:

1. **Sign In / Providers → Email**: sees; **Confirm email**: sees.
2. **Multi-Factor → TOTP**: **Enabled** (ilma selleta ei anna Network
   ühtegi tõendit: kõik nõuab teist tegurit).
3. **URL Configuration → Site URL**: `https://app.wivodent.com/network`;
   **Redirect URLs** lisa `https://wivo.dentiks.lv/network` ja iga teise
   kliiniku telefoniaadress `/network`-iga.
4. Password: minimaalne pikkus **12**, "Leaked password protection" sees.

### A3. Migratsioon

SQL Editor (Networki projektis!) → kleebi `network/sql/001_network.sql` →
Run. Siis eraldi päringuna:

```sql
notify pgrst, 'reload schema';
```

Kontroll (ainult lugemine):

```sql
select tablename, rowsecurity from pg_tables where schemaname = 'public' order by 1;
-- account | t, clinic | t, connection | t
```

### A4. Allkirjavõti

PowerShellis, repo kaustast. Kaust peab olema **väljaspool repot**:

```powershell
node network/scripts/make-network-key.mjs "$env:USERPROFILE\Documents"
```

Tekib kaks faili:
- `network-signing.env` — **privaatvõti**. Ainult järgmise sammu jaoks,
  siis kustuta.
- `network-public-key.txt` — avalik võti (43 märki). Seda annad igale
  kliinikule (samm B4). Avalik: seda võib hoida ja jagada.

### A5. Saladus ja funktsioon

```powershell
npx supabase secrets set --project-ref <NETWORK_REF> --env-file "$env:USERPROFILE\Documents\network-signing.env"
Remove-Item "$env:USERPROFILE\Documents\network-signing.env"
npx supabase functions deploy network-token --project-ref <NETWORK_REF> --workdir network
```

`--workdir network`: funktsioon on kaustas `network/functions/network-token`
(Supabase CLI otsib `<workdir>/supabase/functions` või `<workdir>/functions`
sõltuvalt versioonist; kui CLI ei leia, kopeeri `network/functions` ajutiselt
kausta `network/supabase/functions` ja jooksuta uuesti — **mitte kunagi
kliiniku `supabase/` kausta**).

Kontroll: Dashboard → Edge Functions → `network-token` on olemas, JWT
kontroll **sees** (vaikimisi).

### A6. Kliinik kataloogi

Iga kliinik, kes tellimusi Networki kaudu vastu võtab, saab rea. SQL Editor
(Networki projektis):

```sql
insert into public.clinic (name, country, city, api_url, listed)
values ('Dentiks', 'LV', 'Rīga', 'https://<KLIINIKU_REF>.supabase.co', false)
returning id, invite_code;
```

- `id` → **kliiniku Networki number** (samm B4).
- `invite_code` → kutse link: `https://wivo.dentiks.lv/network/join/<invite_code>`.
- `listed = true` ainult siis, kui kliinik tahab, et teda kataloogist
  leitaks (Gary otsus).

### A7. Telefonirakendus teab Networki

Cloudflare Pages → iga projekt (`wivo`, `wivo-test`, `wivo-dentiks`) →
Settings → Environment variables (Production):

| Nimi | Väärtus |
|---|---|
| `VITE_NETWORK_URL` | `https://<NETWORK_REF>.supabase.co` |
| `VITE_NETWORK_ANON_KEY` | Networki anon key |

Mõlemad on avalikud. Järgmine build võtab need. Ilma nendeta ütleb
`/network` "not set up".

---

## B. Kliiniku pool (iga kliinik; enne võltsprojekt, siis Dentiks)

### B1. Migratsioon 138

**Pärast 136 ja 137** (vt docs/NIGHT-REPORT-2026-11-27.md järjekorda).
SQL Editor → `sql/138_network_portal.sql` → Run; siis eraldi:

```sql
notify pgrst, 'reload schema';
```

Dentiksi projekti jõuab see allkirjastatud paketiga / sinu käsitsi
jooksutusega nagu teised (RELEASE.md §5).

Kontroll:

```sql
select has_function_privilege('authenticated', 'public.client_orders(text)', 'execute');  -- false
select count(*) from public.network_settings;                                             -- 0
```

### B2. Funktsioonid

```powershell
npx supabase functions deploy network-client --no-verify-jwt --project-ref <KLIINIKU_REF>
npx supabase functions deploy file-link --project-ref <KLIINIKU_REF>
```

`network-client` vajab ainult platvormi enda muutujaid (URL, teenusevõti).
Uut saladust ei ole.

### B3. Litsents

Kliiniku litsentsi moodulitesse lisa `portal`
(`scripts/make-license.mjs … --modules jobs,payroll,stock,portal`, docs/MODULES-AND-RATINGS.md).
Ilma selleta pole menüüs "Orders" (arendusrežiimis ja telefonis on kõik
moodulid sees, aga andmebaasis on tellimused ikka väljas, kuni omanik
lülitab).

### B4. Omanik lülitab sisse

Wivo (desktop) → külgmenüü **Orders** → kaart **Wivo Network**:

1. linnuke **Take orders through Wivo Network**;
2. **Network key** = `network-public-key.txt` sisu (43 märki);
3. **Your clinic's Network number** = samm A6 `id`;
4. **Save**.

Välja lülitades lõpevad kõik klientide sessioonid kohe.

---

## C. Proovimine (võltsprojektis, kaks akent)

1. Telefon/brauser: `https://<telefoniaadress>/network` → **Create account**
   (mõni sinu enda aadress) → e-kirja link → sisse → QR autentimisrakendusse
   → profiil (Tehnik, nimi "Tess Fake").
2. **Find a clinic** (kui `listed`) või ava kutse link → **Ask to connect**.
3. Wivo (`npm run dev:fake`, omanik) → **Orders**: üleval "Asking to connect"
   → vali **Clients** → linnukesed → **Confirm**. Clients nimekirjas on uus
   klient.
4. Telefonis: kliinik → **Check again** → **New order**: töötüüp, hambad,
   valik (All-on-4 → Framework: Metal bar), viide "CASE-1", fail → **Send**.
5. Wivo: menüüs sinine märk, kellukeses "A new order from outside". Ava
   tellimus → fail alla → kirjuta sõnum → **Accept: make the job** (mall).
   Tahvlile tekib töö, patsiendiks "CASE-1", failid töö juures.
6. Telefonis: tellimus "In progress", sõnum näha. Liiguta töö viimasesse
   etappi → "Ready"; saada teele → "Sent".
7. Teine tellimus → Wivos **Reject** põhjusega → telefonis "Rejected" ja
   põhjus.
8. Wivo → Orders → Connected → **End** → telefonis järgmine samm ütleb
   "signed out of this clinic"; uuesti küsides tuleb uus soov.

## Mida Network kunagi ei hoia

Tellimusi, faile, sõnumeid, hindu, patsiente. Ainult kontod, profiilid,
kataloog ja ühenduste olekud (PLAN-NETWORK-1.md, N1). Kontrolli: Networki
projektis on täpselt kolm tabelit.
