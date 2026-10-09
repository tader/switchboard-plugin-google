import type { PluginContext } from './types/api.d.ts';
import type * as Google from './types/google.d.ts';

const SCOPES: Record<string, string[]> = {
  readonly: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  full: ['https://www.googleapis.com/auth/spreadsheets'],
  // Also lets scripts find, create and share spreadsheets through the Drive API.
  'full-drive': ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
};

export default function setup(ctx: PluginContext) {
  const { googleService } = ctx.require<ReturnType<typeof Google.default>['exports']>('google');
  return {
    services: [
      googleService({
        id: 'google-sheets',
        name: 'Google Sheets',
        description: 'Spreadsheets',
        icon: 'icon.svg',
        docsUrl: 'https://developers.google.com/sheets/api/reference/rest',
        baseUrl: 'https://sheets.googleapis.com',
        allowedHosts: ['sheets.googleapis.com', 'www.googleapis.com'],
        openapi: 'https://api.apis.guru/v2/specs/googleapis.com/sheets/v4/openapi.json',
        fields: [
          {
            key: 'access',
            label: 'Access',
            type: 'select',
            default: 'full',
            options: [
              { value: 'readonly', label: 'View spreadsheets' },
              { value: 'full', label: 'View and edit spreadsheets' },
              { value: 'full-drive', label: 'View and edit spreadsheets, and find them in Drive' },
            ],
          },
        ],
        scopes: (c) => SCOPES[c.access] ?? SCOPES.full,
      }),
    ],
  };
}
