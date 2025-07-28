import { ApiProperty, PartialType } from '@nestjs/swagger';
import { CreateProfileDto } from './create-profile.dto';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { IsCpf } from 'src/utils/decorators';

export class UpdateProfileDto extends PartialType(CreateProfileDto) {
	@ApiProperty()
	@IsString()
	@IsNotEmpty({ message: 'The user ID is required' })
	userId: string;

	@ApiProperty()
	@IsString()
	@IsOptional()
	permissionId: string;

	@ApiProperty()
	@IsString()
	@IsCpf()
	@IsNotEmpty({ message: 'CPF is required' })
	cpf: string;
}
