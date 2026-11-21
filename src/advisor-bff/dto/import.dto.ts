import { ApiProperty } from '@nestjs/swagger';

/** Corpo `multipart/form-data` documentado para o OpenAPI. */
export class ImportCsvBodyDto {
	@ApiProperty({
		type: 'string',
		format: 'binary',
		description: 'CSV (text/csv ou text/plain), UTF-8, até 1 MB',
	})
	file: unknown;
}

export class ImportResponseDto {
	@ApiProperty()
	importBatchId: string;

	@ApiProperty({ description: 'Linhas gravadas' })
	imported: number;
}

export class RevertImportResponseDto {
	@ApiProperty({ description: 'Transações removidas do livro' })
	removed: number;
}
