# Store 17 Command Center

Management dashboard for Kane's Furniture Store 17, South Orlando, on Orange Blossom Trail.

Phase 1 is the store dashboard for a desktop office monitor. October 2026 management goals and corporate stretch goals are configured targets. Sales, bedding, attachment, closing ratio, year-over-year, pace, and graphs stay empty until a report snapshot is imported. Missing figures read **Awaiting Report** or **Not Available**.

## Import boundary

A report file becomes a snapshot only through `acceptIncomingReport` in `src/import/boundary.ts`.

Two later sources hand the same files to that function:

- Manual upload
- Company mailbox

Neither source is connected. This slice does not sign in to a mailbox, ask for credentials, or upload files. Parsing waits for real report samples. The boundary does not invent metrics, and it does not store a missing figure as zero.

## Scripts

- `npm run dev` — local dashboard
- `npm run build` — typecheck and production build
- `npm run lint` — oxlint
