import ChunkWriter from './chunk-writer.js';
export default class QPDecoder {
    output: ChunkWriter;
    /** the line break of the last line, written once the next line arrives, see update */
    pendingLineBreak: Uint8Array | null;
    constructor();
    writeLineBreak(): void;
    update(line: Uint8Array, lineBreak: Uint8Array): void;
    finalize(boundaryEnded?: boolean): Promise<ArrayBuffer>;
}
//# sourceMappingURL=qp-decoder.d.ts.map