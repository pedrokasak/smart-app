import 'src/common/pdf/pdf-node-polyfill';
import { PDFParse } from 'pdf-parse';

/** Texto corrido de um PDF (todas as páginas). O parser é sempre destruído. */
export async function extractPdfText(buffer: Buffer): Promise<string> {
	const parser = new PDFParse({ data: buffer });
	try {
		const parsed = await parser.getText();
		return (parsed as any)?.text || (parsed as any)?.document || '';
	} finally {
		await parser.destroy();
	}
}
