# "Wivo order" format, version 1

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

## What the client sees back

`client_orders` and `client_order_detail` give an order's status in four
words, and the reason if it was rejected:

| Status | When |
|---|---|
| `received` | sent, not decided yet |
| `in_progress` | accepted: a job was made (also shown when the owner hides the progress) |
| `ready` | the job is at the clinic's last stage |
| `sent` | the job is on its way or handed over |
| `rejected` | refused, with the clinic's reason |

## Versions

A new version is a new number. The clinic's database accepts only the
versions it knows (today: 1); a client sends the highest version both sides
know. Version 1 is never changed once a clinic has it: a new field is
version 2.
