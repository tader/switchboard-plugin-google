import crypto from 'node:crypto';
import type { AuthMethod, Connection, Field, PluginContext, ServiceDefinition } from './types/api.d.ts';
import type * as OAuth2 from './types/oauth2.d.ts';

type Cfg = Record<string, any>;

export interface GoogleServiceOptions {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  docsUrl?: string;
  scopes: string[] | ((config: Cfg) => string[]);
  /** Extra fields asked when connecting, e.g. to choose an access level. */
  fields?: Field[];
  baseUrl?: string;
  allowedHosts?: string[];
  openapi?: string;
  /** Also offer a service account with domain-wide delegation (Google Workspace). */
  serviceAccount?: boolean;
  /** Offer "Sign in with Google". Default true; false for APIs whose scopes users cannot consent to. */
  signIn?: boolean;
  /** Shown on the sign-in method, e.g. when only Workspace accounts are supported. */
  oauthDescription?: string;
}

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

interface ServiceAccountCredentials {
  key: ServiceAccountKey;
  accessToken?: string;
  expiresAt?: number;
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url');

/** OAuth 2.0 JWT bearer grant: the service account signs an assertion acting as `subject`. */
async function serviceAccountToken(key: ServiceAccountKey, subject: string, scopes: string[]) {
  const tokenUri = key.token_uri ?? TOKEN_URL;
  const iat = Math.floor(Date.now() / 1000);
  const claims = { iss: key.client_email, sub: subject, scope: scopes.join(' '), aud: tokenUri, iat, exp: iat + 3600 };
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), key.private_key);
  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(signature)}` }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const reason = data.error_description ?? data.error ?? `HTTP ${res.status}`;
    // The usual cause: the Workspace admin has not authorized this client id for these scopes.
    throw new Error(/unauthorized_client/.test(String(data.error)) ? `${reason}. Authorize the service account's client id for these scopes under domain-wide delegation in the Admin console.` : reason);
  }
  return { accessToken: data.access_token as string, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
}

function serviceAccountMethod(scopes: (c: Cfg) => string[], extraFields: Field[]): AuthMethod {
  const fresh = async (conn: Connection, force?: boolean) => {
    const c = conn.credentials as ServiceAccountCredentials;
    if (!force && c.accessToken && (c.expiresAt ?? 0) - 60_000 > Date.now()) return { creds: c, changed: false };
    const t = await serviceAccountToken(c.key, conn.config.subject, scopes(conn.config));
    return { creds: { ...c, ...t }, changed: true };
  };
  return {
    id: 'service-account',
    name: 'Service account',
    description: 'Google Workspace, with domain-wide delegation',
    fields: [
      {
        key: 'key',
        label: 'Service account key',
        type: 'secret',
        required: true,
        description: 'Paste the JSON key file. A Workspace admin must authorize its client id for the scopes under domain-wide delegation.',
      },
      { key: 'subject', label: 'Act as', required: true, placeholder: 'user@yourcompany.com', description: 'The Workspace user whose data to use' },
      ...extraFields,
    ],
    async connect({ config }) {
      const { key: raw, ...rest } = config;
      let key: ServiceAccountKey & { type?: string };
      try {
        key = JSON.parse(raw);
      } catch {
        throw new Error('The key is not valid JSON; paste the whole key file');
      }
      if (key.type !== 'service_account' || !key.client_email || !key.private_key) throw new Error('This is not a service account key file');
      const token = await serviceAccountToken(key, rest.subject, scopes(rest));
      const credentials: ServiceAccountCredentials = { key: { client_email: key.client_email, private_key: key.private_key, token_uri: key.token_uri }, ...token };
      return { credentials, config: rest, account: { id: `${key.client_email}:${rest.subject}`, label: rest.subject } };
    },
    async authorize(req, conn, opts) {
      const { creds, changed } = await fresh(conn, opts.force);
      req.headers.set('authorization', `Bearer ${creds.accessToken}`);
      return changed ? { credentials: creds } : undefined;
    },
    async token(conn, opts) {
      const { creds, changed } = await fresh(conn, opts.force);
      return { accessToken: creds.accessToken!, tokenType: 'Bearer', expiresAt: creds.expiresAt, credentials: changed ? creds : undefined };
    },
  };
}

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const IDENTITY = ['openid', 'email', 'profile'];

export default function setup(ctx: PluginContext) {
  const oauth = ctx.require<typeof OAuth2>('oauth2');
  const shared = !!(ctx.settings.clientId && ctx.settings.clientSecret);

  // Users can bring their own OAuth client; it is required when the administrator did not configure one.
  const clientFields: Field[] = [
    { key: 'clientId', label: 'OAuth client ID', required: !shared, advanced: shared, description: shared ? 'Leave empty to use Switchboard’s client' : `Create a "Web application" client in the Google Cloud console with redirect URI ${ctx.callbackUrl}` },
    { key: 'clientSecret', label: 'OAuth client secret', type: 'secret', required: !shared, advanced: shared },
  ];

  function googleService(o: GoogleServiceOptions): ServiceDefinition {
    const scopes = (cfg: Cfg) => [...IDENTITY, ...(typeof o.scopes === 'function' ? o.scopes(cfg) : o.scopes)];
    const method = oauth.authorizationCode({
      id: 'oauth',
      name: 'Sign in with Google',
      description: o.oauthDescription,
      fields: [...(o.fields ?? []), ...clientFields],
      authorizeUrl: AUTHORIZE_URL,
      tokenUrl: TOKEN_URL,
      clientId: (c) => c.clientId || ctx.settings.clientId,
      clientSecret: (c) => (c.clientId ? c.clientSecret : ctx.settings.clientSecret),
      scopes,
      // Ask for a refresh token every time, and let the user pick the account.
      authorizeParams: { access_type: 'offline', prompt: 'consent select_account', include_granted_scopes: 'true' },
      async identify(creds) {
        const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${creds.accessToken}` } });
        if (!res.ok) return undefined;
        const u = await res.json();
        return { id: u.sub, label: u.email ?? u.name ?? u.sub, avatarUrl: u.picture };
      },
      async revoke(creds) {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(creds.refreshToken ?? creds.accessToken)}`, { method: 'POST' }).catch(() => {});
      },
    });
    return {
      id: o.id,
      name: o.name,
      description: o.description,
      icon: o.icon,
      docsUrl: o.docsUrl,
      baseUrl: o.baseUrl,
      allowedHosts: o.allowedHosts,
      openapi: o.openapi,
      // The service account acts as a user, so it needs no identity scopes.
      authMethods: [
        ...(o.signIn === false ? [] : [method]),
        ...(o.serviceAccount ? [serviceAccountMethod((c) => (typeof o.scopes === 'function' ? o.scopes(c) : o.scopes), o.fields ?? [])] : []),
      ],
    };
  }

  const generic = googleService({
    id: 'google',
    name: 'Google APIs',
    description: 'Any Google API, with the scopes you choose',
    icon: 'icon.svg',
    docsUrl: 'https://developers.google.com/identity/protocols/oauth2/scopes',
    baseUrl: 'https://www.googleapis.com',
    allowedHosts: ['*.googleapis.com'],
    scopes: (c) => String(c.scopes ?? '').split(/[\s,]+/).filter(Boolean),
    serviceAccount: true,
    fields: [{ key: 'scopes', label: 'Scopes', type: 'textarea', required: true, placeholder: 'https://www.googleapis.com/auth/drive.readonly', description: 'Separated by spaces or new lines' }],
  });
  generic.openapi = (conn: Connection) => conn.config.openapi || undefined;
  for (const m of generic.authMethods) m.fields!.push({ key: 'openapi', label: 'OpenAPI URL', type: 'url', advanced: true });

  return { services: [generic], exports: { googleService } };
}
