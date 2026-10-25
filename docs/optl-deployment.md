# OPTL controlled launch (not executed)

Do not run these steps until the GM authorizes them. This branch is not deployed.

## What stays untouched

Sales spreadsheet, SNAP, NWDSR, PERQ, KPI, and monthly reporting code are not modified. OPTL refuses to open the sales spreadsheet id (`SPREADSHEET_ID_`).

## Put the code in the Apps Script editor without a new web-app version

This cloud environment cannot sign in as `store17commandcenter@gmail.com`. A push has to be done from a computer that can.

On that computer, in this repo, on branch `cursor/optl-phase1-404d`:

```bash
npx @google/clasp login
npx @google/clasp push
```

Do **not** run `clasp deploy`. `clasp push` updates the script editor only. The current production web-app deployment stays on its existing version.

Then open the script and confirm the function list includes `optlCreateDedicatedStore_`. Do not run it until you intend to create the fictional workbook.

## Create the dedicated book (one time, Apps Script editor)

1. In the editor, choose `optlCreateDedicatedStore_` and click Run. Approve the Sheets permission if Google asks.
2. It creates **STORE 17 OPTL DATA — FICTIONAL DEMO** in that Google account's Drive, saves `OPTL_SPREADSHEET_ID`, and seeds records named `FICTIONAL DEMO` with ids `S17-DEMO-*`. It does not open the sales spreadsheet and it does not send email.
3. Leave the file owned by `store17commandcenter@gmail.com`. Do not share it with the sales login. The three managers already use that account's Command Center password; the sheet itself is not a separate login.
4. Confirm the new file's id is not the sales workbook id.

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
