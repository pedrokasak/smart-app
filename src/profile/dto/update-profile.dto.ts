import { ApiProperty, PartialType } from '@nestjs/swagger';
import { CreateProfileDto } from './create-profile.dto';
import { IsString, IsOptional } from 'class-validator';
import { IsCpf } from 'src/utils/decorators';

export class UpdateProfileDto extends PartialType(CreateProfileDto) {
	@ApiProperty({ required: false })
	@IsOptional()
	@IsString()
	userId?: string;

	@ApiProperty({ required: false })
	@IsOptional()
	@IsString()
	@IsCpf()
	cpf?: string;

	@ApiProperty({ required: false })
	@IsOptional()
	permissions?: string[];
}
