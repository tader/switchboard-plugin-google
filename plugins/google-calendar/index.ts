import type { PluginContext } from './types/api.d.ts';
import type * as Google from './types/google.d.ts';

export default function setup(ctx: PluginContext) {
  const { googleService } = ctx.require<ReturnType<typeof Google.default>['exports']>('google');
  return {
    services: [
      googleService({
        id: 'google-calendar',
        name: 'Google Calendar',
        description: 'Calendars and events',
        icon: 'icon.svg',
        docsUrl: 'https://developers.google.com/calendar/api/v3/reference',
        baseUrl: 'https://www.googleapis.com/calendar/v3',
        allowedHosts: ['www.googleapis.com'],
        openapi: 'https://api.apis.guru/v2/specs/googleapis.com/calendar/v3/openapi.json',
        fields: [
          {
            key: 'access',
            label: 'Access',
            type: 'select',
            default: 'full',
            options: [
              { value: 'readonly', label: 'View calendars and events' },
              { value: 'full', label: 'View and edit calendars and events' },
            ],
          },
        ],
        scopes: (c) => [c.access === 'readonly' ? 'https://www.googleapis.com/auth/calendar.readonly' : 'https://www.googleapis.com/auth/calendar'],
      }),
    ],
  };
}
