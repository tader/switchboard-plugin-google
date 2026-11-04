export declare const textEncoder: TextEncoder;
/** SP or HTAB, the only whitespace RFC 5322 and RFC 2045 give a meaning to in a line */
export declare const isWsp: (c: number) => boolean;
export declare function decodeBase64(base64: string): ArrayBuffer;
export declare const ENCODING_LABELS: Set<string>;
/** What is used of a TextDecoder, so that the replacement encoding can have one as well */
export type Decoder = Pick<TextDecoder, 'encoding' | 'decode'>;
export declare function getDecoder(charset?: string | null): Decoder;
/**
 * Whether the bytes are well formed UTF-8. A scan rather than a fatal TextDecoder, since
 * the exception one throws costs more than the decode itself and a message decides how
 * many lines throw it.
 */
export declare function isUtf8(bytes: Uint8Array): boolean;
/**
 * Decodes bytes whose encoding is not known: as UTF-8 when they are well formed UTF-8, as
 * windows-1252 otherwise.
 *
 * A message that declares no charset, or one the runtime has never heard of, usually
 * predates RFC 6532 or comes from a generator that never heard of it either, and its 8-bit
 * bytes are a legacy single byte encoding far more often than broken UTF-8. windows-1252
 * is the fallback the WHATWG Encoding Standard prescribes and what a mail client's default
 * charset amounts to, and it reads such text rather than filling it with replacement
 * characters.
 *
 * @param bytes Bytes to decode
 * @param utf8 The UTF-8 decoder to use, header lines bring one that keeps a BOM
 * @return Decoded text
 */
export declare function decodeUtf8OrWindows1252(bytes: Uint8Array | ArrayBuffer, utf8?: TextDecoder): string;
/**
 * Decodes bytes in a named charset. A label the runtime does not know is no charset at
 * all, see decodeUtf8OrWindows1252.
 *
 * @param bytes Bytes to decode
 * @param charset Charset label
 * @return Decoded text
 */
export declare function decodeCharset(bytes: Uint8Array | ArrayBuffer, charset?: string | null): string;
/**
 * Decodes the bytes of a text part: in the declared charset, otherwise in the one an html
 * part names for itself, otherwise as UTF-8 or windows-1252 depending on what the bytes
 * turn out to be, see decodeUtf8OrWindows1252.
 *
 * @param bytes Decoded body of the part
 * @param charset The charset parameter of the Content-Type, if any
 * @param html Whether the part is html, which may name its own charset
 * @return The text of the part
 */
export declare function decodeText(bytes: ArrayBuffer, charset: string | undefined, html: boolean): string;
/**
 * Converts a Blob into an ArrayBuffer
 * @param blob Blob to convert
 * @returns Converted value
 */
export declare function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer>;
/**
 * Numeric value of an ASCII hex digit
 *
 * @param c Byte to read
 * @return Value 0-15, or -1 if the byte is not a hex digit
 */
export declare function hexNibble(c: number): number;
/**
 * Folds the line breaks of a header value into spaces.
 *
 * A header value holds no line breaks. The raw value is folded when the headers are
 * processed, see processHeaders in mime-node.ts, an RFC 2047 encoded word is folded as it
 * is decoded, and an RFC 2231 filename is folded where the attachment is built. Otherwise a
 * decoded name, subject or filename written into a header of an outgoing message by the
 * consumer ends the header early and starts another one with the rest of the value.
 *
 * The RFC 2231 percent decoder itself does not fold: it also produces the boundary, and a
 * boundary holding a line break can never match a line. That has to stay so, or a message
 * that has no parts for every other parser would have them here.
 *
 * @param str Header value
 * @return The value with every run of CR and LF replaced by a space
 */
export declare function foldLineBreaks(str: string): string;
/**
 * Decode a complete mime word encoded string
 *
 * @param charset Character set of the encoded word
 * @param encoding `Q` or `B`
 * @param str Mime word encoded string
 * @return Decoded unicode string
 */
export declare function decodeWord(charset: string, encoding: string, str: string): string;
/**
 * Checks whether a string is nothing but RFC 2047 encoded words. Kept next to the grammar
 * it depends on, so the pattern has a single definition.
 *
 * @param str String to check
 * @return true if the string holds encoded words and nothing else
 */
export declare function isEncodedWordsOnly(str: string): boolean;
/**
 * Decodes RFC 2047 encoded words in a string
 *
 * @param str String that may contain encoded words
 * @return Unicode string with every encoded word decoded
 */
export declare function decodeWords(str: string): string;
export declare function decodeURIComponentWithCharset(encodedStr: string, charset?: string | null): string;
/**
 * A structured header value such as `text/plain; charset=utf-8`, split into the
 * lowercased value and its parameters
 */
export interface StructuredHeader {
    value: string;
    params: Record<string, string>;
}
export declare function decodeParameterValueContinuations(header: StructuredHeader): void;
//# sourceMappingURL=decode-strings.d.ts.map