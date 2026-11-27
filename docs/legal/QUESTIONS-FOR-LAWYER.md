# Wivo Network legal texts: questions for the lawyer

> **DRAFT – pending legal review.** Points the drafts in this folder could not
> settle. Facts behind each one: DATA-MAP.md (section in brackets).

## Roles

1. **Is Wivo a processor for a clinic at all?** Each clinic's database is in
   the clinic's own Supabase organisation, and the clinic contracts Supabase
   and Resend itself (DATA-MAP 1). Wivo has administrator access during setup
   and `network:connect`, ships signed updates that run with full rights in
   the clinic's database, gives support on request, and serves the web app's
   files from its own Cloudflare account. The DPA draft assumes Wivo is a
   processor for exactly these activities. Is that right, or is Wivo only a
   software vendor (earlier open question Q1 in docs/ARCHITECTURE-INSTANCES.md)?
2. **The Network pass.** When a Network user opens a clinic, Wivo signs a
   5-minute pass with the user's name, role, company, country and e-mails,
   and the clinic stores them (DATA-MAP 3). We treat this as Wivo (controller
   of the account) disclosing to the clinic (a new controller) at the user's
   request, under the contract with the user. Correct?
3. **Patient data in orders.** The privacy draft says the clinic is the
   controller of what it receives and the sender is controller of what it
   sends. Are the sender and the receiving clinic separate controllers, or
   joint controllers, or is the receiving lab the sender's processor (a lab
   making a device to the doctor's order)? Does an agreement between them
   need to exist, and should Wivo provide a template?
4. **Wivo as controller of the directory.** The directory holds clinic names,
   cities and countries. A sole-trader clinic's name is personal data. Any
   extra notice needed?

## Health data and minimisation

5. **DICOM files are uploaded unchanged** and can contain the patient's name
   (DATA-MAP 3). Is a warning in the Terms enough, or must the app remove the
   name from DICOM headers before upload (as it does for photos and scans)?
6. **Is a patient reference (initials, case number) plus a scan health data**
   in the hands of the receiving clinic? Earlier open questions Q3 and Q4.
7. **Patient information and consent.** The Terms put on the sender the duty
   to inform the patient or get consent. Is that the right allocation, and
   does a cross-border order (Estonia ↔ Latvia) change it?

## Retention and deletion

8. **What a clinic keeps after a connection or an account ends.** Today the
   clinic keeps orders, files, messages and ratings with no automatic deletion
   (DATA-MAP 8). Is that acceptable as "the clinic's own business records", or
   must something be deleted, and when? MDR Annex XIII document periods (10 or
   15 years) may apply to the lab (earlier Q5).
9. **Account deletion has no screen.** A user writes to Wivo and Wivo deletes
   the sign-in user; the account and connections go with it (DATA-MAP 8). Is
   that enough, or must there be a self-service delete? How long may Wivo keep
   the record of accepted terms after deletion ([RETENTION PERIOD] in the
   privacy draft)?
10. **Acceptance history.** Only the latest accepted version and time are kept
    on the account; earlier acceptances are overwritten (DATA-MAP 10). Is a
    full history needed as evidence?
11. **Platform log retention.** Supabase keeps API, Auth and function logs
    with IP addresses for a period set by the plan, not by us (DATA-MAP 7).
    What should the notice say ([LOG RETENTION])?

## Providers and transfers

12. **Cloudflare** serves the web app and sees IP addresses and page requests
    from a global network (DATA-MAP 6). Which transfer safeguard do we name,
    and is Cloudflare our sub-processor for clinics (DPA Annex 2)?
13. **Supabase** is a US company hosting in Frankfurt. Which safeguard (EU–US
    Data Privacy Framework, SCCs in Supabase's DPA)? Has Wivo signed
    Supabase's DPA for the Network project?
14. **Resend** sends notices to Network users, but from the clinic's own
    account (DATA-MAP 5). We left Resend out of Wivo's list. Correct?
15. **Supabase's built-in mailer** sends the sign-up confirmation (no custom
    SMTP set for the Network). Should we list it separately, or move to our own
    mail provider before launch?
16. **GitHub** hosts update packages and releases (no clinic data). Does it
    belong in Annex 2?

## Terms of Use

17. **Minimum age 18 and professional use only.** Added as a reasonable
    default for a professional tool. Keep?
18. **Liability cap** ([AMOUNT]) for a free service: what amount, and is a cap
    enforceable against a sole trader under Estonian law?
19. **Court** ([COURT]): Harju County Court, or leave it to the general rules?
    Latvian users: does Latvian consumer or commercial law override the choice
    of Estonian law for them?
20. **Ratings.** Today they stay in the clinic's database and nobody outside
    sees them. A future shared profile (Network 2) would publish some. Do the
    Terms need to say more now, or only when that is built (with a new
    version)?
21. **Changes to terms.** The draft asks users to accept a new version at the
    next sign-in. Is that enough notice, or must we e-mail users before a
    change takes effect, and how long before?
22. **Consent for e-mail notices.** The draft treats them as consent (on by
    default, switch in the profile). Since they are service notices about the
    user's own orders, is contract or legitimate interest the better basis,
    and is "on by default" acceptable?

## Language and publication

23. **Translations.** The texts are in English. Must they be available in
    Estonian and Latvian (and Russian?) before Estonian and Latvian users
    accept them, and which version prevails?
24. **Company details** ([COMPANY NAME], [REG CODE], [ADDRESS],
    [CONTACT EMAIL], [EFFECTIVE DATE]) are left as placeholders. Is a data
    protection officer needed, given that Wivo's processing touches health
    data at scale through clinics?

## DPA

25. Fill-ins in the DPA: notice period for new sub-processors, breach notice
    in hours (we suggest 24 or 48), audit notice, days to delete at the end.
26. **Support access:** what consent and logging per case (earlier Q11)? The
    DPA says support only on the clinic's request and with its access.
27. **Signed updates:** the DPA states that updates never read, copy or send
    the clinic's data. Is that the right promise, and what audit right goes
    with it (earlier Q9)?
