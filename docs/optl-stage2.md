# OPTL Stage 2–3 (spec v1.3) — forms, print, alerts

Branch: `cursor/optl-phase1-404d` · PR: https://github.com/Uh60doc/kanes-store17-command-center/pull/56  
Authority: `STORE17_OPTL_COMPLETE_CURSOR_SPEC_V1_3.md` (supersedes v1.2).

## Completed in this development build (synthetic only)

| Priority item | Status |
| --- | --- |
| Automatic occurrence → STEP progression (`ACTION_REQUIRED`, no auto-issue) | Done |
| 180-day occurrence expiry + 365-day STEP freeze/reset | Done |
| Cross-category (within section) + cross-section (independent A/B; dual STEP III → TERM_REQUIRED) | Done |
| Accountability / New Hire / Termination forms | Done (UI + engine) |
| Employee acknowledgment (typed name + checkbox / refusal; no SSN) | Done |
| Permanent history (active/expired/voided/rescinded) | Done |
| Automatic corrections + yellow/red integrity warnings | Done |
| Kane's **Personal Improvement Plan (PIP)** print + matrix/history/notes prints | Done |
| Management dashboard + Command Center alerts (email **not** sent) | Done |
| Scenario unit tests | Done (30 OPTL cases + nav) |

## Preview

Manager/admin → **Admin → OPTL**.

1. Confirm **acting manager** (manager-declared).
2. Use form tabs: Accountability Entry, New Hire, Termination, Acknowledgment, Correct/Void.
3. Dashboard shows pending / exceptions / in-app alerts.
4. Print: Active Matrix, History, Notes, Kane's PIP (HR approval language preserved; blank signature lines).

```bash
node --experimental-strip-types --test server/optlAppsScript.test.ts server/dashboardNav.test.ts
```

## Still blocked / demo

- No live `STORE 17 OPTL DATA` Sheet (demo state may use Script Properties only)
- No email send (`emailEnabled: false`, test sending disabled)
- No real employees / auto-termination / merge / deploy without GM approval
- Paycor upload remains manual after paper PIP signatures

## Hygiene

Retarget PR base to `cursor/monthly-sales-team-review-32b5` before merge review. Large commit count vs `main` is inherited CC history, not OPTL-only churn.
