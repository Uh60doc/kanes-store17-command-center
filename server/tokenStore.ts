import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface StoredGoogleAuth {
  refreshToken: string;
  email: string | null;
  scopes: string[];
  spreadsheetId: string | null;
  sheetReadAt: string | null;
  testWriteAt: string | null;
  gmailReadAt: string | null;
  updatedAt: string;
}

export function emptyAuth(): StoredGoogleAuth {
  return {
    refreshToken: '',
    email: null,
    scopes: [],
    spreadsheetId: null,
    sheetReadAt: null,
    testWriteAt: null,
    gmailReadAt: null,
    updatedAt: new Date(0).toISOString(),
  };
}

export function readStored(tokenPath: string): StoredGoogleAuth {
  try {
    const parsed = JSON.parse(readFileSync(tokenPath, 'utf8')) as Partial<StoredGoogleAuth>;
    return {
      ...emptyAuth(),
      ...parsed,
      refreshToken: typeof parsed.refreshToken === 'string' ? parsed.refreshToken : '',
      scopes: Array.isArray(parsed.scopes) ? parsed.scopes.filter((scope) => typeof scope === 'string') : [],
      email: typeof parsed.email === 'string' ? parsed.email : null,
      spreadsheetId: typeof parsed.spreadsheetId === 'string' ? parsed.spreadsheetId : null,
    };
  } catch {
    return emptyAuth();
  }
}

export function writeAuth(tokenPath: string, auth: StoredGoogleAuth): void {
  const directory = path.dirname(tokenPath);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    chmodSync(directory, 0o700);
  } catch {
    // Windows may refuse the Unix mode. The file still stays outside the repository.
  }
  const temporary = `${tokenPath}.tmp`;
  writeFileSync(temporary, JSON.stringify(auth), { mode: 0o600 });
  try {
    chmodSync(temporary, 0o600);
  } catch {
    // The token file is still outside git when the mode cannot be set.
  }
  renameSync(temporary, tokenPath);
  try {
    chmodSync(tokenPath, 0o600);
  } catch {
    // Same as above.
  }
}
