import type { Email } from './types.js';
export declare function decodeHTMLEntities(str: string): string;
export declare function escapeHtml(str: string): string;
export declare function textToHtml(str: string): string;
export declare function htmlToText(str: string): string;
export type HeaderFields = Pick<Email, 'from' | 'subject' | 'date' | 'to' | 'cc' | 'bcc'>;
export declare function formatTextHeader(message: HeaderFields): string;
export declare function formatHtmlHeader(message: HeaderFields): string;
//# sourceMappingURL=text-format.d.ts.map