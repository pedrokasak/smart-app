import { PartialType } from '@nestjs/swagger';
import { CreatePermissionDto } from './create-permission.dto';
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class UpdatePermissionDto extends PartialType(CreatePermissionDto) {
	@ApiProperty()
	@IsString()
	@IsNotEmpty({ message: 'The profile ID is required' })
	profileId: string;

	@ApiProperty()
	@IsString()
	@IsNotEmpty({
		message: 'The name permission is not empty',
	})
	@ApiProperty()
	name: string;
}
