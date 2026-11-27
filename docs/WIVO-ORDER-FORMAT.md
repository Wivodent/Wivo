# "Wivo order" format, versions 1 and 2

What an outside client (a technician, a doctor, a clinic or a lab with a Wivo
Network account) sends a clinic. Checked in three places that must agree:
the client's form and the clinic's Edge Function (`shared/network/order.ts`,
`orderProblems`) and the clinic's database (`client_new_order`, sql/138).

## The order

One JSON object, exactly these fields, nothing else:

```json
{
  "format": "wivo-order",
  "version": 1,
  "work_type": "Zirconia crown",
  "teeth": "11,21",
  "options": { "framework": ["metal-bar"] },
  "shade": "A2",
  "due": "2026-12-05",
  "patient_ref": "CASE-0412",
  "notes": "Please check the margin on 21."
}
```

| Field | Type | Rule |
|---|---|---|
| `format` | `"wivo-order"` | always |
| `version` | `1` | this document |
| `work_type` | text, 1–120 | a work type's name **in the receiving clinic's catalogue** (`client_catalog`) |
| `teeth` | text | FDI numbers, comma-separated, no spaces (`11,21`); `""` for work on no teeth or a whole arch |
| `options` | object | group key → option ids, from that work type's groups in the catalogue; a group that allows one option gets at most one |
| `shade` | text ≤ 20 or `null` | as the client writes it (`A2`, `3M2`) |
| `due` | `YYYY-MM-DD` or `null` | not in the past when sent |
| `patient_ref` | text, 1–40 | **the orderer's own reference**: a case number, initials, their code. Never a name, a personal code, a birth date |
| `notes` | text ≤ 2000 or `null` | about the work |

**No patient record.** There is no field for a name, a personal code, a birth
date, contact details or a medical card, and an order with any field not in
the list above is refused (`unknown_field`). The form says so next to the
reference field.

Files go separately, after the order is made: each one gets a place
(`client_file_slot`), its bytes go straight to the clinic's storage through a
signed upload link, and it is marked done (`client_file_done`). At most 30 per
order. Their names are the client's; when the clinic accepts the order they
become the job's files under the job's code.

## Version 2: implants (sql/141)

Version 1 and two more fields, both required in version 2:

```json
{
  "format": "wivo-order",
  "version": 2,
  "work_type": "Implant bridge",
  "teeth": "14,13,12",
  "implants": "14,12",
  "abutment": { "all": "MIS C1", "teeth": { "12": "Straumann BL" } },
  "options": {}, "shade": "A2", "due": null, "patient_ref": "TF-DE-261127-001", "notes": null
}
```

| Field | Type | Rule |
|---|---|---|
| `implants` | text | FDI numbers **among `teeth`** that sit on an implant, comma-separated; `""` for none |
| `abutment` | object or `null` | `all`: the screw / abutment of every implant (text 1–60 or `null`); `teeth`: FDI → code (1–60) for implants whose code differs. Only with at least one implant |

**Pontics** are a bridge's teeth that are not implants: not a field, so the
two can never disagree. On the form, work built on implants (an implant crown
or bridge, an abutment, an overdenture, a hybrid, All-on-4/5/6) marks a tooth
picked as an implant at once, exactly as Wivo's new-job form; All-on-N asks
where its N implants are and warns when the count differs.

Accepting the order makes the job's work item with exactly these:
`implantaadid` = `implants`, `kruvi` = `abutment.all`, `kruvid` =
`abutment.teeth`.

A clinic says it takes version 2 by `order_version: 2` on its catalogue
entries (`client_catalog`, sql/141); a client sends version 2 only then, and
version 1 to a clinic without it. Version 1 orders, old and new, stay valid
everywhere and open as before.

## What the client sees back

`client_orders` and `client_order_detail` give an order's status, and the
reason if it was rejected:

| Status | When | Shown as |
|---|---|---|
| `received` | sent, not decided yet | New |
| `in_progress` | accepted: a job was made (also shown when the owner hides the progress) | In progress |
| `ready` | the job is at the clinic's last stage | Ready |
| `sent` | the job is on its way or handed over, and the client has not said Received | Sent |
| `arrived` | the client said Received, the clinic confirmed it by phone, or it was handed over in person (sql/145); also work sent before 145 | Received |
| `problem` | the client reported a problem with the delivery, and the clinic has not marked it resolved (sql/145) | Problem |
| `rejected` | refused, with the clinic's reason | Rejected |

`received` is the clinic having the order; `arrived` is the client having the
work. After `sent` the client answers through `network-client`: `received`,
or `problem` with a reason (`not_arrived`, `damaged`, `wrong_item`,
`missing_parts`, `other`), a text and photos (sent with its message). Its
messages carry `delivery_state` (`received`, `problem`, the clinic's
`resolved`) and `delivery_reason`. Fitted / Needs adjustment and the ratings
(module `ratings`, sql/144) need `arrived`.

## Versions

A new version is a new number. The clinic's database accepts only the
versions it knows (today: 1); a client sends the highest version both sides
know. A version is never changed once a clinic has it: a new field is the
next version (version 2 added `implants` and `abutment`).
