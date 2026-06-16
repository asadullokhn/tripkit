# Contributing

Thanks for your interest! This project is deliberately tiny and dependency-light.
Please keep it that way.

## Hard constraints

- **Backend: Go standard library only.** No third-party modules (`go.mod` has no
  `require` block, there is no `go.sum`). If you think you need a dependency, open an
  issue first — the answer is usually "implement the small piece with stdlib."
- **Frontend: vanilla HTML/CSS/JS.** No framework, no bundler, no build step. The files
  in `split/` and `trip/` are served as-is by nginx.
- **Money is integer minor units** (whole rupiah for IDR). Never use floats for amounts.

## Running locally

Backend:

```bash
cd api
go run . -hashpw "dev"          # prints an ADMIN_PASSWORD_HASH
ADMIN_PASSWORD_HASH='<paste>' SESSION_SECRET=dev PASSCODE=1606 \
  DATA_DIR=/tmp/tripkit SEED_FILE=$PWD/seed/demo.json go run .
# API on http://localhost:8080
```

Frontend: serve the repo root with any static server and reverse-proxy `/api` to
`:8080`, or just use the bundled `docker compose up --build` (see README).

## Before opening a PR

- `cd api && gofmt -l . && go vet ./... && go build ./...` must be clean.
- `node --check split/app.js` must pass.
- Keep changes focused; match the existing style.
- **Never commit real personal data or secrets.** CI runs gitleaks; `.env` is gitignored.
