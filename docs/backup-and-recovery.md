# Command Center backups and recovery

Backups use the owner's Google Drive (`store17commandcenter@gmail.com`). There is no extra service or subscription.

## What is backed up

The Drive folder **Store 17 Command Center Backups** has five subfolders:

| Folder | Contents | When |
| --- | --- | --- |
| Spreadsheet copies | A full copy of the production workbook. That covers every tab: `CC_Config`, goal history, `CC_Imports`, `CC_Uploads`, `CC_Exceptions`, daily and monthly history, evaluation records, alerts and quality logs. | Every night, plus each **Back up now** |
| Report originals | One copy of every archived report file listed in `CC_SourceArchive` | Copied once per file, incrementally |
| Evaluation files | One copy of every approved evaluation file listed in `CC_EvalArchive` | Copied once per file, incrementally |
| Settings | Script settings that live outside the workbook (folder IDs, one-time flags) plus `CC_Config` and the trigger list, as JSON. Passwords, salts, sessions and email markers are deliberately excluded. | With each backup |
| Restore drills | The scratch copy made by the latest restore drill (older drill copies go to the Drive trash) | Weekly, plus each **Test restore** |

Every backup is checked before it is logged as `Verified`. Each tab of the copy is fingerprinted (an MD5 of its values) and compared with the same tab in production at the moment of the copy. Any difference is logged as `Needs Review`, together with the tab name.

- `CC_Backups` logs every backup and drill: time, status, file ID, tab and row counts, the data version and notes.
- `CC_BackupFiles` maps each original Drive file ID to its backup copy.

**Schedule.** The `scheduledBackup_` trigger runs every day at 2 AM New York time. It is installed automatically by the scheduled import, and also by the first **Back up now**. Each night it makes a workbook copy and continues copying archived files for up to four minutes in total. When the last drill is a week old, it also runs a restore drill.

**Retention.** The newest 30 workbook copies are kept, plus the first copy of every month. Older copies move to the Drive trash and are marked `Retired`.

## Restore drill (non-destructive)

Admins can run **System health → Backups and recovery → Test restore**, and it also runs weekly on its own. A drill:

1. copies the latest `Verified` backup into **Restore drills**. It refuses to run if that file ID is the production ID.
2. compares every restored tab with the fingerprints recorded at backup time.
3. points the dashboard code at the restored copy, with email and notices switched off, and builds Home, Daily, Closing, People, Morning meeting and Bedding from it. It also runs the quality checks on it.
4. when production has not changed since the backup, builds the same pages from production and requires them to be identical.
5. logs `Passed` or `Failed` with the reason. A failed drill is added to `CC_Exceptions`. It never writes to production; its only writes are its own log row and the scratch copy.

Last live drill: 2026-10-17 20:55 UTC, **Passed**. All 77 tabs (2,972 rows) restored from the 20:52 backup matched cell for cell. 6 of 6 dashboard pages built from the restored copy were identical to production. Quality checks on the copy gave 11 pass, 4 flag and 5 note, the same as production.

## Recovering

Always work from a copy. Never edit a backup file in place. In Drive, use **File → Make a copy** first.

### Pause imports first

In the Apps Script project, open **Triggers** and delete the `scheduledImport_` and `scheduledBackup_` triggers so nothing writes during the repair. You will reinstall them in the final step.

### A. One tab is damaged or rows were deleted

1. In `CC_Backups`, find the newest `Verified` spreadsheet copy from before the damage. Its `file_id` opens it at `https://docs.google.com/spreadsheets/d/<file_id>`.
2. Make a copy of that backup. In the copy, right-click the tab and choose **Copy to → Existing spreadsheet → Store 17 Command Center**.
3. In production, rename the damaged tab (for example `CC_Daily_damaged`), then rename the copied tab to the original name, such as `CC_Daily`.
4. Anything recorded after the backup's `run_at` is not in the restored tab. If the damaged tab still holds those newer rows, copy them across. Otherwise do not re-upload yet. An exact file already listed in `CC_Imports` is skipped as "Already on file", so the figure tabs and the import log must come from the same backup. Use B instead, then re-upload the reports dated after the backup on **Upload reports**.
5. Open **System health → Run checks now**. "Permanent history" must pass, and the daily register must match its source rows. Then delete the renamed damaged tab.

### B. The whole workbook is lost

1. Make a copy of the newest `Verified` backup and rename it **Store 17 Command Center**.
2. Set `SPREADSHEET_ID_` in `apps-script/Code.gs` to the new file's ID. Then run `npx @google/clasp push` and redeploy to the existing deployment, so the web app URL is unchanged.
3. Script properties belong to the script project, not the workbook, so passwords and folder IDs survive. If the script project itself was lost, re-create the settings from the newest JSON in **Settings**, then set the passwords again with `bootstrapPasswords_` (see the README).
4. Run `installDailyTrigger_` once. The edit trigger and the backup trigger are reinstalled by the next import.
5. Re-upload, on **Upload reports**, every report dated after the backup's `run_at`. Copies of the originals are in **Report originals**. Each figure is applied once.

### C. An archived report or evaluation file is lost

`CC_BackupFiles` gives the `backup_file_id` for each `source_file_id`.

1. Make a copy of the backup file into the original archive folder.
2. Put the new file ID in `CC_SourceArchive.drive_file_id` or `CC_EvalArchive.file_id` for that row.

The SHA-256 in the register lets you confirm it is the same file.

### Finish

1. Run `installDailyTrigger_` to reinstall the import trigger, then press **Back up now**.
2. Run **Test restore** and confirm it passes.
3. Run `node --experimental-strip-types server/auditMetrics.ts` from this repository. It must report 0 mismatches.

## Tests

- `server/backupAppsScript.test.ts` runs against a copy of the verified October workbook with an in-memory Drive. It covers backup verification, file copies, secrets excluded from settings, retention, a damaged backup failing the drill, and production staying unchanged.
- `server/regression.test.ts` covers the verified October figures.
