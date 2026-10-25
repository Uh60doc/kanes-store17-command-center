# OPTL Phase 1 — Admin page (superseded by Stage 2 / v1.3)

OPTL is a **new Admin dropdown page** on the live Store 17 Command Center (Apps Script). Home, Sales Team, and other existing screens are not redesigned.

**Current authority:** spec v1.3 (Stage 2 in development). See `docs/optl-stage2.md`.

## Where it lives

- Nav: **Admin → OPTL**
- Backend: `apps-script/Optl.gs` + `apps-script/OptlEngine.gs` (`optl_` route)
- UI: `renderOptl` in `apps-script/Index.html`
- Access: manager and admin (sales cannot open it)

## Phase 1 completed

- Demo associates / events only (tardies corrected to >15 min under v1.3)
- Active matrix (STEP I/II/III labels) + permanent history
- +180 local-day unlinked occurrence expiration + left compaction
- Late rule: 0–15 none; 16–119 Tardy; **120+ Attendance**
- Print Active Matrix prototype (Store 17 mark)

## Tests

```bash
node --experimental-strip-types --test server/optlAppsScript.test.ts server/dashboardNav.test.ts
```

