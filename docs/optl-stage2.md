# OPTL Stage 2 (spec v1.3) — in development

Branch: `cursor/optl-phase1-404d` · PR: https://github.com/Uh60doc/kanes-store17-command-center/pull/56  
Authority: `STORE17_OPTL_COMPLETE_CURSOR_SPEC_V1_3.md` (paste / supersedes v1.2).

## What Stage 2 delivers (synthetic only)

| Item | Status |
| --- | --- |
| Scored-event validation (>15 min Tardy; 16–119 vs 120+ Attendance) | Done + tested |
| Demo tardies corrected to 22 / 25 minutes | Done |
| Progression 4→STEP I→2→STEP II→1→STEP III→1→TERM_REQUIRED | Engine + tested |
| Pending STEP/TERM lock; unscored factual notes still allowed | Done + tested |
| Cross-category section escalation; dual STEP III → TERM_REQUIRED | Done + tested |
| +180 occ / +365 STEP expiry; linked chain freeze on issue | Done + tested |
| Late STEP issuance clock = incident date | Done + tested |
| Void → rescission cascade + yellow/red exceptions | Done + tested |
| Rehire: same ID, new period, clean matrix, prior history kept | Done + tested |
| Acting manager declared + confirmed (shared login) | UI + engine gate |
| Acknowledgment policy: typed name + checkbox, no SSN | Spec in payload |
| Alerts: Command Center planned; email disabled / no test send | Config only |
| Live Sheet / email / auto-TERM / deploy / merge | **Blocked** |

## Files

- `apps-script/Optl.gs` — demo seed, page payload, Phase 1 helpers
- `apps-script/OptlEngine.gs` — Stage 2 engine (NEW)
- `apps-script/Index.html` — Stage 2 banners, acting manager, policy panel
- `apps-script/Code.gs` — `optl` route (unchanged beyond Phase 1)
- `server/optlAppsScript.test.ts` — Phase 1 + Stage 2 regressions
- `server/dashboardNav.test.ts` — Admin → OPTL

## Preview the actual screen

1. Open the live Store 17 Command Center (existing Apps Script web app — **do not** use the Vite board).
2. Sign in as **manager** or **admin** (sales cannot open OPTL).
3. Top nav → **Admin** → **OPTL**.
4. Select associates:
   - **Jordan Lee** — pending STEP I lock (Safety ×4)
   - **Taylor Brooks** — issued STEP I + frozen chain
   - **Alex Rivera** — valid tardies + mixed history
5. Select / confirm an **acting manager** (labeled manager-declared).
6. Optional: Print Active Matrix (overlay print).

Until `clasp push` is authorized for this branch, run unit tests locally:

```bash
node --experimental-strip-types --test server/optlAppsScript.test.ts server/dashboardNav.test.ts
```

## Still demo / not live

Employee IDs, in-memory engine (no Sheet), entry/TERM forms, email send, PIP print from Kane's template, deployment, merge.

## Stop line

No live personnel Sheet, no real employees, no email, no auto-termination, no merge/deploy without GM approval.
