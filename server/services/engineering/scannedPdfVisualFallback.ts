import { PDFDocument } from 'pdf-lib';

export interface ScannedPdfVisualBatchInput {
    buffer: Buffer;
    fileName: string;
}

export interface ScannedPdfVisualBatch {
    fileName: string;
    batchIndex: number;
    totalBatchesForFile: number;
    globalBatchIndex: number;
    totalGlobalBatches: number;
    startPage: number;
    endPage: number;
    pageCount: number;
    pdfBuffer: Buffer;
}

export interface BuildScannedPdfVisualBatchesOptions {
    pagesPerBatch?: number;
}

async function extractPageRange(pdfBuffer: Buffer, startIndex: number, endIndexExclusive: number): Promise<Buffer> {
    const srcDoc = await PDFDocument.load(new Uint8Array(pdfBuffer), { ignoreEncryption: true });
    const newDoc = await PDFDocument.create();
    const indices = Array.from(
        { length: Math.max(0, endIndexExclusive - startIndex) },
        (_, offset) => startIndex + offset
    );

    const copiedPages = await newDoc.copyPages(srcDoc, indices);
    for (const page of copiedPages) {
        newDoc.addPage(page);
    }

    return Buffer.from(await newDoc.save());
}

export async function buildScannedPdfVisualBatches(
    inputs: ScannedPdfVisualBatchInput[],
    options: BuildScannedPdfVisualBatchesOptions = {}
): Promise<ScannedPdfVisualBatch[]> {
    const pagesPerBatch = Math.max(1, options.pagesPerBatch ?? 6);
    const pending: Array<Omit<ScannedPdfVisualBatch, 'globalBatchIndex' | 'totalGlobalBatches'>> = [];

    for (const input of inputs) {
        const doc = await PDFDocument.load(new Uint8Array(input.buffer), { ignoreEncryption: true });
        const pageCount = doc.getPageCount();
        const totalBatchesForFile = Math.ceil(pageCount / pagesPerBatch);

        for (let batchIndex = 0; batchIndex < totalBatchesForFile; batchIndex++) {
            const startIndex = batchIndex * pagesPerBatch;
            const endIndexExclusive = Math.min(startIndex + pagesPerBatch, pageCount);
            const pdfBuffer = await extractPageRange(input.buffer, startIndex, endIndexExclusive);

            pending.push({
                fileName: input.fileName,
                batchIndex: batchIndex + 1,
                totalBatchesForFile,
                startPage: startIndex + 1,
                endPage: endIndexExclusive,
                pageCount: endIndexExclusive - startIndex,
                pdfBuffer,
            });
        }
    }

    const totalGlobalBatches = pending.length;
    return pending.map((batch, index) => ({
        ...batch,
        globalBatchIndex: index + 1,
        totalGlobalBatches,
    }));
}
