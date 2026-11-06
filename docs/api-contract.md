# Form Builder MVP — API contract

Single source for backend (ASP.NET Core 10 Minimal APIs) and frontend (Angular). All paths under `/api`, JSON camelCase,
errors are RFC 9457 Problem Details (`application/problem+json`, `traceId`). Validation errors: `400` with
`errors: { "<key>": ["message"] }`. Dates are ISO-8601 UTC strings.

## Auth & CSRF

- Cookie authentication (`fb.auth`, HttpOnly, SameSite=Lax, `Secure` when the request is HTTPS — `CookieSecurePolicy.SameAsRequest`),
  sliding expiration 14 days. Unauthenticated `/api` calls → `401` problem (never a redirect).
- Passwords: `PasswordHasher<User>` (PBKDF2, Identity v3 format). Email normalised: trimmed + lower-invariant, unique.
- CSRF: ASP.NET Core antiforgery, double-submit. Every response of `GET /api/auth/session` and of sign-in / sign-up /
  sign-out writes the readable cookie `XSRF-TOKEN`; Angular sends it back as header `X-XSRF-TOKEN`. All mutating requests
  (POST/PUT/PATCH/DELETE) under `/api` require a valid token **except** `POST /api/public/forms/{publicId}/responses`
  (anonymous, no cookie authority). Missing/invalid token → `400` problem `title: "Invalid CSRF token"`.

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| GET | `/api/auth/session` | – | `200 {"user": {"email"} \| null}` + refreshes `XSRF-TOKEN` |
| POST | `/api/auth/sign-up` | `{email, password}` | `201 {"user":{"email"}}` signed in; `400` errors `email` / `password` |
| POST | `/api/auth/sign-in` | `{email, password}` | `200 {"user":{"email"}}`; `401` problem `title:"Email or password is incorrect."` |
| POST | `/api/auth/sign-out` | – | `204` |

Sign-up server messages (same text as the mockup): empty email `Enter your email address.`; bad format
`This email address is incomplete. Use the format name@example.com.` (format = `TextRules.IsEmail`, ≤254 chars);
taken `An account with this email already exists.`; empty password `Create a password with at least 8 characters.`;
short `Password is too short (N of 8 characters). Add M more character(s).`; password > 128 chars
`Use 128 characters or fewer.`

## Forms (authenticated; owner only — someone else's id ⇒ the same `404` as a missing id)

`FormSummary`:
```json
{ "id": "uuid", "title": "…", "status": "draft|published|closed", "liveVersion": 3, "hasUnpublishedChanges": true,
  "responseCount": 128, "updatedAt": "…", "publicId": "22-char base64url or null until first publish" }
```
`FormDetail` = FormSummary + `{ "draft": FormSchema, "liveSchema": FormSchema|null, "publishBlocker": string|null,
"versions": [{"number":1,"publishedAt":"…","responseCount":n}], "createdAt": "…" }`.
`FormSchema` = shared schema (`backend/src/FormBuilder.Api/Forms/Schema/FormSchema.cs`, `frontend/src/app/core/schema/form-schema.ts`).

| Method | Path | Result |
| --- | --- | --- |
| GET | `/api/forms?q=&status=` | `200 FormSummary[]`, sorted `updatedAt` desc; `q` = case-insensitive title substring; `status` = draft/published/closed |
| POST | `/api/forms` | `201 FormDetail` new draft (`FormSchema.NewDraft()`) |
| GET | `/api/forms/{id}` | `200 FormDetail` |
| PUT | `/api/forms/{id}/draft` | body `FormSchema` → `200 FormDetail`. `400` only for structural errors (`FormRules.StructuralErrors`). Configuration issues (incl. unsafe regex) are saved but reported via `publishBlocker`; unsafe patterns are never executed. |
| POST | `/api/forms/{id}/publish` | creates version N+1 = copy of draft. `400` problem with `errors.publish=[publishBlocker]` when blocked; `409` problem `title:"Nothing to publish"` when published and no unpublished changes. Draft→Published; Closed stays Closed. `200 FormDetail`. `publicId` (16 random bytes, base64url) assigned on first publish, never changes. |
| POST | `/api/forms/{id}/close` | Published→Closed (`409` if draft). `200 FormDetail` |
| POST | `/api/forms/{id}/reopen` | Closed→Published. `200 FormDetail` |
| DELETE | `/api/forms/{id}` | `204`; cascades versions + responses |

`hasUnpublishedChanges` = has a live version AND canonical draft JSON ≠ live version JSON. `updatedAt` changes on every
draft save / publish / close / reopen.

## Responses (authenticated owner)

`ResponseItem`: `{ "id":"uuid", "number":128, "submittedAt":"…", "version":3, "answers": { "<blockId>": "text" | ["a","b"] } }`

| Method | Path | Result |
| --- | --- | --- |
| GET | `/api/forms/{id}/responses?page=1&pageSize=10` | `200 {"total":128,"page":1,"pageSize":10,"items":[ResponseItem]}` newest first; pageSize 1–100 |
| GET | `/api/forms/{id}/responses/{responseId}` | `200 ResponseItem + {"schema": FormSchema of its version, "index": 2, "total": 128, "prevId": uuid\|null (newer), "nextId": uuid\|null (older)}` |
| DELETE | `/api/forms/{id}/responses/{responseId}` | `204` |
| GET | `/api/forms/{id}/responses/export.csv` | `200 text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="<slug>-responses.csv"` |

CSV: UTF-8 BOM; RFC 4180 (CRLF rows, fields with `"` `,` CR LF quoted, `"` doubled); cells and headers starting with
`=` `+` `-` `@` TAB CR get a leading `'`. Columns: `Response`, `Submitted (UTC)` (`yyyy-MM-dd HH:mm:ss`), `Version`, then every
input field of every version: fields of the latest version in its order, then fields removed later (ordered by the
latest version they existed in, descending, then their order there). Header = label in the latest version containing the field.
Multi-value answers joined with `; `. Missing field in the response's version → empty cell.

## Public (anonymous)

| Method | Path | Result |
| --- | --- | --- |
| GET | `/api/public/forms/{publicId}` | `200 {"publicId","version":3,"status":"open","schema":FormSchema}`; closed → `200 {"publicId","status":"closed","title":"…"}`; unknown / malformed id / never published → `404` problem `title:"Form not available"` |
| POST | `/api/public/forms/{publicId}/responses` | body `{"version":3,"answers":{…},"website":""}` → `201 {"number": 129}`. `400` errors keyed by block id (shared rules, the version the respondent saw). Unknown version → `409` problem `title:"Form version not available"` `detail:"This form was updated. Reload the page to see the latest version."`. Closed → `409` problem `title:"Form closed"`. Not available → `404`. Honeypot `website` non-empty → `201` with no row stored. Rate limited → `429` + `Retry-After` seconds. |

Unknown answer keys are ignored; answers for non-input blocks ignored. "today" for date rules on the server =
`DateTime.UtcNow.AddHours(14)` date (latest calendar date on Earth), so respondents in any timezone are never rejected
for "today"; the client uses its local date.

## Limits

Request body: 512 KB (`Kestrel MaxRequestBodySize`), public submission body 64 KB. Schema limits: `Limits` class
(100 blocks, 50 options × 200 chars, label 500, help 1000, pattern 200, short answer 1000, long answer 10000, email 254).
Forms per user: 500. Responses per form: unlimited.

## Rate limits (fixed window per client IP; `ForwardedHeaders` trusts the Caddy proxy on private networks)

- `auth`: sign-in + sign-up, 10 requests / minute / IP (`RateLimits__AuthPermitLimit`, `RateLimits__WindowSeconds`).
- `submit`: public submissions, 10 / minute / IP+publicId (`RateLimits__SubmitPermitLimit`).
- `429` problem `title:"Too many requests"` + `Retry-After` header (seconds).
