# Wivo Network: terms for a native speaker to check

Wivo Network (app.wivodent.com and a clinic's /network) speaks English,
Latvian, Russian and Estonian. The Latvian is new (shared/i18n/lv.ts) and
was written without a native speaker. The Russian gained 36 lines for the
Network's screens. Please check the words below in the app, and change them
in the file named.

How to see a language: open /network, choose it in the language menu (top
right, the globe). Prices, order states and the tooth chart are inside an
order to a clinic.

## Latvian (shared/i18n/lv.ts)

### Dental terms

| English | Written as | Where | Question |
|---|---|---|---|
| abutment | **abatments** ("Skrūve / abatments") | order form, review, order page | Is "abatments" what Latvian labs say, or "balsts" / "implanta balsts"? |
| pontic | **starpposms**, plural **starpposmi** | order summary ("2 starpposmi") | Or "tilta starpposms", "tilta posms"? |
| shade | **tonis** ("Tonis A2") | order form, order card | Or "krāsa", which some labs use for A2, 3M2? |
| scan | **skenējums** ("Skenējums / foto") | order form, files | OK? |
| crown, bridge | **kronis**, **tilts** | bridge rules ("… ir tilts") | Work type names themselves come from the clinic's own catalogue |
| implant | **implants**, plural **implanti** | tooth chart, summary | OK? |
| Fitted ✓ | **Der ✓** | feedback after delivery | Or "Derēja ✓", "Piemērots ✓"? |
| Needs adjustment | **Vajag koriģēt** | feedback | Or "Nepieciešama korekcija"? |
| Poor fit (remake reason) | **Slikta pieguļa** | adjustment reasons | Is "pieguļa" the lab word? |
| remake (the clinic makes it again) | **izgatavo darbu no jauna** | adjustment text | OK? |
| Upper / lower jaw | **augšžoklis / apakšžoklis**; chart labels **AUGŠA / APAKŠA** | tooth chart | OK? |
| technician | **Zobu tehniķis** | profile role | OK? |
| due date | **Nepieciešams līdz**, short **Termiņš** | order form, card | OK? |

### Everyday words

| English | Written as | Question |
|---|---|---|
| Sign in / Sign out | **Pieteikties** / **Iziet** | Or "Izrakstīties" for sign out? |
| Second step (the authenticator code) | **Otrais solis** | Clear enough, or "Divpakāpju pārbaude"? |
| In progress | **Procesā** | Or "Izgatavošanā" (used for "In production")? |
| Progress (the order's steps) | **Gaita** | OK? |
| Wrong item (delivery problem) | **Nepareizs darbs** | Or "Ne tas, kas pasūtīts"? |
| Discard this order? | **Atmest šo pasūtījumu?** | OK? |
| "to {clinic}" on the order form | **klīnikai Dentiks** | Reads well with lab names too ("klīnikai Zobu laboratorija")? |
| "{clinic} has your request" | **{clinic} ir saņēmusi …** | Feminine (klīnika). Fine for a lab too? |
| Good morning / afternoon / evening | **Labrīt / Labdien / Labvakar** | OK? |
| Terms of Use / Privacy Notice | **Lietošanas noteikumi / Privātuma paziņojums** | The lawyer may prefer other names |
| "I agree … and have read …" | **Piekrītu … un esmu izlasījis(-usi) …** | The (-usi) form: acceptable, or rephrase without gender? |

### Counts

Numbers ending in 1 (not 11) take the singular: "1 zobs", "21 zobs",
"2 zobi", "11 zobi". Used for teeth, implants, pontics, messages, new
notifications and open orders. Please check "0 …" reads acceptably (it uses
the plural: "0 zobi").

## Russian (shared/i18n/ru.ts, the lines added for the Network)

| English | Written as | Question |
|---|---|---|
| Poor fit | **Плохая посадка** | Lab word? |
| Wrong shade | **Не тот цвет** | The rest of Wivo uses "Цвет" for shade |
| Wrong design | **Неверный дизайн** | OK? |
| Monthly statement | **Ежемесячный счёт** | OK? |
| "differs / differ" (per-tooth codes) | **отличается / отличаются** | OK? |
| The e-mail for a price to approve | **{clinic} прислал(а) цену для {ref} на подтверждение** | Gender form (а) as elsewhere in Wivo |

## E-mails to Network clients (shared/network/clientMail.ts)

Subject lines in all four languages. Most are the same sentence as the
notification in the app; two are e-mail only and need a check in every
language:

- the reminder: "Did your order {ref} arrive?"
- the price: "{clinic} sent a price for {ref} to approve"

## Not translated on purpose

- The Terms of Use and the Privacy Notice stay in English until the lawyer
  approves them; the page says a translation is coming.
- The sign-up confirmation e-mail is Supabase's own template. The sign-up
  now records the chosen language in the user's metadata (`lang`), so the
  template can be made to choose by it.
