# What's new in Wivo 2.2.5

## Safer by design

This release is the security review's fixes. Most of it works quietly in the
background. What you may notice:

- **Printing a job works again** on the computer, from the print button on
  the job.
- **Setting a worker's password** now asks for a code from your
  authenticator app, signs the worker out on every device, and is recorded in
  the audit log.
- **Links** in Wivo open only web pages, e-mail and phone numbers, in your
  own browser or app.
- **Online booking** is protected against spam with Cloudflare's check.
