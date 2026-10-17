/**
 * Backups and restore drills on a copy of the verified October workbook with an in-memory Drive. Production is the
 * harness workbook; a backup or drill must never write to it beyond its own log rows.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { plain } from './fakeSpreadsheet.ts';
import { harness, session, tabText } from './octoberVerified.ts';
import { table } from './snapshotGrid.ts';

const LOG_TABS = ['CC_Backups', 'CC_BackupFiles'];

function withArchive() {
  const h = harness();
  table(h.tabs, 'CC_SourceArchive').forEach((row) => { if (row.drive_file_id) h.drive.addFile(row.drive_file_id, row.file_name, `original ${row.sha256}`); });
  h.props.hash_admin = 'secret-hash';
  h.props.salt_admin = 'secret-salt';
  h.props.sessions = '{"token":"x"}';
  h.props.eval_archive_folder = 'folder-eval';
  return h;
}

test('a backup copies the whole workbook, checks it cell for cell and copies every archived file once', () => {
  const { gs, tabs, drive } = withArchive();
  const production = tabText(tabs, LOG_TABS);
  const result = plain(gs.runBackup_('test', 60000));
  assert.equal(result.status, 'Verified');
  assert.equal(result.tabs, Object.keys(tabs).filter((name) => !LOG_TABS.includes(name)).length);
  assert.match(result.note, /match production cell for cell/);
  const copy = drive.files[result.file_id]!;
  assert.equal(drive.pathOf(copy.folder), 'Store 17 Command Center Backups/Spreadsheet copies');
  for (const name of ['CC_Config', 'CC_GoalHistory', 'CC_Imports', 'CC_Uploads', 'CC_Exceptions', 'CC_DailyHistory', 'CC_MonthlyHistory', 'CC_Daily', 'CC_Ledger']) assert.ok(copy.tabs![name], name);
  assert.equal(tabText(copy.tabs!, LOG_TABS), production, 'the copy holds exactly the production data');
  assert.equal(tabText(tabs, LOG_TABS), production, 'production was not changed');
  const archived = table(tabs, 'CC_SourceArchive').filter((row) => row.drive_file_id).length;
  assert.equal(result.files_copied, archived);
  assert.equal(table(tabs, 'CC_BackupFiles').length, archived);
  const settings = Object.values(drive.files).find((file) => /^Command Center settings/.test(file.name))!;
  assert.equal(drive.pathOf(settings.folder), 'Store 17 Command Center Backups/Settings');
  const saved = JSON.parse(settings.content!);
  assert.equal(saved.script_properties.eval_archive_folder, 'folder-eval');
  assert.ok(!('hash_admin' in saved.script_properties) && !('salt_admin' in saved.script_properties) && !('sessions' in saved.script_properties));
  assert.ok(saved.config.some((row: { key: string }) => row.key === 'written_goal'));
  const again = plain(gs.runBackup_('test', 60000));
  assert.equal(again.files_copied, 0, 'files already backed up are not copied again');
  assert.equal(table(tabs, 'CC_BackupFiles').length, archived);
});

test('the restore drill rebuilds the dashboard from a scratch copy and never writes to production', () => {
  const { gs, tabs, drive } = withArchive();
  const backup = plain(gs.runBackup_('test', 60000));
  const production = tabText(tabs, LOG_TABS);
  const backupData = tabText(drive.files[backup.file_id]!.tabs!);
  const drill = plain(gs.runRestoreDrill_('test'));
  assert.equal(drill.status, 'Passed', drill.note);
  assert.notEqual(drill.file_id, backup.file_id);
  assert.match(drill.note, /6 of 6 dashboard pages built from the restored copy are identical to production/);
  assert.match(drill.note, /Quality checks on the restored copy: 11 PASS, 4 FLAG, 5 NOTE/);
  assert.match(drill.note, /Production was not written/);
  assert.equal(tabText(tabs, LOG_TABS), production, 'production unchanged');
  assert.equal(tabText(drive.files[backup.file_id]!.tabs!), backupData, 'the backup itself unchanged');
  assert.equal(drive.pathOf(drive.files[drill.file_id]!.folder), 'Store 17 Command Center Backups/Restore drills');
  const second = plain(gs.runRestoreDrill_('test'));
  assert.equal(second.status, 'Passed');
  assert.equal(drive.files[drill.file_id]!.trashed, true, 'only the latest drill copy is kept');
  const health = plain(gs.health_({ session }));
  assert.equal(health.backups.drill.status, 'Passed');
  assert.equal(health.backups.latest.status, 'Verified');
});

test('Back up now then Test restore from System health compares every page with production', () => {
  const { gs, tabs, props } = withArchive();
  vm.runInContext("requireSession_ = function () { return { role: 'admin', username: 'test' }; };", gs as vm.Context);
  props.data_version = 'before backup';
  const production = tabText(tabs, LOG_TABS);
  const backup = plain(gs.dispatch('runBackup', { token: 't', mode: 'backup' })).result;
  assert.equal(backup.status, 'Verified');
  assert.equal(props.data_version, 'before backup', 'a backup only writes its own log, so cached pages stay current');
  const drill = plain(gs.dispatch('runBackup', { token: 't', mode: 'drill' })).result;
  assert.equal(drill.status, 'Passed', drill.note);
  assert.match(drill.note, /6 of 6 dashboard pages built from the restored copy are identical to production/);
  assert.equal(tabText(tabs, LOG_TABS), production, 'production unchanged');
  gs.dispatch('runChecks', { token: 't' });
  assert.notEqual(props.data_version, 'before backup', 'quality checks change the alerts on Home, so the version moves');
});

test('a backup problem is recorded and retires the cached pages', () => {
  const { gs, drive, props } = withArchive();
  const raised: string[] = [];
  gs.appendException_ = (_severity: string, message: string) => { raised.push(message); };
  props.data_version = 'before backup';
  const backup = plain(gs.runBackup_('test', 60000));
  assert.ok(!raised.some((message) => /backup/i.test(message)), raised.join('\n'));
  assert.equal(props.data_version, 'before backup');
  drive.files[backup.file_id]!.tabs!.CC_Daily!.pop();
  const drill = plain(gs.runRestoreDrill_('test'));
  assert.equal(drill.status, 'Failed');
  assert.ok(raised.some((message) => /^Restore drill failed: .*CC_Daily differs/.test(message)), raised.join('\n'));
  assert.match(props.data_version, /backup problem$/);
});

test('a damaged backup fails the drill and names the tab', () => {
  const { gs, drive } = withArchive();
  const backup = plain(gs.runBackup_('test', 60000));
  drive.files[backup.file_id]!.tabs!.CC_Daily!.pop();
  const drill = plain(gs.runRestoreDrill_('test'));
  assert.equal(drill.status, 'Failed');
  assert.match(drill.note, /CC_Daily differs/);
});

test('retention keeps the newest 30 copies and the first copy of each month', () => {
  const { gs, tabs, drive, setToday } = withArchive();
  const ids: string[] = [];
  for (let i = 0; i < 33; i += 1) {
    ids.push(plain(gs.runBackup_('test', 60000)).file_id);
  }
  setToday('2026-10-18');
  const log = table(tabs, 'CC_Backups').filter((row) => row.kind === 'Spreadsheet');
  const retired = log.filter((row) => row.status === 'Retired').map((row) => row.file_id);
  assert.deepEqual(retired, [ids[1], ids[2]], 'the first copy of the month and the newest 30 are kept');
  assert.ok(retired.every((id) => drive.files[id]!.trashed));
  assert.ok(!drive.files[ids[0]!]!.trashed);
});
