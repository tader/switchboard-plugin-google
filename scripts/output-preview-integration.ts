import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = process.env.SWITCHBOARD_ROOT;
assert(root, 'Set SWITCHBOARD_ROOT to a Switchboard 0.17.0 checkout with dependencies installed');
const load = (name: string) => import(pathToFileURL(resolve(root, name)).href);
const temp = fs.mkdtempSync(join(os.tmpdir(), 'google-output-preview-'));
const dataDir = join(temp, 'data');
const previewRoot = join(temp, 'outputs');
Object.assign(process.env, {
  SWITCHBOARD_DATA_DIR: dataDir,
  SWITCHBOARD_WATCH_PLUGINS: 'false',
  SWITCHBOARD_ACTIVITY_PREVIEW_ROOT: previewRoot,
  SWITCHBOARD_ACTIVITY_PREVIEW_RESTORE_SAFE: '1',
  SWITCHBOARD_ACTIVITY_PREVIEW_INSTANCE: 'google-preview-fixture',
  SWITCHBOARD_ACTIVITY_PREVIEW_EPOCH: 'fixture-epoch',
});
const installed = join(dataDir, 'plugins');
fs.mkdirSync(installed, { recursive: true });
const source = resolve(dirname(fileURLToPath(import.meta.url)), '../plugins');
for (const name of fs.readdirSync(source)) {
  fs.cpSync(join(source, name), join(installed, name), { recursive: true });
}

const { initDb, run, all } = await load('server/db.ts');
const { initKey, encrypt } = await load('server/crypto.ts');
const { config } = await load('server/config.ts');
const { openPreviewStore } = await load('shared/activity-preview-store.ts');
const output = await load('server/activity-output.ts');
const { plugins } = await load('server/plugins/manager.ts');
const { createUser } = await load('server/users.ts');
const { execute } = await load('server/proxy.ts');

const secret = 'synthetic-google-access-token';
const gmail = 'https://gmail.googleapis.com/gmail/v1/users/me/labels/INBOX';
const calendar = 'https://www.googleapis.com/calendar/v3/colors';
const drive = 'https://www.googleapis.com/drive/v3/files';
const driveBody = { kind: 'drive#fileList', nextPageToken: 'private-cursor', files: [{ id: 'private-id', name: 'private-name' }] };
const caller = { source: 'proxy', tokenId: null, tokenName: null, ip: null, userAgent: null };
const fetchBefore = globalThis.fetch;

try {
  initDb();
  initKey();
  openPreviewStore(previewRoot, [dataDir], 'google-preview-fixture');
  config.previewStoreId = JSON.parse(fs.readFileSync(join(previewRoot, 'store.json'), 'utf8')).storeId;
  output.initOutputStore();
  output.setOutputRetention(4);
  await plugins.start();
  const owner = createUser('google-preview-owner', 'admin');

  function connect(service: string, method: string, cfg = {}) {
    const id = service + '-' + method;
    const conn = plugins.services.get(service);
    assert(conn?.service.authMethods.some((auth: { id: string }) => auth.id === method),
      plugins.plugins.get(service)?.error ?? 'Expected installed auth method for ' + service);
    const now = Date.now();
    run('INSERT INTO connections(id,user_id,service_id,method_id,name,config_enc,credentials_enc,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
      id, owner.id, service, method, id, encrypt(cfg),
      encrypt({ accessToken: secret, expiresAt: now + 3600_000 }), now, now);
    return id;
  }

  async function call(id: string, url: string, body: object | string | null, preview?: object, {
    method = 'GET', status = 200, type = 'application/json', retry = false,
  } = {}) {
    const payload = body === null || typeof body === 'string' ? body : JSON.stringify(body);
    let requests = 0;
    globalThis.fetch = async (input, init) => {
      requests++;
      assert.equal(String(input), url);
      assert.equal(init?.method, method);
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer ' + secret);
      if (retry && requests === 1) return new Response('retry', { status: 401 });
      return new Response(payload, { status, headers: { 'content-type': type, 'x-fixture': 'upstream' } });
    };
    const before = all('SELECT * FROM audit_outputs').length;
    const result = await execute(owner, id, { method, url }, undefined, caller);
    assert.equal(result.response.status, status);
    assert.equal(result.response.headers.get('content-type'), type);
    assert.equal(result.response.headers.get('x-fixture'), 'upstream');
    assert.deepEqual(Buffer.from(await result.response.arrayBuffer()), Buffer.from(payload ?? ''));
    assert.equal(requests, retry ? 2 : 1);
    assert.ok(result.auditId);
    assert.deepEqual(output.readOutput(owner.id, result.auditId, true).preview, preview);
    assert.equal(all('SELECT * FROM audit_outputs').length, before + Number(preview !== undefined));
  }

  const gmailId = connect('gmail', 'oauth');
  const label = { id: 'INBOX', name: 'INBOX', type: 'system', messagesTotal: 42, token: secret };
  await call(gmailId, gmail, label, { type: 'system' }, { retry: true });
  await call(connect('google-calendar', 'oauth'), calendar, {
    kind: 'calendar#colors', updated: '2024-01-01T00:00:00.000Z',
    calendar: { 1: { background: '#ffffff', foreground: '#000000' } },
    event: { 1: { background: '#000000', foreground: '#ffffff' } },
  }, { updated: '2024-01-01T00:00:00.000Z' });

  for (const service of ['google', 'google-drive', 'google-docs', 'google-sheets']) {
    const id = connect(service, 'oauth', {
      access: 'full-drive', scopes: 'https://www.googleapis.com/auth/drive',
    });
    await call(id, drive, driveBody, { kind: 'drive#fileList' });
    await call(id, drive, { files: driveBody.files });
    if (service === 'google-docs') {
      await call(id, 'https://docs.googleapis.com/v1/documents/demo', { title: 'private document' });
    }
    if (service === 'google-sheets') {
      await call(id, 'https://sheets.googleapis.com/v4/spreadsheets/demo', { properties: { title: 'private sheet' } });
    }
  }
  await call(connect('google', 'service-account'), drive, driveBody);
  await call(connect('google-keep', 'service-account'), 'https://keep.googleapis.com/v1/notes', {
    notes: [{ name: 'notes/private', title: 'private note' }],
  });

  for (const url of [gmail + '?fields=type', gmail.replace('INBOX', 'SENT'),
    gmail.replace('gmail.googleapis.com', 'www.googleapis.com')]) {
    await call(gmailId, url, label);
  }
  await call(gmailId, gmail, label, undefined, { method: 'POST' });
  await call(gmailId, gmail, { ...label, type: secret });
  const maxValue = 'é'.repeat(16);
  await call(gmailId, gmail, { ...label, type: maxValue }, { type: maxValue });
  await call(gmailId, gmail, { ...label, type: maxValue + 'x' });
  await call(gmailId, gmail, { ...label, type: 1 });
  await call(gmailId, gmail, '{invalid json');
  await call(gmailId, gmail, label, undefined, { status: 403 });
  await call(gmailId, gmail, null, undefined, { status: 204 });
  await call(gmailId, gmail, label, undefined, { type: 'application/octet-stream' });
  const padding = 16_384 - Buffer.byteLength(JSON.stringify({ ...label, padding: '' }));
  await call(gmailId, gmail, { ...label, padding: 'x'.repeat(padding) }, { type: 'system' });
  await call(gmailId, gmail, { ...label, padding: 'x'.repeat(padding + 1) });

  output.setOutputRetention(0);
  await call(gmailId, gmail, label);
  console.log('Installed Google plugin activity preview checks passed');
} finally {
  globalThis.fetch = fetchBefore;
  (await load('server/db.ts')).db?.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
