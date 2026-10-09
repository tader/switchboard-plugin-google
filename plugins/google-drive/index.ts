import type { PluginContext } from './types/api.d.ts';
import type * as Google from './types/google.d.ts';

const SCOPES: Record<string, string> = {
  readonly: 'https://www.googleapis.com/auth/drive.readonly',
  file: 'https://www.googleapis.com/auth/drive.file',
  full: 'https://www.googleapis.com/auth/drive',
};

export default function setup(ctx: PluginContext) {
  const { googleService } = ctx.require<ReturnType<typeof Google.default>['exports']>('google');
  return {
    services: [
      googleService({
        id: 'google-drive',
        name: 'Google Drive',
        description: 'Files and folders',
        icon: 'icon.svg',
        docsUrl: 'https://developers.google.com/drive/api/reference/rest/v3',
        baseUrl: 'https://www.googleapis.com/drive/v3',
        allowedHosts: ['www.googleapis.com', 'content.googleapis.com'],
        openapi: 'https://api.apis.guru/v2/specs/googleapis.com/drive/v3/openapi.json',
        fields: [
          {
            key: 'access',
            label: 'Access',
            type: 'select',
            default: 'full',
            options: [
              { value: 'readonly', label: 'View all files' },
              { value: 'file', label: 'Only files created or opened through Switchboard' },
              { value: 'full', label: 'View and edit all files' },
            ],
          },
        ],
        scopes: (c) => [SCOPES[c.access] ?? SCOPES.full],
      }),
    ],
  };
}
