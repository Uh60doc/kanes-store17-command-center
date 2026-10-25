# OPTL Phase 1 — Admin page

OPTL is a **new Admin dropdown page** on the live Store 17 Command Center (Apps Script). Home, Sales Team, and other existing screens are not redesigned.

## Where it lives

- Nav: **Admin → OPTL**
- Backend: `apps-script/Optl.gs` (`optl_` route)
- UI: `renderOptl` in `apps-script/Index.html`
- Access: manager and admin (sales cannot open it)

## Phase 1 scope

- Demo associates / events only
- Active matrix + permanent history
- +180 local-day unlinked occurrence expiration + left compaction
- Print Active Matrix (Store 17 mark)
- Entry / PIP escalation / live personnel Sheet: later phases

## Tests

```bash
node --experimental-strip-types --test server/optlAppsScript.test.ts server/dashboardNav.test.ts
```
