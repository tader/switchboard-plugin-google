export default class PassThroughDecoder {
    chunks: Uint8Array<ArrayBuffer>[];
    /** the buffer the current run of lines lives in, and the bounds of the run in it */
    runBuffer: ArrayBuffer | null;
    runStart: number;
    runEnd: number;
    /** the line break of the last line, written once the next line arrives */
    pendingLineBreak: Uint8Array<ArrayBuffer> | null;
    constructor();
    continuesRun(bytes: Uint8Array): boolean;
    flushRun(): void;
    update(line: Uint8Array<ArrayBuffer>, lineBreak: Uint8Array<ArrayBuffer>): void;
    finalize(boundaryEnded?: boolean): Promise<ArrayBuffer>;
}
//# sourceMappingURL=pass-through-decoder.d.ts.map