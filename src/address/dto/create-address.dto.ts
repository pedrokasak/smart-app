import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum, IsNotEmpty } from 'class-validator';
import { AddressType } from '../schema/address.model';

export class CreateAddressDto {
	@ApiProperty()
	@IsString()
	@IsNotEmpty({ message: 'O ID do usuário é obrigatório' })
	userId: string;

	@ApiProperty({
		description: 'Rua/Avenida do endereço',
		example: 'Rua das Flores',
	})
	@IsString()
	@IsNotEmpty({ message: 'A rua é obrigatória' })
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
	@IsNotEmpty({ message: 'O bairro é obrigatório' })
	neighborhood: string;

	@ApiProperty({
		description: 'Cidade do endereço',
		example: 'São Paulo',
	})
	@IsString()
	@IsNotEmpty({ message: 'A cidade é obrigatória' })
	city: string;

	@ApiProperty({
		description: 'Estado do endereço',
		example: 'SP',
	})
	@IsString()
	@IsNotEmpty({ message: 'O estado é obrigatório' })
	state: string;

	@ApiProperty({
		description: 'CEP do endereço',
		example: '01234-567',
	})
	@IsString()
	@IsNotEmpty({ message: 'O CEP é obrigatório' })
	zipCode: string;

	@ApiProperty({
		description: 'Tipo do endereço',
		enum: AddressType,
		default: AddressType.HOME,
	})
	@IsEnum(AddressType)
	@IsOptional()
	type?: AddressType;
}
