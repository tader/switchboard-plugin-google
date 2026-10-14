import type { Connection, OutgoingRequest } from './types/api.d.ts';

const normalize = (scope: string) => ({ email: 'https://www.googleapis.com/auth/userinfo.email', profile: 'https://www.googleapis.com/auth/userinfo.profile' })[scope] ?? scope;
export function coversScopes(granted: string[], required: string[]) {
  const actual = new Set(granted.map(normalize));
  if (required.includes('https://www.googleapis.com/auth/drive.file') && (actual.has('https://www.googleapis.com/auth/drive') || actual.has('https://www.googleapis.com/auth/drive.readonly'))) return false;
  return required.map(normalize).every(scope => {
    if (actual.has(scope)) return true;
    if (scope.endsWith('.readonly') && actual.has(scope.slice(0, -9))) return true;
    if (scope.startsWith('https://www.googleapis.com/auth/gmail.') && actual.has('https://mail.google.com/')) return true;
    if (['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'].includes(scope) && actual.has('https://www.googleapis.com/auth/gmail.modify')) return true;
    return false;
  });
}

/** Strict request boundaries for named Google services; the generic wildcard service remains private. */
export function allowGoogleRequest(id: string, req: OutgoingRequest, conn: Connection): boolean {
  if (['x-http-method-override', 'x-method-override', 'x-http-method'].some(header => req.headers.has(header)) || req.url.searchParams.has('$httpMethod') || req.url.searchParams.has('_method')) return false;
  if (req.url.protocol !== 'https:' || /%2f|%5c|%25/i.test(req.url.pathname)) return false;
  let path: string;
  try { path = decodeURIComponent(req.url.pathname); } catch { return false; }
  if (path.includes('\\') || path.split('/').some(part => part === '..' || part === '.')) return false;
  const host = req.url.host;
  const access = conn.config.access;
  const read = ['GET', 'HEAD'].includes(req.method.toUpperCase());
  if (access === 'readonly' && !read) return false;
  if (id === 'google-drive') {
    if (access === 'file' && String(conn.credentials.scope ?? '').split(/\s+/).some((scope: string) => ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/drive.readonly'].includes(scope))) return false;
    return ['www.googleapis.com', 'content.googleapis.com'].includes(host) && (path.startsWith('/drive/v3/') || path === '/drive/v3' || (access !== 'readonly' && path.startsWith('/upload/drive/v3/')));
  }
  if (id === 'google-calendar') return host === 'www.googleapis.com' && (path.startsWith('/calendar/v3/') || path === '/calendar/v3');
  if (id === 'google-docs' || id === 'google-sheets') {
    const product = id === 'google-docs' ? 'docs' : 'sheets';
    const prefix = product === 'docs' ? '/v1/documents' : '/v4/spreadsheets';
    if (host === `${product}.googleapis.com` && (path === prefix || path.startsWith(prefix + '/'))) return true;
    return access === 'full-drive' && host === 'www.googleapis.com' && (path.startsWith('/drive/v3/') || path.startsWith('/upload/drive/v3/'));
  }
  if (id === 'gmail') {
    if (!['gmail.googleapis.com', 'www.googleapis.com'].includes(host) || !/^\/gmail\/v1\/users\/[^/]+(?:\/|$)/.test(path)) return false;
    if (access === 'send') return read || (req.method === 'POST' && /\/(?:messages|drafts)\/send$/.test(path));
    if (access !== 'full' && ((req.method === 'DELETE' && /\/(?:messages|threads)\/[^/]+$/.test(path)) || path.endsWith('/messages/batchDelete'))) return false;
    return true;
  }
  return false;
}
