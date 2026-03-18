import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
	@IsString()
	@ApiProperty()
	@IsNotEmpty({ message: 'Token is required' })
	token: string;

	@MinLength(6)
	@ApiProperty()
	@IsNotEmpty({ message: 'The new password is not empty' })
	newPassword: string;

	@ApiPropertyOptional()
	@IsOptional()
	@IsString()
	tfCode?: string;
}
