import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowGoogleRequest, coversScopes } from '../plugins/google/sharing-policy.ts';
import type { Connection } from '../plugins/google/types/api.d.ts';
const request = (url: string, method = 'GET') => ({ url: new URL(url), method, headers: new Headers() });
const connection = (access: string, scope = ''): Connection => ({ id: 'x', name: 'x', serviceId: 'google-drive', methodId: 'oauth', config: { access }, credentials: { scope } });
test('OAuth aliases and known scope implications are supported without inventing grants', () => {
  assert.ok(coversScopes(['https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/drive'], ['email', 'https://www.googleapis.com/auth/drive.readonly']));
  assert.equal(coversScopes(['https://www.googleapis.com/auth/drive'], ['https://www.googleapis.com/auth/drive.file']), false);
  assert.equal(coversScopes(['https://www.googleapis.com/auth/calendar'], ['https://www.googleapis.com/auth/drive']), false);
});
test('Drive cannot reach Calendar on the shared host or escape with encoded paths', () => {
  assert.ok(allowGoogleRequest('google-drive', request('https://www.googleapis.com/drive/v3/files'), connection('full')));
  for (const url of ['https://www.googleapis.com/calendar/v3/calendars', 'https://www.googleapis.com/drive/v3/..%2f..%2fcalendar/v3', 'https://www.googleapis.com/drive/v3/%252e%252e', 'https://evil.example/drive/v3/files']) assert.equal(allowGoogleRequest('google-drive', request(url), connection('full')), false);
});
test('read-only and file access remain narrower than a broader shared grant', () => {
  assert.equal(allowGoogleRequest('google-drive', request('https://www.googleapis.com/drive/v3/files', 'POST'), connection('readonly')), false);
  assert.equal(allowGoogleRequest('google-drive', request('https://www.googleapis.com/drive/v3/files'), connection('file', 'https://www.googleapis.com/auth/drive')), false);
});
test('Docs and Sheets only permit Drive when full-drive was explicitly selected', () => {
  for (const product of ['google-docs', 'google-sheets']) {
    assert.equal(allowGoogleRequest(product, request('https://www.googleapis.com/drive/v3/files'), connection('full')), false);
    assert.ok(allowGoogleRequest(product, request('https://www.googleapis.com/drive/v3/files'), connection('full-drive')));
  }
});
test('Gmail send/modify profiles cannot use broader grant permissions', () => {
  assert.ok(allowGoogleRequest('gmail', request('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', 'POST'), connection('send')));
  assert.equal(allowGoogleRequest('gmail', request('https://gmail.googleapis.com/gmail/v1/users/me/messages/123', 'DELETE'), connection('modify')), false);
  assert.equal(allowGoogleRequest('gmail', request('https://gmail.googleapis.com/gmail/v1/users/me/messages/batchDelete', 'POST'), connection('modify')), false);
  assert.equal(allowGoogleRequest('gmail', request('https://gmail.googleapis.com/gmail/v1/users/me/labels', 'POST'), connection('send')), false);
});
test('generic wildcard Google APIs cannot opt into shared grants', () => assert.equal(allowGoogleRequest('google', request('https://www.googleapis.com/drive/v3/files'), connection('full')), false));


test('method override headers and query parameters cannot bypass read-only access', () => {
  const req=request('https://www.googleapis.com/drive/v3/files/123');
  req.headers.set('x-http-method-override','DELETE');
  assert.equal(allowGoogleRequest('google-drive',req,connection('readonly')),false);
  assert.equal(allowGoogleRequest('google-drive',request('https://www.googleapis.com/drive/v3/files/123?$httpMethod=DELETE'),connection('readonly')),false);
});
