import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreatePermissionDto {
	@ApiProperty()
	@IsString()
	@IsOptional()
	profileId: string;

	@ApiProperty()
	@IsString()
	@IsNotEmpty({
		message: 'The name permission is not empty',
	})
	@ApiProperty()
	name: string;
}
