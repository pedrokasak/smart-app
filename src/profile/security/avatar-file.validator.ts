/**
 * Validação de imagem de avatar por assinatura de arquivo (TRA-89).
 *
 * O filtro anterior olhava só `file.mimetype` e derivava a extensão em disco
 * de `file.originalname` — os dois são enviados pelo cliente. Um arquivo
 * declarado como `image/png` e chamado `payload.html` era gravado como
 * `<uuid>.html` com conteúdo arbitrário, e a URL voltava pro frontend.
 *
 * Aqui a extensão gravada vem da assinatura real do conteúdo, nunca do nome
 * enviado. Mesma abordagem de `broker-sync/security/upload-file.validator.ts`,
 * com os formatos que o produto aceita.
 *
 * SVG fica de fora de propósito: é XML, executa script quando servido inline,
 * e não tem magic bytes confiável.
 */

export type AvatarImageKind = 'jpeg' | 'png' | 'webp' | 'unknown';

const EXTENSION_BY_KIND: Record<Exclude<AvatarImageKind, 'unknown'>, string> = {
	jpeg: '.jpg',
	png: '.png',
	webp: '.webp',
};

function hasJpegMagic(buffer: Buffer): boolean {
	return (
		buffer.length >= 3 &&
		buffer[0] === 0xff &&
		buffer[1] === 0xd8 &&
		buffer[2] === 0xff
	);
}

function hasPngMagic(buffer: Buffer): boolean {
	const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	return (
		buffer.length >= 8 &&
		signature.every((byte, index) => buffer[index] === byte)
	);
}

/** WebP é um container RIFF: "RIFF" nos bytes 0-3 e "WEBP" nos 8-11. */
function hasWebpMagic(buffer: Buffer): boolean {
	return (
		buffer.length >= 12 &&
		buffer.slice(0, 4).toString('ascii') === 'RIFF' &&
		buffer.slice(8, 12).toString('ascii') === 'WEBP'
	);
}

export function detectImageKind(buffer: Buffer): AvatarImageKind {
	if (!buffer || buffer.length < 12) return 'unknown';
	if (hasJpegMagic(buffer)) return 'jpeg';
	if (hasPngMagic(buffer)) return 'png';
	if (hasWebpMagic(buffer)) return 'webp';
	return 'unknown';
}

/** Extensão canônica do formato detectado — nunca a do nome enviado. */
export function extensionForImageKind(kind: AvatarImageKind): string {
	if (kind === 'unknown') {
		throw new Error('Formato de imagem não reconhecido.');
	}
	return EXTENSION_BY_KIND[kind];
}
