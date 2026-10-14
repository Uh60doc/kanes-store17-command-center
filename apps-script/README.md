# Kane's Management Command Center

Google Apps Script web app for Store 17. The spreadsheet `Store 17 Command Center` holds the figures. Gmail on `store17commandcenter@gmail.com` is watched for PDF reports. Managers sign in with a shared password. No paid host is required.

Sheet1 and `CC_Connection_Test` are historical. The app reads and writes only the `CC_` tabs added for this system.

## One-time owner setup

1. In the Google account `store17commandcenter@gmail.com`, open [Apps Script settings](https://script.google.com/home/usersettings) and turn on the Apps Script API.
2. From this repository, on a computer that can reach Google:

```bash
npx @google/clasp login
npx @google/clasp create --title "Kanes Management Command Center" --type webapp --rootDir apps-script
npx @google/clasp push
```

3. Open the script, enable the advanced Drive service if clasp did not, then run `bootstrapPasswords_` once. Before that run, set these script properties to passwords of at least 10 characters, then delete them by running the function (it removes the plaintext):

- `BOOTSTRAP_SALES`
- `BOOTSTRAP_MANAGER`
- `BOOTSTRAP_ADMIN`

Usernames are `sales`, `manager`, and `admin`.

4. Run `installDailyTrigger_` once. It checks Gmail every 30 minutes.
5. Deploy: `npx @google/clasp deploy --description "v1"` and choose **Execute as: Me** and **Who has access: Anyone**. The custom login, not a hidden URL, protects the figures.
6. Approve the requested Sheets, Gmail, Drive, and Mail permissions as `store17commandcenter@gmail.com`.

Changing a password in Admin signs that role out. The monthly goals live on `CC_Config` and are not rewritten by the daily pace. Selling days are marked `YES` on `CC_SellingDays`. Until that calendar is filled, today's goal stays Not Available.

## What the owner still has to do

The development environment cannot sign in to clasp for this account. Deployment and the first password setup require the owner steps above. Daily SNAP and NWDSR PDFs are not arriving in the command-center mailbox yet, so the unattended import has no new sales PDF to process. Send those reports to `store17commandcenter@gmail.com` as PDF attachments. PERQ messages in that mailbox are links, not files, and are not imported.
