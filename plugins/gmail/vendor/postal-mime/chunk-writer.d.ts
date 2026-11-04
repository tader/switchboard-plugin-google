/**
 * Collects decoded content in fixed size chunks, so memory follows the number of bytes
 * written rather than the number of writes. Decoders that write many short runs, such as
 * a quoted-printable line or a base64 body that pads every line, would otherwise hold a
 * buffer per run.
 */
export default class ChunkWriter {
    maxChunkSize: number;
    buffer: Uint8Array<ArrayBuffer> | null;
    bufferPos: number;
    chunks: Uint8Array<ArrayBuffer>[];
    constructor(maxChunkSize?: number);
    writeByte(byte: number): void;
    writeBytes(bytes: Uint8Array, start?: number, end?: number): void;
    /**
     * Keeps a buffer the caller hands over and will not touch again. A large one is kept as
     * a chunk of its own instead of being copied, a small one is copied like any other write.
     */
    append(bytes: Uint8Array<ArrayBuffer>): void;
    flush(): void;
    finalize(): Promise<ArrayBuffer>;
}
//# sourceMappingURL=chunk-writer.d.ts.map