import { ApiProperty } from '@nestjs/swagger';

export class ZipCodeResponseDto {
	@ApiProperty({
		description: 'CEP formatado',
		example: '01001-000',
	})
	zipCode: string;

	@ApiProperty({
		description: 'Logradouro',
		example: 'Praça da Sé',
	})
	street: string;

	@ApiProperty({
		description: 'Complemento',
		example: 'lado ímpar',
		required: false,
	})
	complement?: string;

	@ApiProperty({
		description: 'Bairro',
		example: 'Sé',
	})
	neighborhood: string;

	@ApiProperty({
		description: 'Cidade',
		example: 'São Paulo',
	})
	city: string;

	@ApiProperty({
		description: 'Estado (UF)',
		example: 'SP',
	})
	state: string;
}
