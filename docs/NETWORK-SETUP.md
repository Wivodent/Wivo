# Wivo Network: seadistamine samm-sammult (Kevinile)

Mis see on ja miks: docs/PLAN-NETWORK-1.md. Tellimuse vorming:
docs/WIVO-ORDER-FORMAT.md. **Kõik siin on veel tegemata** (2026-11-27 öösel
kirjutatud, ainult failid).

> **Parool ega võti ei lähe käsureale.** Iga samm, mis vajab saladust,
> kasutab varjatud sisestust või faili, mis pärast kustutatakse.
> Iga `supabase` käsk saab `--project-ref`. `supabase link` mitte kunagi.

**Järjekord:** A (Network, üks kord) → enne proovi B ja C võltsprojektis
(docs/TEST-PROJECT.md) → alles siis Dentiks. Kliiniku ühendamine (B) on üks
käsk: `npm run network:connect -- --clinic <id>`.

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
3. **URL Configuration → Site URL**: `https://app.wivodent.com/network`.
   Kliinikute telefoniaadressid (`https://wivo.dentiks.lv/network` jne) lisab
   **Redirect URLs** alla ühendamise käsk ise (B2, samm e).
4. Password: minimaalne pikkus **12**, "Leaked password protection" sees.

### A3. Migratsioon

SQL Editor (Networki projektis!) → kleebi `network/sql/001_network.sql` →
Run; siis samamoodi `network/sql/002_clinic_key.sql` (kliiniku oma võti)
ja `network/sql/003_account_email.sql` (kliendi e-kirjade valik tõendis),
`network/sql/004_billing_email.sql` (arvete e-post) ja
`network/sql/005_terms_acceptance.sql` (kasutustingimuste nõusolek,
docs/legal/) ja `network/sql/006_preferred_language.sql` (konto keel).
Siis eraldi päringuna:

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
- `network-public-key.txt` — avalik võti (43 märki). See läheb faili
  `network/config.json` (samm A6). Avalik: seda võib hoida ja jagada.

### A5. Saladus ja funktsioon

```powershell
npx supabase secrets set --project-ref <NETWORK_REF> --env-file "$env:USERPROFILE\Documents\network-signing.env"
Remove-Item "$env:USERPROFILE\Documents\network-signing.env"
npx supabase functions deploy network-token --project-ref <NETWORK_REF> --workdir network
npx supabase functions deploy network-clinic --no-verify-jwt --project-ref <NETWORK_REF> --workdir network
```

`network-clinic`: kliinik loeb ja muudab oma kataloogirida (samm B2, b). JWT
kontroll on **väljas**, sest seda kutsub ainult kliiniku funktsioon serverist
ja tõend on kliiniku allkiri.

`--workdir network`: funktsioon on kaustas `network/functions/network-token`
(Supabase CLI otsib `<workdir>/supabase/functions` või `<workdir>/functions`
sõltuvalt versioonist; kui CLI ei leia, kopeeri `network/functions` ajutiselt
kausta `network/supabase/functions` ja jooksuta uuesti — **mitte kunagi
kliiniku `supabase/` kausta**).

Kontroll: Dashboard → Edge Functions → `network-token` on olemas, JWT
kontroll **sees** (vaikimisi).

### A6. `network/config.json`

Kaks avalikku väärtust, mida ühendamise käsk (B2) loeb:

```json
{
  "ref": "<NETWORK_REF>",
  "publicKey": "<network-public-key.txt sisu, 43 märki>"
}
```

Muud fail ei sisalda; `scripts/networkConnect.test.ts` keelab kõik muu
(privaatvõti, token). Fail on gitis.

### A7. Telefonirakendus teab Networki

Cloudflare Pages → iga projekt (`wivo`, `wivo-test`, `wivo-dentiks`) →
Settings → Environment variables (Production):

| Nimi | Väärtus |
|---|---|
| `VITE_NETWORK_URL` | `https://<NETWORK_REF>.supabase.co` |
| `VITE_NETWORK_ANON_KEY` | Networki anon key |

Mõlemad on avalikud. Järgmine build võtab need. Ilma nendeta ütleb
`/network` "not set up".

**app.wivodent.com on ainult Wivo Network.** Selle Cloudflare projektis
(`wivo`) lisaks:

| Nimi | Väärtus |
|---|---|
| `VITE_NETWORK_ONLY` | `true` |

Siis on build ainult Network: `/` ja kõik muud aadressid viivad `/network`
peale, töötajate sisselogimist ega kliiniku vaateid pole, ja
`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` pole vaja (need võib sealt
eemaldada; kui on, ei jõua need bundle'isse). Pealkiri ja manifest:
"Wivo Network". Kliinikute telefonid (`wivo-dentiks`, `wivo-test`) jäävad
ilma selle muutujata, nagu praegu.

---

## B. Kliinik Networki (iga kliinik, üks käsk)

Omanik ei näe ühtegi võtit ega numbrit: kõik teeb see käsk Kevini arvutist.

### B1. Enne

1. Kliiniku andmebaasis on **migratsioon 138** (pärast 136 ja 137; Dentiksile
   allkirjastatud paketiga, RELEASE.md §5). Ilma selleta käsk peatub enne,
   kui midagi kirjutab.
2. `clinics/<id>.json` sisaldab `orgId`, `city` ja `country` (kataloog näitab
   nime, linna ja riiki).
3. Litsentsi moodulites on `portal`
   (`scripts/make-license.mjs … --modules jobs,payroll,stock,portal`), muidu
   pole menüüs "Orders".

### B2. Ühenda

Esmalt kuivkäivitus (ei saada midagi, näitab iga sammu ja SQL-i):

```powershell
npm run network:connect -- --clinic dentiks --dry-run
```

Siis päriselt:

```powershell
npm run network:connect -- --clinic dentiks
```

Küsib varjatult **Supabase access tokenit** (Account → Access Tokens; Enter
teisel küsimusel = sama token Networki jaoks). Token ei käi käsureale ega
kettale. Seejärel teeb järjest, iga sammu ainult siis, kui see on tegemata
(teine käivitus ei muuda midagi):

| Samm | Mida |
|---|---|
| a | kliiniku rida Networki kataloogi (`listed = false`) → Networki number ja kutsekood |
| b | kliiniku Ed25519 võti: avalik pool Networki ritta, privaatne otse kliiniku saladustesse (`NETWORK_CLINIC_KEY`, `NETWORK_URL`), mitte kettale |
| c | funktsioonid kliiniku projekti: `network-client` (`--no-verify-jwt`), `network-directory`, `file-link` |
| d | Networki avalik võti ja Networki number kliiniku `network_settings` tabelisse; **tellimused jäävad välja** |
| e | `<telefoniaadress>/network` Networki Redirect URLs nimekirja |
| f | kõik üle kontrollitud; kokkuvõte, Networki number ja kutse link |

Lisavalikud: `--rotate-key` (uus kliiniku võti), `--skip-deploy`.

### B2b. Kliendi teavitused (kliiniku sql/142)

Kliendi kelluke `/network`-is ja e-kiri kliiniku enda Resendi kaudu tulevad
kliiniku andmebaasist (Network ei hoia teavitusi). E-kirjad saadab sama
`send-notifications` mis töötajatele; link on vaikimisi
`https://app.wivodent.com/network` (muuta saladusega `NETWORK_LINK`).
E-kirjas on ainult rida nagu "New message on TF-DE-261127-001 from Dentiks"
ja link. Pärast 142-t deploy uuesti `network-client` ja `send-notifications`,
Networki projektis `network-token` (kannab aadressi ja valiku).

### B3. Omanik

Wivo → **Orders** → kaart **Wivo Network**: **Take orders from outside**
(välja lülitamine küsib üle: kõik klientide sessioonid lõpevad kohe),
**Show my clinic in the directory**, kutse link ja **Copy**.

Kui kliinik pole veel ühendatud, ütleb kaart "Wivo will set this up for you.
Contact Wivo." ja väljad on peidus **Advanced (Wivo support)** all.

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

## Lisa: käsitsi samm-sammult (mida B2 teeb)

Ainult siis, kui käsk ei sobi (nt token ei ulatu kliiniku projekti).

1. **Kataloogirida** (SQL Editor, Networki projekt):

   ```sql
   insert into public.clinic (name, country, city, api_url, listed)
   values ('Dentiks', 'LV', 'Rīga', 'https://<KLIINIKU_REF>.supabase.co', false)
   returning id, invite_code;
   ```

   `id` = kliiniku Networki number; kutse link
   `https://wivo.dentiks.lv/network/join/<invite_code>`.

2. **Kliiniku võti**, kaust väljaspool repot:

   ```powershell
   node network/scripts/make-clinic-key.mjs "$env:USERPROFILE\Documents" dentiks https://<NETWORK_REF>.supabase.co
   npx supabase secrets set --project-ref <KLIINIKU_REF> --env-file "$env:USERPROFILE\Documents\dentiks-network-clinic.env"
   Remove-Item "$env:USERPROFILE\Documents\dentiks-network-clinic.env"
   ```

   Networki projektis:
   `update public.clinic set clinic_public_key = '<dentiks-network-clinic-public-key.txt>' where id = '<Networki number>';`

3. **Funktsioonid**:

   ```powershell
   npx supabase functions deploy network-client --no-verify-jwt --project-ref <KLIINIKU_REF>
   npx supabase functions deploy network-directory --project-ref <KLIINIKU_REF>
   npx supabase functions deploy file-link --project-ref <KLIINIKU_REF>
   ```

4. **Kliiniku seaded**: Wivo → Orders → Wivo Network → **Advanced (Wivo
   support)**: Network key (`network-public-key.txt`), Network number (1.),
   Save. Tellimused jäävad välja, kuni omanik lülitab.

5. **Redirect**: Networki Dashboard → Authentication → URL Configuration →
   Redirect URLs → `https://wivo.dentiks.lv/network`.

Kontroll (Networki projektis, ainult lugemine):
`select name, listed, clinic_public_key is not null as has_key from public.clinic;`

## Mida Network kunagi ei hoia

Tellimusi, faile, sõnumeid, hindu, patsiente. Ainult kontod, profiilid,
kataloog ja ühenduste olekud (PLAN-NETWORK-1.md, N1). Kontrolli: Networki
projektis on täpselt kolm tabelit.
