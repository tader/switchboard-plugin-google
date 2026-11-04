import type { Address, AddressParserOptions } from './types.js';
/**
 * Parses structured e-mail addresses from an address field
 *
 * Example:
 *
 *    'Name <address@domain>'
 *
 * will be converted to
 *
 *     [{name: 'Name', address: 'address@domain'}]
 *
 * @param str Address field
 * @param options Optional options object
 * @return An array of address objects
 */
declare function addressParser(str: string, options?: AddressParserOptions): Address[];
export default addressParser;
//# sourceMappingURL=address-parser.d.ts.map