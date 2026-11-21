import {
	BadRequestException,
	UnsupportedMediaTypeException,
	applyDecorators,
	UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes } from '@nestjs/swagger';

/** Limite de transporte do CSV; o Multer recusa antes de ler o corpo todo. */
export const CSV_UPLOAD_MAX_BYTES = 1_048_576;
export const CSV_UPLOAD_FIELD = 'file';
const ALLOWED_MIME_TYPES = ['text/csv', 'text/plain'];

type FileFilterCallback = (error: Error | null, accept: boolean) => void;

/** Recusa o tipo errado já na abertura da parte, sem ler o conteúdo. */
function csvFileFilter(
	_req: unknown,
	file: { mimetype: string },
	callback: FileFilterCallback
): void {
	if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
		callback(null, true);
		return;
	}
	callback(
		new UnsupportedMediaTypeException({ reason: 'UNSUPPORTED_FILE_TYPE' }),
		false
	);
}

/**
 * `multipart/form-data` com um único arquivo no campo `file`: até 1 MB (413
 * `FILE_TOO_LARGE`) e só `text/csv` ou `text/plain` (415
 * `UNSUPPORTED_FILE_TYPE`). Em memória: o conteúdo nunca vai para disco nem
 * para log.
 */
export function CsvUpload(): MethodDecorator {
	return applyDecorators(
		ApiConsumes('multipart/form-data'),
		UseInterceptors(
			FileInterceptor(CSV_UPLOAD_FIELD, {
				limits: { fileSize: CSV_UPLOAD_MAX_BYTES, files: 1 },
				fileFilter: csvFileFilter,
			})
		)
	);
}

/** O arquivo vira texto UTF-8 antes de chegar ao serviço. */
export function csvTextOf(file: { buffer?: Buffer } | undefined): string {
	if (!file?.buffer) {
		throw new BadRequestException({ reason: 'FILE_REQUIRED' });
	}
	return file.buffer.toString('utf8');
}
