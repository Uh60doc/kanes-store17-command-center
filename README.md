# Store 17 Command Center

The permanent website for this repository is the October 2026 dashboard for Kane's Furniture Store 17, South Orlando, on Orange Blossom Trail.

Sign-in stays in front of the sales numbers. October management goals and corporate stretch goals stay sealed until that sign-in succeeds. The session and the opened numbers live in memory only. This site does not save the project, the session, or the sales numbers onto the computer.

This repository is not Ticket Tracker and it is not K17 LIVE.

Sales, bedding, attachment, closing ratio, year-over-year, pace, and graphs stay empty until a report snapshot is imported. Missing figures read **Awaiting Report** or **Not Available**.

## Import boundary

A report file becomes a snapshot only through `acceptIncomingReport` in `src/import/boundary.ts`.

Two later sources hand the same files to that function:

- Manual upload
- Company mailbox

Neither source is connected. The import boundary does not sign in to a mailbox or upload files. Website sign-in only opens the October dashboard. Parsing waits for real report samples. The boundary does not invent metrics, and it does not store a missing figure as zero.

## Website

GitHub Actions publishes this repository to GitHub Pages from `main`. The published site is the October dashboard for Store 17 Command Center.

## Scripts

- `npm run dev` — dashboard dev server
- `npm run build` — typecheck and production build
- `npm run lint` — oxlint
