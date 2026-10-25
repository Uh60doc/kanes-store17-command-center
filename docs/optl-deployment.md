# OPTL controlled launch (not executed)

Do not run these steps until the GM authorizes them. This branch is not deployed.

## What stays untouched

Sales spreadsheet, SNAP, NWDSR, PERQ, KPI, and monthly reporting code are not modified. OPTL refuses to open the sales spreadsheet id (`SPREADSHEET_ID_`).

## Create the dedicated book (one time, Apps Script editor)

1. Push this branch with clasp only after review (`clasp push` is a deploy-adjacent step — GM approval first).
2. In the script editor run `optlCreateDedicatedStore_`.
3. It creates **STORE 17 OPTL DATA**, saves `OPTL_SPREADSHEET_ID`, and seeds fictional demo employees.
4. Share that file with the GM, Sales Manager, and Operations Manager only. Do not share it with sales logins.
5. Confirm the id is not the sales workbook id.

Until that function runs, OPTL keeps fictional demo state in script properties so a refresh still reloads the last demo edit. That properties copy is not the production book.

## Email

Leave `emailEnabled` false, `testSendingDisabled` true, and `gmEmailAuthorized` false.

When the GM approves recipients, set `alertConfig.emailRecipients` to those addresses, then set the three flags. Subjects stay generic (`Store 17 OPTL: management attention required`) and omit incident text and employee names. Duplicate open alerts for the same employee and kind are not sent twice.

## Rollback

1. Clear script property `OPTL_SPREADSHEET_ID` (does not delete the OPTL file).
2. Redeploy the previous Command Center version from the Apps Script deployment list.
3. Leave **STORE 17 OPTL DATA** in Drive for recovery. Do not delete it to “undo” a bad release.
4. Sales reporting does not read OPTL tabs, so rolling OPTL back does not change SNAP/KPI figures.

## Still manual

Paper PIP signatures, Paycor upload, and the HR Kaneweb Termination Checklist.
