# Riia 2.0.5: viimane käsitsi paigaldus, siis uuenevad arvutid ise

Sinu hommikune juhend, Kevin. **Windowsis, PowerShellis, Wivo kaustas, üks käsk
korraga.** Iga samm ütleb, mida pärast nägema peaksid. Kui midagi läheb
teisiti, **peatu seal**; ära paranda käsitsi edasi ega muuda skripti, et
keeldumisest mööda saada.

Mis see on ja miks see turvaline on: `docs/RELEASE.md`. Lühidalt: 2.0.5 on
esimene Riia installer, mis loeb uuendusi **Riia oma GitHubi repost**
(`SniperInSuit/wivo-riga-releases`, release `stable`) ja paigaldab ainult
selle, mille YubiKey C on allkirjastanud. main'i release'id sinna kunagi ei
jõua. 2.0.4 ja varasemad Riia installerid loevad main'i GitHubi release'e ja
keelduvad neist (allkirjata), seega **2.0.5 tuleb igasse arvutisse üks kord
käsitsi**; edasi uueneb Wivo ise.

> Claude ei ühendu ühegi andmebaasiga ega pushi. Kõik allpool teed sina.

---

## 0. Mis 2.0.5-s on

- Allkirjastatud automaatsed uuendused (A).
- Kommentaar ei jää enam „laadima", kui lisatud faili üleslaadimine tühistatakse
  või ebaõnnestub; failil on kommentaaris X (B1).
- Töö failide juures on päris tüübifilter („Kõik 7 · Skann 3 · …"); valik
  „Uued failid: …" määrab ainult lisatavate failide tüübi (B2).
- Töö kustutamine telefonis, sama õigus (Delete jobs) ja sama „Delete? Yes"
  nagu töölaual (B3).
- „What's new" näitab Riia telefoni aadressi `wivo-dentiks.pages.dev` (B4).
- **Andmebaasi muudatusi ei ole:** uusim migratsioon on endiselt
  `125_mail_quota.sql`, mis on Riia baseline'is juba sees.

---

## 1. Enne: migratsioonid ja ühekordsed seadistused

**1.1. Migratsioonid.** 2.0.5 ei too ühtegi uut. Riia baasis peab olema kuni
`125_mail_quota.sql` (baseline 23.11 tegi selle). Kontroll: Riia Wivos
omanikuna **Settings → Database**: puuduvaid migratsioone ei ole.
Testkoopias: kui 122–125 on seal veel jooksutamata, tee need enne (NEXT.md,
„Kevini osa"); Riia release'i see ei takista.

**1.2. Tööriistad.** Igaüks eraldi; puuduva paigalda ja ava **uus**
PowerShelli aken.

```powershell
node --version
```
→ `v22…` või uuem.

```powershell
ykman --version
```
→ `YubiKey Manager (ykman) version: 5.4` või uuem. Puudub:
`winget install --id Yubico.YubiKeyManagerCLI -e`

```powershell
gh --version
```
→ `gh version …`. Puudub: `winget install --id GitHub.cli -e`

```powershell
gh auth status
```
→ `Logged in to github.com account SniperInSuit`. Kui mitte: `gh auth login`
(GitHub.com → HTTPS → Login with a web browser; brauseris riistvaravõti).

**1.3. YubiKey ja Windows.** Smart Card teenus peab käima ja keegi teine ei
tohi kaarti kinni hoida (docs/RELEASE-ON-WINDOWS.md §2):

```powershell
Get-Service SCardSvr
```
→ `Running`. Kui `Stopped`: administraatori PowerShellis `Start-Service SCardSvr`.
Sulge Yubico Authenticator, kui see on lahti.

**1.4. Riia releaside repo (üks kord).** Brauseris github.com/new:

| Väli | Väärtus |
|---|---|
| Owner | `SniperInSuit` |
| Repository name | `wivo-riga-releases` |
| Visibility | **Public** (Riia arvutid loevad seda ilma sisselogimiseta) |
| Add a README file | **sees** (release vajab vähemalt üht commiti) |

Create repository. Muud midagi sinna ei pane: release'i teeb tööriist.

**1.5. Cloudflare `wivo-dentiks`: neljas muutuja (üks kord).** Dashboard →
Workers & Pages → `wivo-dentiks` → Settings → **Variables and Secrets** →
**Production** → Add: `VITE_PHONE_URL` = `https://wivo-dentiks.pages.dev`. Save.
(Ehitus loeb seda järgmisel deploy'l, samm 5.)

**1.6. `riga.env`: kolmas rida (üks kord).**

```powershell
notepad riga.env
```

Lisa lõppu rida ja salvesta:

```
VITE_PHONE_URL=https://wivo-dentiks.pages.dev
```

Failis on nüüd täpselt kolm rida: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`VITE_PHONE_URL`. Ilma kolmandata ehitus keeldub („VITE_PHONE_URL is missing").

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

**2.2. Ehita** (~5 minutit). `--first` ainult seekord: midagi pole veel
avaldatud.

```powershell
npm run release:riga -- --first
```

Lõpus näed:

```
Release 2.0.5 is ready to sign: release-riga/2.0.5/
  Installer: Wivo-Riga-Setup-2.0.5.exe
  SHA-256:   <64 märki>
  Database:  this version expects 125_mail_quota.sql
  First release: Riga's database must already be at that migration (its baseline). …
Next: npm run release:riga:sign   (YubiKey C)
```

Vahepeal ütleb ehitus ka `updates from Riga's own release only (app-update.yml)`
ja `no .env in the package`. **„Refused: …"** = loe rida, see ütleb, mida teha.

**2.3. Allkirjasta.** YubiKey C arvuti külge (A, B ja D mitte).

```powershell
npm run release:riga:sign
```

Ta näitab, mida allkirjastatakse (versioon, commit, fail, SHA-256, nimekirja
number ja aegumine), küsib **PIN-i** (midagi ei paista) ja siis kaks korda
**puudutust**, kui võti vilgub:
1. „The list, serial 1, … (update key)"
2. „Wivo 2.0.5 for Riga, the installer's hash (app key)"

Lõpus: `Signed, and checked with the app's own code: release-riga/2.0.5/updates.json`.
Kui ta ütleb „did not sign" (puudutus hilines), jooksuta sama käsk uuesti.
Kui ta ütleb „does not verify against …" — peatu: see oli vale võti või pesa.

(Varuvõtmega D: `npm run release:riga:sign -- --yubikey D`.)

**2.4. Avalda.**

```powershell
npm run release:riga:publish
```

Esimesel korral teeb ta repos release'i `stable`, siis laadib üles
installeri, `updates.json` ja `latest.yml` (selles järjekorras) ja loeb need
avalikult aadressilt tagasi. Lõpus:

```
Published: Wivo 2.0.5 for Riga.
  Installer: https://github.com/SniperInSuit/wivo-riga-releases/releases/download/stable/Wivo-Riga-Setup-2.0.5.exe
  SHA-256:   <64 märki>
…
  git push origin <täispikk commit>:refs/heads/riga
```

Kui ta ütleb „not the same yet": oota minut ja
`npm run release:riga:publish -- --check`.

**2.5. Pushi `testing`** (release'i commit peab GitHubis olema):

```powershell
git push origin testing
```

---

## 3. Iljale

**Saada kahe eri kanali kaudu:** link ühega (e-kiri), SHA-256 teisega
(sõnum või telefon).

- Link: `https://github.com/SniperInSuit/wivo-riga-releases/releases/download/stable/Wivo-Riga-Setup-2.0.5.exe`
- SHA-256: see, mille `publish` trükkis.

**Tekst Iljale** (inglise keeles):

> Wivo 2.0.5 for all Riga computers. After this one, Wivo updates itself, so
> this is the last manual install.
>
> **Important: Wivo installs per user, not per machine.** The installer must
> run **in each Windows user's own account** (the account that uses Wivo), not
> as an administrator, SYSTEM or another account; otherwise it lands in that
> other account's profile. It needs no admin rights. Suitable ways: a user
> logon script (GPO, User Configuration), a scheduled task that runs as the
> logged-on user, or your remote tool in the user's session.
>
> Silent install: `Wivo-Riga-Setup-2.0.5.exe /S` (no window, installs into
> `%LOCALAPPDATA%\Programs\Wivo`, replaces 2.0.4, keeps the sign-in and the
> licence). Close Wivo first.
>
> In the user's PowerShell:
>
> ```powershell
> $exe = "$env:TEMP\Wivo-Riga-Setup-2.0.5.exe"
> Invoke-WebRequest -Uri "https://github.com/SniperInSuit/wivo-riga-releases/releases/download/stable/Wivo-Riga-Setup-2.0.5.exe" -OutFile $exe
> if ((Get-FileHash $exe -Algorithm SHA256).Hash -ne "<SHA-256>") { throw "SHA-256 does not match: do not install" }
> Start-Process $exe -ArgumentList '/S' -Wait
> ```
>
> **Check it worked**, in the same user's PowerShell:
>
> ```powershell
> Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" | Where-Object DisplayName -like "Wivo*" | Select-Object DisplayName, DisplayVersion
> ```
>
> → `DisplayVersion 2.0.5`. Then open Wivo: **Settings → Licence**, the
> Updates part says *Version 2.0.5* and *Only Wivo's signed releases install.
> Updates come from github.com/SniperInSuit/wivo-riga-releases*. And
> `%APPDATA%\wivo\updater.log` has the line `build riga: updates from
> https://github.com/SniperInSuit/wivo-riga-releases/releases/download/stable`
> (about 30 seconds after Wivo opens).
>
> Windows SmartScreen may say "unknown publisher" when it is run by hand:
> More info → Run anyway. The SHA-256 check above is what proves the file.

`<SHA-256>` asenda enne saatmist (või saada see eraldi ja Ilja asendab).

---

## 4. Uuenduse teekonna proov: 2.0.6, Gary arvuti uueneb ise

Tee see, kui 2.0.5 on Gary arvutis (soovitavalt enne ka sinu enda Windowsis:
paigalda 2.0.5 sinna samamoodi, `/S`-ita).

**4.1. Väike versioonitõus.** Kas palu Claude'il väike muudatus teha, või ainult
versioon:

```powershell
npm version patch --no-git-tag-version
```
→ `v2.0.6`.

```powershell
git commit -am "2.0.6: update path trial for Riga"
```

**4.2. Ehita, allkirjasta, avalda** (nüüd ilma `--first`-ita):

```powershell
npm run release:riga
```
→ `published now: 2.0.5` ja `No new migrations since 2.0.5.`

```powershell
npm run release:riga:sign
```
→ PIN, kaks puudutust, „list, serial 2".

```powershell
npm run release:riga:publish
```

```powershell
git push origin testing
```

**4.3. Mida Gary arvutis näha.** Wivo lahti, sisse logitud. 30 minuti jooksul
(kohe: **Settings → Licence → Check for updates**):

1. Settings → Updates: *Downloading 2.0.6…*, siis
   *Installed: 2.0.5. Waiting: 2.0.6, signed and checked, installs at the next
   start.* Nurgas teade „Restart to update".
2. Gary sulgeb Wivo (või „Restart now"). Järgmisel avamisel väike
   uuendusaken (2.0.5 → 2.0.6) mõneks sekundiks, siis avaneb Wivo ise.
3. Settings → Updates: *Version 2.0.6*.
4. `%APPDATA%\wivo\updater.log` (Gary kasutajas) sisaldab järjest:
   `2.0.6: Wivo's signature checks out (build riga)`, `staged 2.0.6`,
   `installing 2.0.6, isSilent=true isForceRunAfter=true`.

**Kui ei uuene:** saada `updater.log`-i viimased 30 rida. `refused, not
Wivo's signed release (…)` sulgudes ütleb põhjuse (`wrong_build`,
`expired`, `not_this_release` …). Kunagi ei jää Wivo selle pärast seisma:
ta töötab edasi vana versiooniga.

**Nimekiri aegub 14 päeva pärast** (docs/RELEASE.md §6). See loeb ainult
arvutile, mis laadib uue versiooni alla pärast aegumist. Kui oled kaua ära ja
tahad, et kauem kinni olnud arvutid ka uueneksid:
`npm run release:riga:sign -- --refresh --days 30`, siis
`npm run release:riga:publish -- --refresh` (üks puudutus).

---

## 5. Telefon samast commitist (haru `riga`)

Pärast 2.4 ja 2.5 (ja iga järgmise release'i järel). Käsk, mille `publish`
trükkis:

```powershell
git push origin <täispikk commit>:refs/heads/riga
```

Kunagi `--force`-iga: git keeldub, kui `riga` ei liiguks edasi. Cloudflare
`wivo-dentiks` ehitab selle ise (Deployments näitab sama lühikest commiti).

Kontroll telefonis: ava `https://wivo-dentiks.pages.dev`, logi sisse.
Avalehel töö → all **Delete job** (kui sul on Delete jobs). „What's new"
(Settings) link näitab `wivo-dentiks.pages.dev`. Kui see näitab veel
`app.wivodent.com`: samm 1.5 on tegemata või deploy tehti enne seda —
Cloudflare → Deployments → **Retry deployment**.
