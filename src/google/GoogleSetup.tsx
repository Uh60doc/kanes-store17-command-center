import { useEffect, useState } from 'react';

interface Setup {
  projectId: string;
  expectedEmail: string;
  expectedSheetTitle: string;
  oauthClientType: string;
  redirectUri: string;
  scopes: { identity: string[]; sheets: string; gmail: string };
  testTab: string;
  automatedImportsEnabled: boolean;
  configured: boolean;
  missing: string[];
  signedIn?: boolean;
  connected?: boolean;
  email?: string | null;
  spreadsheetId?: string | null;
  sheetReadAt?: string | null;
  testWriteAt?: string | null;
  gmailReadAt?: string | null;
  sheetsGranted?: boolean;
  gmailGranted?: boolean;
}

interface ReadResult {
  title: string;
  titleMatches: boolean;
  sheets: { title: string }[];
  preview: { sheetTitle: string; rows: string[][] } | null;
}

interface GmailResult {
  email?: string;
  imported: boolean;
  attachmentsDownloaded: boolean;
  messages: { id: string; subject: string; from: string; date: string; attachmentNames: string[] }[];
}

async function postJson(path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(payload.error || 'The request failed.');
  return payload;
}

export function GoogleSetup() {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [offline, setOffline] = useState(false);
  const [spreadsheet, setSpreadsheet] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [readResult, setReadResult] = useState<ReadResult | null>(null);
  const [gmailResult, setGmailResult] = useState<GmailResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh(): Promise<void> {
    try {
      const response = await fetch('/api/google/status');
      if (!response.ok) throw new Error('status');
      setSetup((await response.json()) as Setup);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('google') === 'connected') setMessage('Google connected. Read the existing spreadsheet next.');
    if (params.get('google') === 'error') setError(params.get('reason') || 'Google sign-in did not finish.');
    void refresh();
  }, []);

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError('');
    try {
      await action();
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The request failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="google-setup">
      <section className="card">
        <p className="eyebrow">Google Cloud · {setup?.projectId ?? 'store-17-command-center'}</p>
        <h1>Connect the existing spreadsheet and mailbox</h1>
        <p className="detail">
          The dashboard keeps the OAuth client secret and refresh token on the local API. They are not compiled into the
          page and they are not stored in Git.
        </p>
      </section>

      <section className="card">
        <h2>Create this OAuth client</h2>
        <dl className="facts">
          <div>
            <dt>Client type</dt>
            <dd>Web application</dd>
          </div>
          <div>
            <dt>Authorized redirect URI</dt>
            <dd>
              <code>{setup?.redirectUri ?? 'http://localhost:5173/api/google/oauth/callback'}</code>
            </dd>
          </div>
          <div>
            <dt>Authorized JavaScript origins</dt>
            <dd>Leave this blank. The browser does not run the Google sign-in script.</dd>
          </div>
        </dl>
        <h3>Permissions</h3>
        <ul className="scope-list">
          <li>
            <code>openid</code> and <code>https://www.googleapis.com/auth/userinfo.email</code> — confirm the account is{' '}
            {setup?.expectedEmail ?? 'store17commandcenter@gmail.com'}.
          </li>
          <li>
            <code>{setup?.scopes.sheets ?? 'https://www.googleapis.com/auth/spreadsheets'}</code> — read the existing
            workbook, then write only the <code>{setup?.testTab ?? 'CC_Connection_Test'}</code> tab.
          </li>
          <li>
            <code>{setup?.scopes.gmail ?? 'https://www.googleapis.com/auth/gmail.readonly'}</code> — read mail. Requested
            only when you start the Gmail test. Nothing is sent, deleted, or imported.
          </li>
        </ul>
        <p className="detail">Automated report import is {setup?.automatedImportsEnabled ? 'on' : 'off'}.</p>
      </section>

      {offline ? (
        <p className="banner warn">The local API is not running. Start it with npm run dev, then reload this page.</p>
      ) : null}
      {setup && !setup.configured ? (
        <p className="banner warn">
          Add {setup.missing.join(', ')} to <code>.env.local</code>, then restart <code>npm run dev</code>.
        </p>
      ) : null}
      {message ? <p className="banner ok">{message}</p> : null}
      {error ? <p className="banner warn">{error}</p> : null}

      <section className="card">
        <h2>1. Point at the existing spreadsheet</h2>
        <p className="detail">Paste the URL of “{setup?.expectedSheetTitle ?? 'Store 17 Command Center'}”. This does not create a workbook.</p>
        <form
          className="sheet-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await postJson('/api/google/spreadsheet', { spreadsheet });
              setMessage('Spreadsheet URL saved on the server.');
            });
          }}
        >
          <input
            aria-label="Existing spreadsheet URL"
            value={spreadsheet}
            onChange={(event) => setSpreadsheet(event.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/..."
          />
          <button type="submit" disabled={busy || offline}>
            Save spreadsheet
          </button>
        </form>
        {setup?.spreadsheetId ? <p className="detail">Saved spreadsheet id: {setup.spreadsheetId}</p> : null}
      </section>

      <section className="card">
        <h2>2. Sign in and read</h2>
        <div className="button-row">
          <a className="button" href="/api/google/oauth/start?purpose=sheets">
            Connect Google Sheets
          </a>
          <button
            type="button"
            disabled={busy || offline}
            onClick={() =>
              void run(async () => {
                await postJson('/api/google/resume');
                setMessage('Resumed the saved server connection.');
              })
            }
          >
            Resume saved connection
          </button>
          <button
            type="button"
            disabled={busy || !setup?.connected}
            onClick={() =>
              void run(async () => {
                const result = (await postJson('/api/google/sheets/read')) as ReadResult;
                setReadResult(result);
                setMessage(result.titleMatches ? `Read “${result.title}”.` : `Read “${result.title}”. The title does not match the expected workbook.`);
              })
            }
          >
            Read spreadsheet
          </button>
        </div>
        {setup?.email ? <p className="detail">Connected account: {setup.email}</p> : null}
        {readResult ? (
          <>
            <p className="detail">Tabs: {readResult.sheets.map((sheet) => sheet.title).join(', ') || 'none'}.</p>
            {readResult.preview ? (
              <div className="table-wrap">
                <p className="detail">First rows of {readResult.preview.sheetTitle}</p>
                <table>
                  <tbody>
                    {readResult.preview.rows.map((row, index) => (
                      <tr key={`${readResult.preview?.sheetTitle ?? 'sheet'}-${index}`}>
                        {row.map((cell, cellIndex) => (
                          <td key={cellIndex}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        ) : null}
      </section>

      <section className="card">
        <h2>3. Write a separate test tab</h2>
        <p className="detail">
          This adds or updates only <code>{setup?.testTab ?? 'CC_Connection_Test'}</code>. Other tabs stay as they are.
        </p>
        <button
          type="button"
          disabled={busy || !setup?.sheetReadAt}
          onClick={() =>
            void run(async () => {
              await postJson('/api/google/sheets/write-test');
              setMessage('Wrote the connection test tab.');
            })
          }
        >
          Write test tab
        </button>
        {setup?.testWriteAt ? <p className="detail">Last test write: {setup.testWriteAt}</p> : null}
      </section>

      <section className="card">
        <h2>4. Gmail read-only test</h2>
        <p className="detail">Grant Gmail after the sheet tests. This lists up to five messages with PDF attachments and does not download or import them.</p>
        <div className="button-row">
          <a className="button" href="/api/google/oauth/start?purpose=gmail">
            Grant Gmail read-only
          </a>
          <button
            type="button"
            disabled={busy || !setup?.gmailGranted}
            onClick={() =>
              void run(async () => {
                const result = (await postJson('/api/google/gmail/read-test')) as GmailResult;
                setGmailResult(result);
                setMessage(`Gmail read ${result.messages.length} message${result.messages.length === 1 ? '' : 's'}. Nothing was imported.`);
              })
            }
          >
            Test Gmail read
          </button>
        </div>
        {gmailResult ? (
          <ul className="mail-list">
            {gmailResult.messages.map((message) => (
              <li key={message.id}>
                <strong>{message.subject || '(no subject)'}</strong>
                <span>{message.date}</span>
                <span>{message.attachmentNames.join(', ') || 'No PDF filename on the message'}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {gmailResult?.messages.length === 0 ? <p className="detail">No PDF attachments were found in the recent mailbox search.</p> : null}
      </section>
    </main>
  );
}
