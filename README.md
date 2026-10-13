# Store 17 Command Center

Management dashboard for Kane's Furniture Store 17, South Orlando, on Orange Blossom Trail.

Phase 1 is the store dashboard for a desktop office monitor. October 2026 management goals and corporate stretch goals are configured targets. Sales, bedding, attachment, closing ratio, year-over-year, pace, and graphs stay empty until a report snapshot is imported. Missing figures read **Awaiting Report** or **Not Available**.

## Import boundary

A report file becomes a snapshot only through `acceptIncomingReport` in `src/import/boundary.ts`.

Manual upload and the company mailbox both stay disconnected. They hand files to that same function when they are connected later. This app does not sign in to a mailbox.

The management sheet is a separate source. The page stays behind the sign-in. After a valid password, the server reads the sheet and the dashboard maps those rows. A newer snapshot for the same metric and date range replaces the older one. Snapshots are not added together. A blank cell, or a cell that says Not Available, stays Not Available or Awaiting Report. It is never stored as zero.

The password and the sheet address belong in the server environment (`COMMAND_CENTER_PASSWORD` and `COMMAND_CENTER_SHEET_CSV_URL`). Do not prefix them with `VITE_`, and do not commit them. See `.env.example`. October 2026 is the first loaded period, not the whole life of the dashboard.

## Scripts

- `npm run dev` — local dashboard
- `npm run build` — typecheck and production build
- `npm run lint` — oxlint
