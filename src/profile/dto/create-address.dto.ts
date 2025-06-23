import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum } from 'class-validator';
import { AddressType } from '../schema/address.model';

export class CreateAddressDto {
	@ApiProperty()
	userId: string;

	@ApiProperty({
		description: 'Rua/Avenida do endereço',
		example: 'Rua das Flores',
	})
	@IsString()
	street: string;

	@ApiProperty({
		description: 'Número do endereço',
		example: '123',
		required: false,
	})
	@IsOptional()
	@IsString()
	number?: string;

	@ApiProperty({
		description: 'Complemento do endereço',
		example: 'Apto 45, Bloco B',
		required: false,
	})
	@IsOptional()
	@IsString()
	complement?: string;

	@ApiProperty({
		description: 'Bairro do endereço',
		example: 'Centro',
	})
	@IsString()
	neighborhood: string;

	@ApiProperty({
		description: 'Cidade do endereço',
		example: 'São Paulo',
	})
	@IsString()
	city: string;

	@ApiProperty({
		description: 'Estado do endereço',
		example: 'SP',
	})
	@IsString()
	state: string;

	@ApiProperty({
		description: 'CEP do endereço',
		example: '01234-567',
	})
	@IsString()
	zipCode: string;

	@ApiProperty({
		description: 'Tipo do endereço',
		enum: AddressType,
		example: AddressType.HOME,
		default: AddressType.HOME,
	})
	@IsOptional()
	@IsEnum(AddressType)
	type?: AddressType;
}
