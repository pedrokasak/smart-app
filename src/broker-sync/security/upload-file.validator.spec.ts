import {
	detectUploadKind,
	validateUploadFile,
} from 'src/broker-sync/security/upload-file.validator';

describe('upload file validator', () => {
	it('accepts valid PDF by magic bytes + mime + extension', () => {
		const buffer = Buffer.concat([
			Buffer.from('%PDF-1.7\n', 'utf8'),
			Buffer.from('fake-pdf-content', 'utf8'),
		]);
		const result = validateUploadFile({
			buffer,
			fileName: 'nota.pdf',
			mimeType: 'application/pdf',
		});

		expect(result.ok).toBe(true);
		expect(result.detectedKind).toBe('pdf');
	});

	it('rejects MIME/extension spoofing', () => {
		const buffer = Buffer.concat([
			Buffer.from('%PDF-1.7\n', 'utf8'),
			Buffer.from('fake-pdf-content', 'utf8'),
		]);
		const result = validateUploadFile({
			buffer,
			fileName: 'nota.csv',
			mimeType: 'text/csv',
		});

		expect(result.ok).toBe(false);
		expect(result.reason).toContain('Assinatura');
	});

	it('rejects suspicious csv with image/script tracker payload', () => {
		const buffer = Buffer.from('ativo,preco\nPETR4,38\n<img src=x onerror=alert(1)>');
		expect(detectUploadKind(buffer)).toBe('unknown');
		const result = validateUploadFile({
			buffer,
			fileName: 'import.csv',
			mimeType: 'text/csv',
		});
		expect(result.ok).toBe(false);
	});
});
