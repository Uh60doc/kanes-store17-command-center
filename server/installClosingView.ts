/**
 * Add the calculated closing-ratio tabs to the command center spreadsheet. Safe to run again.
 * CC_Closing and every other tab are left as they are.
 *
 *   node --experimental-strip-types server/installClosingView.ts
 */

import { SHEETS_SCOPE } from './access.ts';
import { DAILY_TAB, MTD_TAB, installClosingView } from './closingView.ts';
import { loadConfig, loadDotEnv } from './config.ts';
import { accessTokenFor, googleJson } from './google.ts';
import { readStored } from './tokenStore.ts';

loadDotEnv(process.cwd());
const config = loadConfig(process.cwd());
const spreadsheetId = readStored(config.tokenPath).spreadsheetId;
if (!spreadsheetId) throw new Error('The command center spreadsheet is not saved.');
const accessToken = await accessTokenFor({ clientId: config.clientId, clientSecret: config.clientSecret, tokenPath: config.tokenPath, requiredScope: SHEETS_SCOPE });
const { created } = await installClosingView({ accessToken, spreadsheetId });
const base = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
const read = async (range: string) => ((await googleJson({ accessToken, url: `${base}/values/${encodeURIComponent(range)}` })) as { values?: string[][] }).values ?? [];
console.log(JSON.stringify({ created, daily: await read(`${DAILY_TAB}!A1:P`), mtd: await read(`${MTD_TAB}!A1:C`) }, null, 2));
