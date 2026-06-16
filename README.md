# Tripkit

A tiny, self-hostable **trip expense splitter** — and a trip companion. Track multiple
trips, tap who shared each receipt item and shared cost, and get the minimal
"who-pays-whom" settlement. Optional **receipt OCR** (snap a photo, confirm, save) and a
trip **itinerary** map. Vanilla JS front-end + a standard-library-only Go backend.

> Self-host it in a couple of minutes. No framework, no database server, no build step.

## Features

- **Multi-trip** — create/edit/delete trips, each with its own people, receipts, shared
  costs and ledger.
- **Fair splitting** — itemized receipts (tap who shared each line; tax/service allocated
  proportionally) + flat shared costs (even or weighted) + a manual debt/payment ledger.
- **Minimal settlement** — greedy who-pays-whom, with a print-to-PDF report.
- **Publish & track payments** — freeze the settlement as an official plan (it won't
  reshuffle), record each person's **payout details**, let payers **upload a transfer
  photo**, and have the **admin verify** each payment (pending → submitted → verified).
- **Scales to 10+ people** — at ≤8 the classic inline chips; above that, collapsed avatar
  stacks + a searchable person-picker, so big groups stay usable.
- **Two access tiers** — a shared **passcode** (view + collaborative editing + payout
  details + proof upload); an **admin login** (people, trips, publish/verify, OCR, AI).
- **Receipt OCR (optional)** — upload a photo, a vision model drafts the receipt, you
  confirm before saving. Needs an OpenAI-compatible **vision** model (DeepSeek is
  text-only and can't read images — use e.g. Gemini Flash).
- **AI itinerary (optional)** — per-trip day-by-day map; generate with a text LLM
  (DeepSeek works well) then hand-edit. Stops can link to a shared cost.

## Routes

| Path | What |
|------|------|
| `/` | Trip list (landing) |
| `/split/?t=<tripId>` | The bill splitter for a trip |
| `/trip/` | Itinerary map (static) |
| `/api/*` | JSON API (Go backend) |

## Architecture

- **app** — nginx serves the static front-end and reverse-proxies `/api/` to the backend.
- **api** — Go (stdlib only). One JSON document per trip on a mounted volume
  (`data/trips/<id>.json`). Atomic writes, mutex-guarded. Reads need the passcode; writes
  need an HMAC-signed admin session cookie. Optional OCR endpoint calls a configurable
  OpenAI-compatible vision API.
- **tunnel** *(bundled deploy only)* — `asadullokhn/teztun` exposes it over HTTPS.

Money is stored as **integer minor units** (whole rupiah for IDR).

## Quickstart

```bash
git clone https://github.com/asadullokhn/tripkit.git
cd tripkit
cp .env.example .env

# set an admin password hash:
docker compose run --rm --no-deps --entrypoint /usr/local/bin/api api -hashpw "your-password"
#  → paste the output into ADMIN_PASSWORD_HASH in .env, set PASSCODE + SESSION_SECRET

docker compose up -d --build
```

First run installs a **demo trip** (fictional people) if the data volume is empty. Open
the app, enter the passcode to view, and **Log in** with your admin password to edit.

> The bundled `docker-compose.yml` also starts a TezTun tunnel; if you don't use TezTun,
> remove that service and put your own reverse proxy / TLS in front of the `app` container.

## Configuration

| Env var | Purpose |
|---------|---------|
| `PASSCODE` | Shared passcode required to view (read tier). |
| `ADMIN_PASSWORD_HASH` | `api -hashpw <pw>` output; unlocks editing. Empty = read-only. |
| `SESSION_SECRET` | 32+ random chars signing session cookies. |
| `SEED_FILE` | Seed trip installed when the data volume is empty (default `/seed/demo.json`). |
| `OCR_API_BASE` / `OCR_API_KEY` / `OCR_MODEL` | Optional OCR via an OpenAI-compatible **vision** model. |
| `DATA_DIR` | Where trip JSON lives (default `/data`, a volume). |
| `TEZTUN_TOKEN` | Only for the bundled tunnel service. |

### A note on OCR & DeepSeek

DeepSeek's public API is **text-only** and cannot read images. Point `OCR_*` at a cheap
**vision** model instead — e.g. Gemini Flash via its OpenAI-compatible endpoint:

```
OCR_API_BASE=https://generativelanguage.googleapis.com/v1beta/openai
OCR_MODEL=gemini-2.5-flash
OCR_API_KEY=...
```

Uploaded photos are sent to that provider for OCR and are not stored by the server. OCR is
opt-in per upload; manual entry always works. See [SECURITY.md](SECURITY.md).

## Develop / contribute

See [CONTRIBUTING.md](CONTRIBUTING.md). TL;DR: stdlib-only Go, vanilla JS, `gofmt`, no deps.

## License

[MIT](LICENSE).
