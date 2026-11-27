-- ============================================================================
-- Wivo — migration 137: a job's files only through `file-link` (F6, 2.2.6)
-- Run this ON ITS OWN, AFTER 136, and ONLY AFTER every app in use calls
-- file-link for previews too (the release that raises the minimum version;
-- docs/NIGHT-REPORT-2026-11-27.md, part 3, gives the order).
-- ============================================================================
--
-- WHY
--   Until now a signed-in person with a short download grant (sql/072, 073)
--   could sign a storage link THEMSELVES, for any lifetime they chose: a link
--   that lives a year and keeps working after their rights are gone
--   (SECURITY-REVIEW-2026-11.md, S1). The app no longer does that: every
--   download, preview and patient export goes through the `file-link` Edge
--   Function, which checks the rights in the database as the person, writes
--   the audit entry, and signs with the service key for 60 s (a download) or
--   300 s (a preview).
--
-- WHAT
--   The storage read policy `job_files_select` goes. After it, `authenticated`
--   cannot read or sign anything in the `job-files` bucket; the service key
--   (only in Edge Functions) can. Uploads are unchanged: `job_files_insert`
--   stays, and a new upload needs no read.
--
--   request_file_download and request_job_previews stay as they are: file-link
--   calls them as the user (rights, audit). The grants they still write are
--   now only a record; nothing reads them for access.
--
-- AN APP BELOW THE NEW MINIMUM, if one were still open: its downloads already
-- go through file-link; its previews (signed by the app) would stop showing,
-- and its patient export would stop at the first file. That is why the
-- minimum version is raised first.
--
-- Idempotent. Changes no data.

set lock_timeout = '10s';

drop policy if exists "job_files_select" on storage.objects;

-- ─── Verify (read only) ─────────────────────────────────────────────────────
-- select policyname, cmd from pg_policies
--  where schemaname = 'storage' and tablename = 'objects' and policyname like 'job_files%';
--   -> one row: job_files_insert, INSERT
