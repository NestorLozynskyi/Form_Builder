# Form Builder

Web app for building forms, publishing them at a public link and collecting responses (MVP).
Authors sign up, build a form in a visual editor (palette · canvas · properties), publish immutable versions and
read / delete / export responses; respondents fill the published form anonymously.

| Layer | Technology |
| --- | --- |
| Frontend | Angular 22 (standalone, zoneless, Signals, Reactive Forms, CDK Drag & Drop), TypeScript 6 |
| Backend | ASP.NET Core 10 Minimal APIs, cookie auth + antiforgery, rate limiting, RFC 9457 Problem Details |
| Database | PostgreSQL 18, EF Core 10 + Npgsql, EF Core migrations |
| Tests | xUnit v3 + Testcontainers (backend), Vitest (frontend), Playwright (e2e through Caddy) |
| Runtime | Docker Compose, Caddy 2 (SPA + `/api` reverse proxy, security headers, HTTPS-ready) |

Design: approved HTML mockups; the design-system stylesheet is used verbatim
(`frontend/src/styles/fb.css`), icons are the same sprite (`frontend/src/index.html`).

## Repository layout

```
backend/src/FormBuilder.Api/
  Auth/            sign-up / sign-in / sign-out / session
  Forms/           forms CRUD, draft autosave, publish / close / reopen
  Forms/Schema/    shared form schema + validation rules + safe regex (mirrored in TypeScript)
  Responses/       list / detail / delete, CSV export
  Public/          anonymous form view + submission
  Infrastructure/  security (cookies, CSRF, rate limits, body limits, forwarded headers), Problem Details
  Data/            EF Core model + migrations
backend/tests/     xUnit (real PostgreSQL via Testcontainers) incl. SharedVectorsTests
frontend/src/app/
  core/            API client, auth, schema, validation (rules.ts, safe-pattern.ts), theme, toasts, accent maths
  pages/           auth, forms, editor, preview, public, responses, system (404 / error)
  shared/          header, status badges, form renderer (public form + preview)
shared/validation-vectors.json   one set of validation vectors run by BOTH Vitest and xUnit
e2e/               Playwright tests + scripts/screenshots.mjs (evidence) + lib/seed.mjs
deploy/caddy/      Caddyfile + Dockerfile (builds the SPA, serves it with Caddy)
docs/              api-contract.md, http-examples.txt, screenshots/, samples/ (CSV)
```

## Run with Docker (recommended)

```bash
cp .env.example .env          # optional, defaults work as-is
docker compose up -d --build --wait
open http://127.0.0.1:8180    # CADDY_HTTP_PORT
```

Services: `postgres` (named volume, **not published** to the host), `backend` (applies migrations on start,
healthcheck `/api/health`), `caddy` (SPA + `/api` proxy). Stop: `docker compose down`; reset: `docker compose down -v`.

HTTPS for a real domain: `SITE_ADDRESS=forms.example.com`, `ACME_EMAIL=…`, `CADDY_BIND_ADDRESS=0.0.0.0`,
`CADDY_HTTP_PORT=80`, `CADDY_HTTPS_PORT=443`. Cookies then get the `Secure` flag automatically (same-as-request).

## Run without Docker (development)

```bash
docker compose -f compose.yaml -f compose.db-port.yaml up -d --wait postgres     # PostgreSQL on host port 5442
cd backend
export ConnectionStrings__Default="Host=localhost;Port=5442;Database=formbuilder;Username=formbuilder;Password=formbuilder"
export Database__ApplyMigrationsOnStartup=true
dotnet run --project src/FormBuilder.Api --launch-profile http                   # http://localhost:5180
cd ../frontend && npm ci && npm start                                            # http://localhost:4210, /api proxied
```

`NODE_ENV=production` in your shell makes npm skip devDependencies; `frontend/.npmrc` and `e2e/.npmrc` contain
`include=dev` to counter that.

## Tests

```bash
# Backend: xUnit on a real PostgreSQL (Testcontainers; needs Docker)
cd backend && dotnet test
#   Colima: DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock dotnet test

# Frontend: Vitest (incl. shared validation vectors), lint, type-check, production build
cd frontend && npm test -- --watch=false && npm run lint && npx tsc -p tsconfig.app.json --noEmit && npm run build

# E2E through Caddy (stack must be running): main flow on desktop 1440 + mobile 390, theme switching
cd e2e && npm ci && npx playwright install chromium && npx playwright test
node scripts/screenshots.mjs all     # regenerates docs/screenshots/app (seeds its own accounts)
```

E2E and the screenshot script create their own accounts; they respect the default rate limits (10 sign-ins/sign-ups
per minute per IP, 10 submissions per minute per IP and form). Running them back-to-back within a minute can hit
those limits — wait a minute or raise `RATE_LIMIT_*` in `.env`.

## How it works

- **Form schema** — one JSON shape (`FormSchema`: title, description, success message, accent, blocks) used by
  the draft and every published version. Block ids are random and stable across versions, so "the same field" in
  different versions is the same id (field identity for responses and CSV).
- **Versions** — Publish copies the draft into an immutable `form_versions` row (v1, v2, …; a DB trigger rejects
  updates). Respondents always get the latest version; the draft can change freely ("Unpublished changes" =
  draft JSON ≠ live version JSON). Closed forms stay closed when "Publish changes" creates a new version.
- **Responses** are bound to the version they were submitted to; the detail view merges the response's version
  with the live one ("Not in version N", "Removed in vN").
- **Shared validation** — `Forms/Schema/FormRules.cs` + `TextRules.cs` + `SafePattern.cs` and their TypeScript
  twins in `frontend/src/app/core/validation/` implement the same rules and messages. `shared/validation-vectors.json`
  (answers, configuration issues, regex patterns) is executed by both Vitest and xUnit. The server re-validates
  every submission against the version the respondent saw; a submission to a version that doesn't exist gets
  `409 Form version not available`.
- **Safe regex** — custom patterns are parsed into a small AST: literals, escapes `\d \w \s \D \W \S \t \n \r \f \v
  \uXXXX \xHH`, classes `[...]`/`[^...]` with ranges, `.`, `^`, `$`, groups `(...)`/`(?:...)`, `|`, greedy `* + ?
  {n} {n,} {n,m}` (≤100). Rejected: nested quantifiers (`(a+)+`), back-references, lookaround, named groups,
  lazy/possessive quantifiers, `\b`, Unicode classes, inline flags, patterns > 200 chars or > 2,000 states. The
  server runs the translated pattern with `RegexOptions.NonBacktracking` + 250 ms timeout; the client simulates the
  same AST with a linear-time NFA. Unsafe patterns can be saved in a draft (shown as configuration errors, never
  executed) but block publishing.
- **Security** — PBKDF2 password hashes (`PasswordHasher`); HttpOnly SameSite=Lax session cookie (`Secure` over
  HTTPS); antiforgery double-submit (`XSRF-TOKEN` cookie → `X-XSRF-TOKEN` header) on every mutating API call
  except anonymous submissions; ownership checked in every query (someone else's id = the same 404); rate limits;
  honeypot field; request size limits (512 KB, 64 KB for submissions); Angular renders all user text as text;
  Caddy adds CSP, `X-Frame-Options`, `nosniff`, `Referrer-Policy` and `X-Robots-Tag: noindex` on `/f/*`
  (the page also sets `<meta name="robots" content="noindex">`).
- **CSV** — UTF-8 with BOM, RFC 4180 quoting, formula-injection neutralisation (`'` prefix for `= + - @ TAB CR`,
  headers too), columns = response, submitted (UTC), version, then every input field of every version (current
  order first, then removed fields), multi-choice joined with `; `.

API: `docs/api-contract.md`; request/response examples: `docs/http-examples.txt`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `ConnectionStrings__Default` | — (required) | Npgsql connection string |
| `Database__ApplyMigrationsOnStartup` | `false` (compose: `true`) | apply migrations at startup |
| `RateLimits__AuthPermitLimit` / `RATE_LIMIT_AUTH_PER_WINDOW` | `10` | sign-in + sign-up per IP per window |
| `RateLimits__SubmitPermitLimit` / `RATE_LIMIT_SUBMIT_PER_WINDOW` | `10` | submissions per IP per form per window |
| `RateLimits__WindowSeconds` / `RATE_LIMIT_WINDOW_SECONDS` | `60` | window length |
| `ASPNETCORE_HTTP_PORTS` | `8080` in container | Kestrel port |

Compose / tooling variables: see `.env.example` (`COMPOSE_PROJECT_NAME`, `CADDY_*`, `SITE_ADDRESS`, `ACME_EMAIL`,
`POSTGRES_*`, `APPLY_MIGRATIONS_ON_STARTUP`, `RATE_LIMIT_*`, `E2E_BASE_URL`, `API_PROXY_TARGET`).
Ports: Caddy 8180 (HTTP) / 8543 (HTTPS), backend dev 5180, Angular dev 4210, optional PostgreSQL 5442.

Migrations: `backend/src/FormBuilder.Api/Data/Migrations` (`dotnet tool restore`, then
`dotnet ef migrations add <Name> -p src/FormBuilder.Api -o Data/Migrations`).

## License

Released under the [MIT License](LICENSE). Copyright (c) 2026 Nestor Lozynskyi.
