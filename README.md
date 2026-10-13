# Store 17 Command Center

Management dashboard for Kane's Furniture Store 17, South Orlando, on Orange Blossom Trail.

Phase 1 is the store dashboard for a desktop office monitor. October 2026 management goals and corporate stretch goals are configured targets. Sales, bedding, attachment, closing ratio, year-over-year, pace, and graphs stay empty until a report snapshot is imported. Missing figures read **Awaiting Report** or **Not Available**.

## Import boundary

A report file becomes a snapshot only through `acceptIncomingReport` in `src/import/boundary.ts`.

Two later sources hand the same files to that function:

- Manual upload
- Company mailbox

The local API can sign in to the existing Store 17 Google account and read the existing spreadsheet. Report parsing still waits for an accepted file. The boundary does not invent metrics, and it does not store a missing figure as zero.

## Google connection

`npm run dev` starts the dashboard on `http://localhost:5173` and the local API on `127.0.0.1:8787`. The browser talks only to the dashboard; Vite forwards `/api` to the API.

The OAuth client is a **Web application**. Its authorized redirect URI is `http://localhost:5173/api/google/oauth/callback`. Leave Authorized JavaScript origins blank. Put `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `SESSION_SECRET` in `.env.local` (see `.env.example`). The refresh token is written outside the repository, under `~/.config/store17-command-center/`. Automated report import stays off.

## Scripts

- `npm run dev` — dashboard and local Google API
- `npm run test` — API connection tests
- `npm run build` — typecheck and production build
- `npm run lint` — oxlint
