# Security

## Trust model

Tripkit is a **friends-trust app**, not a hardened multi-tenant SaaS:

- **Reads** are gated by a single shared **passcode** (`PASSCODE`). This is obscurity for
  a small group, not strong authentication — anyone with the passcode can view all trips.
- **Writes** (create/edit/delete) require an **admin login** (`ADMIN_PASSWORD_HASH`),
  which sets an HMAC-signed, `HttpOnly`/`Secure`/`SameSite=Lax` session cookie. Mutating
  requests also get a same-origin (CSRF) check.

Run it **behind TLS** (the bundled deploy uses a TezTun tunnel that terminates HTTPS).
Do not expose the raw HTTP port to the public internet. Set a strong `SESSION_SECRET`
and a non-default `PASSCODE`/admin password.

## Secrets

- All secrets come from environment variables / `.env` (gitignored). A committed
  `.env.example` documents them with placeholders.
- The OCR provider key and the admin password hash are **server-side only** — never sent
  to the browser.

## OCR privacy

Receipt OCR is **opt-in per upload**. When used, the uploaded photo is sent to the
configured third-party vision API (`OCR_API_BASE`). Uploaded images are not persisted by
the server. Manual entry is always available if you'd rather not send photos anywhere.

## Reporting

Found a vulnerability? Please open a private report via GitHub Security Advisories on the
repository, or email the maintainer. Do not file public issues for sensitive reports.
