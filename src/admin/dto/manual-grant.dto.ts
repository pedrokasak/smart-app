import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsMongoId, IsOptional, IsString } from 'class-validator';
import { ManualGrantType } from '../constants/admin.constants';
import { IsEnum } from 'class-validator';

export class ManualGrantDto {
	@ApiProperty()
	@IsEmail()
	email: string;

	@ApiProperty()
	@IsMongoId()
	planId: string;

	@ApiProperty({ enum: Object.values(ManualGrantType) })
	@IsEnum(ManualGrantType)
	grantType: ManualGrantType;

	@ApiPropertyOptional()
	@IsOptional()
	@IsString()
	notes?: string;
}
