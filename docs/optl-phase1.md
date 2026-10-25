# OPTL Phase 1 — Admin page (spec v1.2)

OPTL is a **new Admin dropdown page** on the live Store 17 Command Center (Apps Script). Home, Sales Team, and other existing screens are not redesigned. Spec: packet `STORE17_OPTL_COMPLETE_CURSOR_SPEC_V1_2.md`.

## Where it lives

- Nav: **Admin → OPTL**
- Backend: `apps-script/Optl.gs` (`optl_` route)
- UI: `renderOptl` in `apps-script/Index.html`
- Access: manager and admin (sales cannot open it)

## Phase 1 scope

- Demo associates / events only
- Active matrix (STEP I/II/III labels) + permanent history
- +180 local-day unlinked occurrence expiration + left compaction
- Late rule: 0–15 none; 16–119 Tardy; **120+ Attendance**
- Print Active Matrix prototype (Store 17 mark)
- Entry / STEP engine / live personnel Sheet: Phase 2+

## Tests

```bash
node --experimental-strip-types --test server/optlAppsScript.test.ts server/dashboardNav.test.ts
```
