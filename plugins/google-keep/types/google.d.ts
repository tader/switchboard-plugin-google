import type { Field, PluginContext, ServiceDefinition } from './api.d.ts';
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
export default function setup(ctx: PluginContext): {
    services: ServiceDefinition[];
    exports: {
        googleService: (o: GoogleServiceOptions) => ServiceDefinition;
    };
};
export {};
