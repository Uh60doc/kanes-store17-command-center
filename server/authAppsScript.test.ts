import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const signed = (bytes: Uint8Array) => Array.from(bytes, (b) => (b > 127 ? b - 256 : b));
const unsigned = (bytes: ArrayLike<number>) => Uint8Array.from(Array.from(bytes, (b) => (b < 0 ? b + 256 : b)));

function loadAuth() {
  const props: Record<string, string> = {};
  const cache: Record<string, string> = {};
  let ids = 0;
  const sandbox = {
    Utilities: {
      getUuid: () => `id-${++ids}`,
      base64Encode: (bytes: number[]) => Buffer.from(unsigned(bytes)).toString('base64'),
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (_algorithm: string, bytes: number[]) => signed(createHash('sha256').update(unsigned(bytes)).digest()),
      newBlob: (input: string | number[]) => {
        const data = typeof input === 'string' ? Buffer.from(input) : unsigned(input);
        return { getBytes: () => signed(data) };
      },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key: string) => (Object.prototype.hasOwnProperty.call(props, key) ? props[key] : null),
        setProperty: (key: string, value: string) => { props[key] = String(value); },
        deleteProperty: (key: string) => { delete props[key]; },
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: (key: string) => cache[key] ?? null,
        put: (key: string, value: string) => { cache[key] = String(value); },
        remove: (key: string) => { delete cache[key]; },
      }),
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(new URL('../apps-script/Auth.gs', import.meta.url), 'utf8'), sandbox);
  vm.runInContext(readFileSync(new URL('../apps-script/Documents.gs', import.meta.url), 'utf8'), sandbox);
  return { gs: sandbox as any, props };
}

test('Liz, Cordell, and Kelly can sign in, and ADMIN asks each of them to create a password', () => {
  const { gs, props } = loadAuth();
  const kelly = gs.login_({ username: 'Kelly', password: 'ADMIN' });
  assert.equal(kelly.mustSetPassword, true);
  assert.equal(kelly.name, 'Kelly');
  assert.equal(gs.requireSession_(kelly.token).mustSetPassword, true);
  assert.equal(gs.choosePassword_({ username: 'kelly', token: kelly.token, newPassword: 'store' }).username, 'kelly');
  assert.throws(() => gs.login_({ username: 'store17', password: 'ADMIN' }), /not valid/);
  assert.throws(() => gs.login_({ username: 'Liz', password: 'admin' }), /not valid/);
  const liz = gs.login_({ username: ' Liz ', password: 'ADMIN' });
  assert.equal(liz.mustSetPassword, true);
  assert.equal(liz.name, 'Liz');
  assert.equal(gs.requireSession_(liz.token).mustSetPassword, true);
  const cordell = gs.login_({ username: 'cordell', password: 'ADMIN' });
  assert.equal(cordell.name, 'Cordell');
  assert.throws(() => gs.choosePassword_({ username: 'liz', password: 'ADMIN', newPassword: '' }), /Enter a password/);
  const saved = gs.choosePassword_({ username: 'liz', password: 'ADMIN', newPassword: 'a' });
  assert.equal(saved.role, 'admin');
  assert.equal(saved.username, 'liz');
  assert.equal(gs.requireSession_(saved.token).username, 'liz');
  assert.throws(() => gs.requireSession_(liz.token), /Sign in required/);
  assert.equal(props.ready_user_liz, 'yes');
  assert.equal(JSON.stringify(props).includes('"a"'), false);
  assert.throws(() => gs.login_({ username: 'liz', password: 'ADMIN' }), /not valid/);
  assert.equal(gs.login_({ username: 'liz', password: 'a' }).username, 'liz');
  assert.equal(gs.login_({ username: 'Cordell', password: 'ADMIN' }).mustSetPassword, true);
  const space = gs.choosePassword_({ username: 'cordell', password: 'ADMIN', newPassword: '  ok  ' });
  assert.equal(typeof gs.login_({ username: 'cordell', password: '  ok  ' }).token, 'string');
  assert.throws(() => gs.choosePassword_({ username: 'cordell', password: 'ADMIN', newPassword: 'other' }), /already saved/);
  gs.resetSignIn_({ username: 'liz' });
  assert.throws(() => gs.requireSession_(saved.token), /Sign in required/);
  assert.equal(gs.requireSession_(space.token).username, 'cordell');
  assert.equal(gs.login_({ username: 'liz', password: 'ADMIN' }).mustSetPassword, true);
  assert.equal(gs.docLogin_({ role: 'admin', username: 'liz' }), 'Admin (liz)');
  assert.equal(gs.docLogin_({ role: 'manager' }), 'Manager (store17)');
});
