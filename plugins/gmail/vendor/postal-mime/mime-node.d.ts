import type { StructuredHeader } from './decode-strings.js';
import PassThroughDecoder from './pass-through-decoder.js';
import Base64Decoder from './base64-decoder.js';
import QPDecoder from './qp-decoder.js';
import type PostalMime from './postal-mime.js';
import type { Header, HeaderLine } from './types.js';
export interface MimeNodeOptions {
    postalMime: PostalMime;
    parentNode?: MimeNode | undefined;
    /** multipart subtype of the parent, decides the default content type of this part */
    parentMultipartType?: string | false | undefined;
}
type ContentDecoder = PassThroughDecoder | Base64Decoder | QPDecoder;
export default class MimeNode {
    options: MimeNodeOptions;
    postalMime: PostalMime;
    childNodes: MimeNode[];
    finalizedChildCount: number;
    parentNode?: MimeNode | undefined;
    depth: number;
    state: 'header' | 'body' | 'finished';
    headerLines: string[];
    contentType: {
        value: string;
        parsed: StructuredHeader;
        multipart: string | false;
    };
    contentTransferEncoding: {
        value: string;
        encoding: string;
    };
    contentDisposition: {
        value: string;
        parsed: StructuredHeader;
    };
    contentId?: string | undefined;
    contentDescription?: string | undefined;
    headers: Header[];
    rawHeaderLines: HeaderLine[];
    contentDecoder: ContentDecoder | null;
    /** decoded body, set by finalize() */
    content: ArrayBuffer | null;
    constructor(options: MimeNodeOptions);
    setupContentDecoder(transferEncoding: string): void;
    finalize(boundaryEnded?: boolean): Promise<void>;
    finalizeChildNodes(boundaryEnded?: boolean): Promise<void>;
    stripComments(str: string): string;
    parseStructuredHeader(str: string): StructuredHeader;
    decodeFlowedText(str: string, delSp: boolean): string;
    getTextContent(): string;
    processHeaders(): void;
    endHeaders(): void;
    feed(line: Uint8Array<ArrayBuffer>, lineBreak: Uint8Array<ArrayBuffer>): boolean;
}
export {};
//# sourceMappingURL=mime-node.d.ts.map