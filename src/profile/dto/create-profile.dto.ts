import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { IsCpf } from 'src/utils/decorators';

export class CreateProfileDto {
	@ApiProperty()
	@IsString()
	@IsNotEmpty({ message: 'The user ID is required' })
	userId: string;

	@ApiProperty({ required: false })
	@IsOptional()
	@IsString()
	permissionId?: string;

	@IsString()
	@IsCpf()
	@IsNotEmpty({ message: 'CPF is required' })
	cpf: string;

	@ApiProperty({ type: [String], required: false })
	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	permissions?: string[];
}
