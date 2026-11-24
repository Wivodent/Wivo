# Kliiniku release: Dentiks 2.0.5 on viimane käsitsi paigaldus, edasi uuenevad arvutid ise

Sinu juhend, Kevin. **Windowsis, PowerShellis, Wivo kaustas, üks käsk
korraga.** Iga samm ütleb, mida pärast nägema peaksid. Kui midagi läheb
teisiti, **peatu seal**. Ära paranda käsitsi edasi ja ära muuda skripti, et
keeldumisest mööda saada.

**Nimed käivad kliiniku järgi, mitte riigi või linna järgi.** Kõik
kliinikupõhine on failis `clinics/dentiks.json`: releaside repo, telefoni
aadress, Supabase'i projekt, Cloudflare'i projekt ja telefoni haru. Iga käsk
saab kliiniku nime: `--clinic dentiks`. Järgmise kliiniku jaoks tuleb teha uus
fail `clinics/<id>.json` (clinics/README.md). See juhend kehtib siis samamoodi,
ainult `dentiks` asemel on uus nimi.

Mis see on ja miks see turvaline on, seletab `docs/RELEASE.md`. Lühidalt: 2.0.5
on esimene Dentiksi installer, mis loeb uuendusi **kliiniku oma GitHubi repost**
(`SniperInSuit/wivo-dentiks-releases`, release `stable`). Ta paigaldab ainult
selle, mille YubiKey C on allkirjastanud **Dentiksi jaoks**. main'i release'id
sinna kunagi ei jõua, ja teise kliiniku omad ka mitte. 2.0.4 ja varasemad Riia
installerid loevad main'i GitHubi release'e ja keelduvad neist, sest neil pole
allkirja. Seega **tuleb 2.0.5 igasse arvutisse üks kord käsitsi paigaldada**.
Edasi uueneb Wivo ise.

> Claude ei ühendu ühegi andmebaasiga ega pushi. Kõik allpool teed sina.

**PowerShell ja `--`:** käsud on kujul `npm run release -- --clinic dentiks`.
Kui npm hoiatab `Unknown cli config "--clinic"`, pole hullu: tööriist saab
valiku ikka kätte. Kui midagi tundub valesti, toimib sama asi ka nii:
`node scripts/release.mjs build --clinic dentiks`.

---

## 0. Mis 2.0.5-s on

- Allkirjastatud automaatsed uuendused, kliiniku oma repost (A).
- Kommentaar ei jää enam „laadima", kui lisatud faili üleslaadimine tühistatakse
  või ebaõnnestub. Failil on kommentaaris X (B1).
- Töö failide juures on päris tüübifilter („Kõik 7 · Skann 3 · …"). Valik
  „Uued failid: …" määrab ainult lisatavate failide tüübi (B2).
- Töö kustutamine telefonis, sama õiguse (Delete jobs) ja sama kinnitusega
  („Delete? Yes") nagu töölaual (B3).
- „What's new" näitab kliiniku telefoni aadressi `wivo.dentiks.lv` (B4).
- **Andmebaasi muudatusi ei ole:** uusim migratsioon on endiselt
  `125_mail_quota.sql`, mis on Dentiksi baseline'is juba sees.

---

## 1. Enne: migratsioonid ja ühekordsed seadistused

**1.1. Migratsioonid.** 2.0.5 ei too ühtegi uut. Dentiksi baasis peab olema
kuni `125_mail_quota.sql` (selle tegi baseline 23.11). Kontrolli Dentiksi Wivos
omanikuna: **Settings → Database** ei näita ühtegi puuduvat migratsiooni.
Kui testkoopias on 122–125 veel jooksutamata, jooksuta need enne (NEXT.md,
„Kevini osa"). Dentiksi release'i see ei takista.

**1.2. Tööriistad.** Kontrolli igaüht eraldi. Kui mõni puudub, paigalda see ja
ava **uus** PowerShelli aken.

```powershell
node --version
```
→ `v22…` või uuem.

```powershell
ykman --version
```
→ `YubiKey Manager (ykman) version: 5.4` või uuem. Kui puudub:
`winget install --id Yubico.YubiKeyManagerCLI -e`

```powershell
gh --version
```
→ `gh version …`. Kui puudub: `winget install --id GitHub.cli -e`

```powershell
gh auth status
```
→ `Logged in to github.com account SniperInSuit`. Kui ei ole: `gh auth login`
(GitHub.com → HTTPS → Login with a web browser; brauseris riistvaravõti).

**1.3. YubiKey ja Windows.** Smart Card teenus peab käima ja keegi teine ei
tohi kaarti kinni hoida (docs/RELEASE-ON-WINDOWS.md §2):

```powershell
Get-Service SCardSvr
```
→ `Running`. Kui on `Stopped`, käivita administraatori PowerShellis
`Start-Service SCardSvr`. Sulge Yubico Authenticator, kui see on lahti.

**1.4. Kliiniku releaside repo (üks kord).** Ava brauseris github.com/new:

| Väli | Väärtus (`releasesRepo` failis `clinics/dentiks.json`) |
|---|---|
| Owner | `SniperInSuit` |
| Repository name | `wivo-dentiks-releases` |
| Visibility | **Public** (kliiniku arvutid loevad seda ilma sisselogimiseta) |
| Add a README file | **sees** (release vajab vähemalt üht commiti) |

Vajuta Create repository. Muud sinna ei pane: release'i teeb tööriist.

**1.5. Telefoni aadress `https://wivo.dentiks.lv` (üks kord).** See on
`phoneUrl` failis `clinics/dentiks.json`: Cloudflare'i `wivo-dentiks`
kohandatud domeen. `wivo-dentiks.pages.dev` töötab edasi, aga inimesed
kasutavad kliiniku domeeni.

1. Cloudflare → Workers & Pages → `wivo-dentiks` → **Custom domains**:
   `wivo.dentiks.lv` on **Active**.
2. Sama projekt → Settings → **Variables and Secrets** → **Production** →
   Add: `VITE_PHONE_URL` = `https://wivo.dentiks.lv`. Save. Ehitus loeb seda
   järgmisel deploy'l (samm 5).
3. Dentiksi Supabase → Authentication → **URL Configuration**: Site URL =
   `https://wivo.dentiks.lv`. Redirect URLs: lisa
   `https://wivo.dentiks.lv/auth/confirm`, vana pages.dev rida võib jääda.
   Kutse ja parooli lingid viivad siis kliiniku domeenile.
4. Dentiksi Supabase → Edge Functions → **Secrets**: `APP_LINK` =
   `https://wivo.dentiks.lv/job/{id}`. Teavituste lingid viivad siis
   samuti kliiniku domeenile.

Telefonis on sisselogimine ja push-teavitused aadressi kohta. Kes on seni
kasutanud `wivo-dentiks.pages.dev`-i, peab `wivo.dentiks.lv`-l ühe korra uuesti
sisse logima ja pushi uuesti sisse lülitama.

**1.6. Avalik võti kliiniku kausta (üks kord).** Senise `riga.env`-i asemel
loeb ehitus faili `clinics/dentiks.env`. Git seda faili ei jälgi. Projekti
aadress ja telefoni aadress tulevad nüüd `clinics/dentiks.json`-ist, seega
vajab env-fail ainult avalikku võtit. Tõsta fail ümber:

```powershell
Move-Item riga.env clinics\dentiks.env
```

`VITE_SUPABASE_URL` rida võib failis alles jääda: ehitus lubab selle, kui see
on sama mis `clinics/dentiks.json`-is. Kui ta ütleb
„VITE_SUPABASE_URL is not …: remove the line", kustuta see rida
(`notepad clinics\dentiks.env`). Alles peab jääma rida
`VITE_SUPABASE_ANON_KEY=…`.

---

## 2. Ehita, allkirjasta YubiKey C-ga, avalda

**2.1. Kood.**

```powershell
git switch testing
```

```powershell
git pull
```

```powershell
git status --short
```
→ ei trüki midagi.

```powershell
npm ci
```

**2.2. Ehita** (~5 minutit). `--first` lisa ainult seekord, sest midagi pole
veel avaldatud.

```powershell
npm run release -- --clinic dentiks --first
```

Algul näed `Dentiks: project fwsrnsdrlrlmjfkkkhvp · phone
https://wivo.dentiks.lv · updates
https://github.com/SniperInSuit/wivo-dentiks-releases/releases/download/stable`.
Lõpus näed:

```
Release 2.0.5 is ready to sign: releases/dentiks/2.0.5/
  Installer: Wivo-dentiks-Setup-2.0.5.exe
  SHA-256:   <64 märki>
  Database:  this version expects 125_mail_quota.sql
  First release: Dentiks's database must already be at that migration (its baseline). …
Next: npm run release:sign -- --clinic dentiks   (YubiKey C)
```

Vahepeal ütleb ehitus ka `updates from Dentiks's own release only
(app-update.yml)` ja `no .env in the package`. Kui näed **„Refused: …"**, loe
see rida läbi: see ütleb, mida teha. Vana `dist-riga\` kaust jääb puutumata.
Uus installer tuleb kausta `dist-dentiks\`.

**2.3. Allkirjasta.** Pane YubiKey C arvuti külge (A, B ja D mitte).

```powershell
npm run release:sign -- --clinic dentiks
```

Tööriist näitab, mida allkirjastatakse: versioon, commit, fail, SHA-256,
nimekirja number ja aegumine (30 päeva pärast). Siis küsib ta **PIN-i** (sisestus
ei paista) ja kaks korda **puudutust**, kui võti vilgub:
1. „The list, serial 1, … (update key)"
2. „Wivo 2.0.5 for Dentiks, the installer's hash (app key)"

Lõpus näed: `Signed, and checked with the app's own code: releases/dentiks/2.0.5/updates.json`.
Kui ta ütleb „did not sign" (puudutus hilines), jooksuta sama käsk uuesti.
Kui ta ütleb „does not verify against …", siis peatu: see oli vale võti või vale pesa.

Varuvõtmega D: `npm run release:sign -- --clinic dentiks --yubikey D`.

**2.4. Avalda.**

```powershell
npm run release:publish -- --clinic dentiks
```

Esimesel korral teeb tööriist repos release'i `stable`. Siis laadib ta üles
installeri, `updates.json` ja `latest.yml` (selles järjekorras) ning loeb need
avalikult aadressilt tagasi. Lõpus näed:

```
Published: Wivo 2.0.5 for Dentiks.
  Installer: https://github.com/SniperInSuit/wivo-dentiks-releases/releases/download/stable/Wivo-dentiks-Setup-2.0.5.exe
  SHA-256:   <64 märki>
…
  git push origin <täispikk commit>:refs/heads/riga
```

Kui ta ütleb „not the same yet", oota minut ja jooksuta
`npm run release:publish -- --clinic dentiks --check`.

**2.5. Pushi `testing`** (release'i commit peab GitHubis olema):

```powershell
git push origin testing
```

---

## 3. Iljale

**Saada kahe eri kanali kaudu:** link ühe kaudu (e-kiri), SHA-256 teise kaudu
(sõnum või telefon).

- Link: `https://github.com/SniperInSuit/wivo-dentiks-releases/releases/download/stable/Wivo-dentiks-Setup-2.0.5.exe`
- SHA-256: see, mille `publish` trükkis.

**Tekst Iljale** (inglise keeles):

> Wivo 2.0.5 for all Dentiks computers. After this one, Wivo updates itself, so
> this is the last manual install.
>
> **Important: Wivo installs per user, not per machine.** Run the installer
> **in each Windows user's own account** (the account that uses Wivo). Do not
> run it as an administrator, as SYSTEM or from another account: it would
> install into that account's profile instead. It needs no admin rights. Good
> ways to run it: a user logon script (GPO, User Configuration), a scheduled
> task that runs as the logged-on user, or your remote tool in the user's
> session.
>
> Silent install: `Wivo-dentiks-Setup-2.0.5.exe /S`. It shows no window,
> installs into `%LOCALAPPDATA%\Programs\Wivo`, replaces 2.0.4 and keeps the
> sign-in and the licence. Close Wivo first.
>
> In the user's PowerShell:
>
> ```powershell
> $exe = "$env:TEMP\Wivo-dentiks-Setup-2.0.5.exe"
> Invoke-WebRequest -Uri "https://github.com/SniperInSuit/wivo-dentiks-releases/releases/download/stable/Wivo-dentiks-Setup-2.0.5.exe" -OutFile $exe
> if ((Get-FileHash $exe -Algorithm SHA256).Hash -ne "<SHA-256>") { throw "SHA-256 does not match: do not install" }
> Start-Process $exe -ArgumentList '/S' -Wait
> ```
>
> **To check that it worked,** run this in the same user's PowerShell:
>
> ```powershell
> Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" | Where-Object DisplayName -like "Wivo*" | Select-Object DisplayName, DisplayVersion
> ```
>
> It should show `DisplayVersion 2.0.5`. Then open Wivo and go to **Settings →
> Licence**. The Updates part should say *Version 2.0.5* and *Only Wivo's
> signed releases install. Updates come from
> github.com/SniperInSuit/wivo-dentiks-releases*. About 30 seconds after Wivo
> opens, `%APPDATA%\wivo\updater.log` should have the line `build dentiks:
> updates from
> https://github.com/SniperInSuit/wivo-dentiks-releases/releases/download/stable`.
>
> If you run the installer by hand, Windows SmartScreen may say "unknown
> publisher": choose More info → Run anyway. The SHA-256 check above is what
> proves the file is the right one.

Asenda `<SHA-256>` enne saatmist, või saada see eraldi ja Ilja asendab ise.

---

## 4. Uuenduse teekonna proov: 2.0.6, Gary arvuti uueneb ise

Tee see siis, kui 2.0.5 on Gary arvutis. Soovitavalt proovi enne ka oma
Windowsis: paigalda 2.0.5 sinna samamoodi, ainult ilma `/S`-ita.

**4.1. Väike versioonitõus.** Palu Claude'il teha väike muudatus, või tõsta
ainult versiooni:

```powershell
npm version patch --no-git-tag-version
```
→ `v2.0.6`.

```powershell
git commit -am "2.0.6: update path trial for Dentiks"
```

**4.2. Ehita, allkirjasta, avalda** (nüüd ilma `--first`-ita):

```powershell
npm run release -- --clinic dentiks
```
→ `published now: 2.0.5` ja `No new migrations since 2.0.5.`

```powershell
npm run release:sign -- --clinic dentiks
```
→ PIN, kaks puudutust, „list, serial 2".

```powershell
npm run release:publish -- --clinic dentiks
```

```powershell
git push origin testing
```

**4.3. Mida Gary arvutis näha.** Wivo on lahti ja Gary on sisse logitud. 30
minuti jooksul juhtub järgmine (kohe saab: **Settings → Licence → Check for
updates**):

1. Settings → Updates näitab *Downloading 2.0.6…*, siis
   *Installed: 2.0.5. Waiting: 2.0.6, signed and checked, installs at the next
   start.* Nurgas on teade „Restart to update".
2. Gary sulgeb Wivo (või vajutab „Restart now"). Järgmisel avamisel on mõneks
   sekundiks väike uuendusaken (2.0.5 → 2.0.6), siis avaneb Wivo ise.
3. Settings → Updates näitab *Version 2.0.6*.
4. `%APPDATA%\wivo\updater.log` (Gary kasutajas) sisaldab järjest:
   `2.0.6: Wivo's signature checks out (build dentiks)`, `staged 2.0.6`,
   `installing 2.0.6, isSilent=true isForceRunAfter=true`.

**Kui ei uuene,** saada `updater.log`-i viimased 30 rida. Real
`refused, not Wivo's signed release (…)` ütleb sulgudes olev sõna põhjuse
(`wrong_build`, `expired`, `not_this_release` …). Wivo ei jää selle pärast
kunagi seisma: ta töötab edasi vana versiooniga.

**Nimekiri kehtib 30 päeva** (docs/RELEASE.md §6), ja iga release teeb uue.
Aegumine loeb ainult arvutile, mis laadib uue versiooni alla pärast seda. Kui
järgmine release on kaugemal kui 30 päeva, allkirjasta nimekiri uuesti (üks
puudutus):
`npm run release:sign -- --clinic dentiks --refresh`, siis
`npm run release:publish -- --clinic dentiks --refresh`.

---

## 5. Telefon samast commitist (haru `riga`)

Tee see pärast samme 2.4 ja 2.5, ja iga järgmise release'i järel. Telefoni haru
on `phoneBranch` failis `clinics/dentiks.json`: Dentiksil jääb see seniks
`riga`-ks. Jooksuta käsk, mille `publish` trükkis:

```powershell
git push origin <täispikk commit>:refs/heads/riga
```

Ära kasuta kunagi `--force`-i: git keeldub, kui `riga` ei liiguks edasi.
Cloudflare `wivo-dentiks` ehitab selle ise (Deployments näitab sama lühikest
commiti).

Kontrolli telefonis: ava `https://wivo.dentiks.lv` ja logi sisse. Ava
avalehelt töö: all on **Delete job**, kui sul on Delete jobs õigus. „What's new"
(Settings) link näitab `wivo.dentiks.lv`. Kui see näitab veel
`app.wivodent.com`, on samm 1.5 tegemata või tehti deploy enne seda: Cloudflare
→ Deployments → **Retry deployment**.
