import type { PluginContext } from './types/api.d.ts';
import type * as Google from './types/google.d.ts';

// Google only offers the Keep API to Google Workspace, and its consent screen refuses to show the
// Keep scopes ("Some requested scopes cannot be shown", intended behavior per Google), so signing in
// with OAuth never works. A service account with domain-wide delegation is the only way in.
export default function setup(ctx: PluginContext) {
  const { googleService } = ctx.require<ReturnType<typeof Google.default>['exports']>('google');
  return {
    services: [
      googleService({
        id: 'google-keep',
        name: 'Google Keep',
        description: 'Notes and lists (Google Workspace, service account)',
        icon: 'icon.svg',
        docsUrl: 'https://developers.google.com/workspace/keep/api/reference/rest',
        baseUrl: 'https://keep.googleapis.com',
        allowedHosts: ['keep.googleapis.com'],
        openapi: 'https://api.apis.guru/v2/specs/googleapis.com/keep/v1/openapi.json',
        signIn: false,
        serviceAccount: true,
        fields: [
          {
            key: 'access',
            label: 'Access',
            type: 'select',
            default: 'full',
            options: [
              { value: 'readonly', label: 'View notes' },
              { value: 'full', label: 'View, create and delete notes' },
            ],
          },
        ],
        scopes: (c) => [c.access === 'readonly' ? 'https://www.googleapis.com/auth/keep.readonly' : 'https://www.googleapis.com/auth/keep'],
      }),
    ],
  };
}
