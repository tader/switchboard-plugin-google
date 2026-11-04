import addressParser from './address-parser.js';
import { decodeWords } from './decode-strings.js';
import type { Email, PostalMimeOptions, RawEmail } from './types.js';
export { addressParser, decodeWords };
export type { Address, AddressGroup, AddressParserOptions, Attachment, AttachmentDisposition, AttachmentEncoding, Email, Header, HeaderLine, Mailbox, Otp, PostalMimeOptions, RawEmail } from './types.js';
export type { ErrorCode, PostalMimeError } from './errors.js';
export default class PostalMime {
    /**
     * Parses a raw email message
     *
     * @param buf Raw email message
     * @param options Parser options
     * @returns The parsed email
     */
    static parse(buf: RawEmail, options?: PostalMimeOptions): Promise<Email>;
    constructor(options?: PostalMimeOptions);
    /**
     * Parses a raw email message. A parser instance can be used once
     *
     * @param buf Raw email message
     * @returns The parsed email
     */
    parse(buf: RawEmail): Promise<Email>;
}
//# sourceMappingURL=postal-mime.d.ts.map