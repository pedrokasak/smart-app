import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateProfileDto {
	@ApiProperty()
	@IsString()
	@IsNotEmpty({ message: 'The user ID is required' })
	userId: string;

	@ApiProperty({ required: false })
	@IsOptional()
	@IsString()
	permissionId?: string;

	@ApiProperty()
	@IsString()
	@IsNotEmpty({
		message: 'The Address is not empty',
	})
	@ApiProperty()
	address: string;

	@IsString()
	@IsNotEmpty({ message: 'CPF is required' })
	cpf: string;

	@ApiProperty({ type: [String], required: false })
	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	permissions?: string[];
}
