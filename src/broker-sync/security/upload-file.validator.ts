export type UploadDetectedKind = 'pdf' | 'csv' | 'xlsx' | 'xls' | 'unknown';

export type UploadValidationResult = {
	ok: boolean;
	reason?: string;
	detectedKind: UploadDetectedKind;
};

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.csv', '.xlsx', '.xls']);

function getExtension(fileName: string): string {
	const normalized = String(fileName || '').trim().toLowerCase();
	const dot = normalized.lastIndexOf('.');
	return dot >= 0 ? normalized.slice(dot) : '';
}

function hasPdfMagic(buffer: Buffer): boolean {
	return buffer.length >= 5 && buffer.slice(0, 5).toString('utf8') === '%PDF-';
}

function hasZipMagic(buffer: Buffer): boolean {
	return (
		buffer.length >= 4 &&
		buffer[0] === 0x50 &&
		buffer[1] === 0x4b &&
		buffer[2] === 0x03 &&
		buffer[3] === 0x04
	);
}

function hasOleMagic(buffer: Buffer): boolean {
	return (
		buffer.length >= 8 &&
		buffer[0] === 0xd0 &&
		buffer[1] === 0xcf &&
		buffer[2] === 0x11 &&
		buffer[3] === 0xe0 &&
		buffer[4] === 0xa1 &&
		buffer[5] === 0xb1 &&
		buffer[6] === 0x1a &&
		buffer[7] === 0xe1
	);
}

function looksLikeTextCsv(buffer: Buffer): boolean {
	if (buffer.length === 0) return false;
	const sample = buffer.slice(0, Math.min(buffer.length, 4096));
	let controlBytes = 0;
	for (const byte of sample) {
		const allowedControl =
			byte === 0x09 || byte === 0x0a || byte === 0x0d || byte === 0x20;
		const isVisibleAscii = byte >= 0x21 && byte <= 0x7e;
		const isUtf8High = byte >= 0x80;
		if (!allowedControl && !isVisibleAscii && !isUtf8High) {
			controlBytes += 1;
		}
	}
	if (controlBytes > 8) return false;

	const text = sample.toString('utf8').toLowerCase();
	if (
		text.includes('<script') ||
		text.includes('<img') ||
		text.includes('onerror=') ||
		text.includes('onload=')
	) {
		return false;
	}

	const hasDelimiter = text.includes(',') || text.includes(';') || text.includes('\t');
	return hasDelimiter;
}

export function detectUploadKind(buffer: Buffer): UploadDetectedKind {
	if (!buffer || buffer.length < 4) return 'unknown';
	if (hasPdfMagic(buffer)) return 'pdf';
	if (hasZipMagic(buffer)) return 'xlsx';
	if (hasOleMagic(buffer)) return 'xls';
	if (looksLikeTextCsv(buffer)) return 'csv';
	return 'unknown';
}

export function validateUploadFile(params: {
	buffer: Buffer;
	fileName: string;
	mimeType: string;
}): UploadValidationResult {
	const extension = getExtension(params.fileName);
	if (!ALLOWED_EXTENSIONS.has(extension)) {
		return {
			ok: false,
			reason: 'Extensão de arquivo não permitida',
			detectedKind: 'unknown',
		};
	}

	const detectedKind = detectUploadKind(params.buffer);
	if (detectedKind === 'unknown') {
		return {
			ok: false,
			reason: 'Não foi possível validar a assinatura do arquivo (magic bytes)',
			detectedKind,
		};
	}

	const kindByExtension: Record<string, UploadDetectedKind> = {
		'.pdf': 'pdf',
		'.csv': 'csv',
		'.xlsx': 'xlsx',
		'.xls': 'xls',
	};
	const expectedKind = kindByExtension[extension];
	if (expectedKind !== detectedKind) {
		return {
			ok: false,
			reason: 'Assinatura do arquivo incompatível com a extensão',
			detectedKind,
		};
	}

	const mime = String(params.mimeType || '').toLowerCase();
	const mimeLooksValid =
		(expectedKind === 'pdf' && mime.includes('pdf')) ||
		(expectedKind === 'csv' &&
			(mime.includes('csv') ||
				mime.includes('text/plain') ||
				mime.includes('vnd.ms-excel'))) ||
		(expectedKind === 'xlsx' &&
			(mime.includes('sheet') || mime.includes('zip'))) ||
		(expectedKind === 'xls' &&
			(mime.includes('excel') || mime.includes('octet-stream')));

	if (!mimeLooksValid) {
		return {
			ok: false,
			reason: 'MIME type incompatível com o conteúdo do arquivo',
			detectedKind,
		};
	}

	return { ok: true, detectedKind };
}
