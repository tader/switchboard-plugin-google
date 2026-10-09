import type { PluginContext } from './types/api.d.ts';
import type * as Google from './types/google.d.ts';

const SCOPES: Record<string, string[]> = {
  readonly: ['https://www.googleapis.com/auth/gmail.readonly'],
  send: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'],
  modify: ['https://www.googleapis.com/auth/gmail.modify'],
  full: ['https://mail.google.com/'],
};

export default function setup(ctx: PluginContext) {
  const { googleService } = ctx.require<ReturnType<typeof Google.default>['exports']>('google');
  return {
    services: [
      googleService({
        id: 'gmail',
        name: 'Gmail',
        description: 'Email',
        icon: 'icon.svg',
        docsUrl: 'https://developers.google.com/gmail/api/reference/rest',
        baseUrl: 'https://gmail.googleapis.com',
        allowedHosts: ['gmail.googleapis.com', 'www.googleapis.com'],
        openapi: 'https://api.apis.guru/v2/specs/googleapis.com/gmail/v1/openapi.json',
        fields: [
          {
            key: 'access',
            label: 'Access',
            type: 'select',
            default: 'modify',
            options: [
              { value: 'readonly', label: 'Read email' },
              { value: 'send', label: 'Read and send email' },
              { value: 'modify', label: 'Read, send and organize email' },
              { value: 'full', label: 'Full access, including deleting' },
            ],
          },
        ],
        scopes: (c) => SCOPES[c.access] ?? SCOPES.modify,
      }),
    ],
  };
}
