import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { buildScannedPdfVisualBatches } from './scannedPdfVisualFallback';

async function createPdf(pageCount: number): Promise<Buffer> {
    const doc = await PDFDocument.create();
    for (let i = 0; i < pageCount; i++) {
        doc.addPage([200, 200]);
    }
    return Buffer.from(await doc.save());
}

describe('scannedPdfVisualFallback', () => {
    it('splits scanned PDFs into stable visual page batches', async () => {
        const pdfA = await createPdf(7);
        const pdfB = await createPdf(3);

        const batches = await buildScannedPdfVisualBatches([
            { buffer: pdfA, fileName: 'parte-1.pdf' },
            { buffer: pdfB, fileName: 'parte-2.pdf' },
        ], { pagesPerBatch: 3 });

        expect(batches.map(batch => ({
            fileName: batch.fileName,
            startPage: batch.startPage,
            endPage: batch.endPage,
            pageCount: batch.pageCount,
            globalBatchIndex: batch.globalBatchIndex,
            totalGlobalBatches: batch.totalGlobalBatches,
        }))).toEqual([
            { fileName: 'parte-1.pdf', startPage: 1, endPage: 3, pageCount: 3, globalBatchIndex: 1, totalGlobalBatches: 4 },
            { fileName: 'parte-1.pdf', startPage: 4, endPage: 6, pageCount: 3, globalBatchIndex: 2, totalGlobalBatches: 4 },
            { fileName: 'parte-1.pdf', startPage: 7, endPage: 7, pageCount: 1, globalBatchIndex: 3, totalGlobalBatches: 4 },
            { fileName: 'parte-2.pdf', startPage: 1, endPage: 3, pageCount: 3, globalBatchIndex: 4, totalGlobalBatches: 4 },
        ]);

        for (const batch of batches) {
            const batchPdf = await PDFDocument.load(new Uint8Array(batch.pdfBuffer));
            expect(batchPdf.getPageCount()).toBe(batch.pageCount);
        }
    });
});
