# Store 17 Command Center

Management dashboard for Kane's Furniture Store 17, South Orlando, on Orange Blossom Trail.

The production app is the Google Apps Script project in `apps-script/`. It uses the existing Store 17 spreadsheet and the `store17commandcenter@gmail.com` mailbox. Setup and the remaining owner steps are in `apps-script/README.md`. The Vite page and `server/` folder are the local archive described in `legacy/LOCAL-RUNTIME.md`. The Ticket Tracker is a separate system and is not part of this repository.

Phase 1 is the store dashboard for a desktop office monitor. October 2026 management goals and corporate stretch goals are configured targets. Sales, bedding, attachment, closing ratio, year-over-year, pace, and graphs stay empty until a report snapshot is imported. Missing figures read **Awaiting Report** or **Not Available**.

## Reporting calendars

The subject picks the calendar. Store reports, store KPIs, and the store closing ratio use the 2nd of the month through the 1st of the next month. Individual reports, compensation, and individual closing ratios use the 1st through the last calendar day of the month. The closing-ratio goal is 50% for the store and for each salesperson. Closing Ratio = Net Written # OF CUST ÷ PERQ Ups + Be Backs. Below 50.0% is Below Goal, exactly 50.0% is On Target, and above 50.0% is Above Goal. A missing report shows Pending, and an individual's purchasing customers stay Awaiting Verified Data until a source reports them per salesperson. Daily records keep the date printed on them. Each view filters those dates on its own.

A verified PERQ snapshot is cumulative. The October reference file stays outside Git at `~/.config/store17-command-center/reference/perq-october-2026.json`. Closing ratio is Net Written `# OF CUST` divided by PERQ `Ups + Be Backs` for the same dates. Month to date adds those counts, then divides. A missing count stays Not Available.

## Import boundary

A report file becomes a snapshot only through `acceptIncomingReport` in `src/import/boundary.ts`.

Two later sources hand the same files to that function:

- Manual upload
- Company mailbox

The local API can sign in to the existing Store 17 Google account, read the existing spreadsheet, and write only the `CC_Connection_Test` tab. A PDF handed to `acceptIncomingReport` is parsed and checked for a duplicate file hash. The local API does not download mail or write sales tabs. The cloud seed and the Apps Script app write the separate `CC_` tabs. Sheet1 and `CC_Connection_Test` stay as they were. The boundary does not invent metrics, and it does not store a missing figure as zero.

## Google connection

`npm run dev` starts the dashboard on `http://localhost:5173` and the local API on `127.0.0.1:8787`. The browser talks only to the dashboard; Vite forwards `/api` to the API.

The OAuth client is a **Web application**. Its authorized redirect URI is `http://localhost:5173/api/google/oauth/callback`. Leave Authorized JavaScript origins blank. Put `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `SESSION_SECRET` in `.env.local` (see `.env.example`). The refresh token is written outside the repository, under `~/.config/store17-command-center/`. Automated report import stays off.

## Scripts

- `npm run dev` — dashboard and local Google API
- `npm run test` — API connection tests
- `npm run build` — typecheck and production build
- `npm run lint` — oxlint
