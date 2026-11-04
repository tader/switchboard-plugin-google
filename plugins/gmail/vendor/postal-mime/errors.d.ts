declare const ERROR_TYPES: {
    EINVALIDOPTION: TypeErrorConstructor;
    EINVALIDINPUT: TypeErrorConstructor;
    EPARSERREUSED: ErrorConstructor;
    EMAXNESTINGDEPTH: ErrorConstructor;
    EMAXHEADERSIZE: ErrorConstructor;
    EMAXPARTCOUNT: ErrorConstructor;
    EMAXFORWARDEDADDRESSES: ErrorConstructor;
};
/**
 * Codes set on the errors postal-mime throws, so that callers can tell them apart without
 * matching the message text. The message of an error may change between releases, the
 * code does not.
 *
 * - `EINVALIDOPTION` a parser option has an invalid value (TypeError)
 * - `EINVALIDINPUT` the raw email is not of a supported type (TypeError)
 * - `EPARSERREUSED` `parse()` was called again on a parser instance that was already used
 * - `EMAXNESTINGDEPTH` MIME parts are nested deeper than `maxNestingDepth`
 * - `EMAXHEADERSIZE` the headers of the message are larger than `maxHeadersSize`
 * - `EMAXPARTCOUNT` the message has more MIME parts than `maxPartCount`
 * - `EMAXFORWARDEDADDRESSES` inline forwarded messages hold more addresses than `maxForwardedAddresses`
 */
export type ErrorCode = keyof typeof ERROR_TYPES;
/**
 * An Error thrown by postal-mime, with the code that identifies it
 */
export interface PostalMimeError extends Error {
    code: ErrorCode;
}
/**
 * Creates an error with a code
 *
 * @param code Error code
 * @param message Error message
 * @returns The error
 */
export declare function createError(code: ErrorCode, message: string): PostalMimeError;
export {};
//# sourceMappingURL=errors.d.ts.map