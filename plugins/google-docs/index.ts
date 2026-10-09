import type { PluginContext } from './types/api.d.ts';
import type * as Google from './types/google.d.ts';

const SCOPES: Record<string, string[]> = {
  readonly: ['https://www.googleapis.com/auth/documents.readonly'],
  full: ['https://www.googleapis.com/auth/documents'],
  // Also lets scripts find, create and export documents through the Drive API.
  'full-drive': ['https://www.googleapis.com/auth/documents', 'https://www.googleapis.com/auth/drive'],
};

export default function setup(ctx: PluginContext) {
  const { googleService } = ctx.require<ReturnType<typeof Google.default>['exports']>('google');
  return {
    services: [
      googleService({
        id: 'google-docs',
        name: 'Google Docs',
        description: 'Documents',
        icon: 'icon.svg',
        docsUrl: 'https://developers.google.com/docs/api/reference/rest',
        baseUrl: 'https://docs.googleapis.com',
        allowedHosts: ['docs.googleapis.com', 'www.googleapis.com'],
        openapi: 'https://api.apis.guru/v2/specs/googleapis.com/docs/v1/openapi.json',
        fields: [
          {
            key: 'access',
            label: 'Access',
            type: 'select',
            default: 'full',
            options: [
              { value: 'readonly', label: 'View documents' },
              { value: 'full', label: 'View and edit documents' },
              { value: 'full-drive', label: 'View and edit documents, and find them in Drive' },
            ],
          },
        ],
        scopes: (c) => SCOPES[c.access] ?? SCOPES.full,
      }),
    ],
  };
}
