import ChunkWriter from './chunk-writer.js';
export interface Base64DecoderOptions {
    decoder?: TextDecoder | undefined;
}
export default class Base64Decoder {
    decoder: TextDecoder;
    maxChunkSize: number;
    output: ChunkWriter;
    remainder: string;
    constructor(opts?: Base64DecoderOptions);
    pushChunk(base64Str: string): void;
    flushRemainder(): void;
    update(buffer: Uint8Array<ArrayBuffer>): void;
    finalize(): Promise<ArrayBuffer>;
}
//# sourceMappingURL=base64-decoder.d.ts.map