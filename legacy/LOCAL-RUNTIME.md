# Local runtime, retired for production

The Node server in `server/` and the Vite page in `src/` are the previous office preview. They parse the archived PDFs and prove the October figures. They are not the production system.

Production is the Google Apps Script app in `apps-script/`. It does not need this computer, Cursor, or a local port. The local server remains because the one-time sheet seed still uses its tested PDF parser. Do not point managers at `localhost`.

The Kane's Ticket Tracker is a different project. Nothing in this folder changes it.
