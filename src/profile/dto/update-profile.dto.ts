import { ApiProperty, PartialType } from '@nestjs/swagger';
import { CreateProfileDto } from './create-profile.dto';
import { IsString, IsNotEmpty } from 'class-validator';

export class UpdateProfileDto extends PartialType(CreateProfileDto) {
	@ApiProperty()
	@IsString()
	@IsNotEmpty({ message: 'The user ID is required' })
	userId: string;

	@ApiProperty()
	@IsString()
	@IsNotEmpty({ message: 'The permission ID is required' })
	permissionId: string;

	@ApiProperty()
	@IsString()
	@IsNotEmpty({
		message: 'The Address is not empty',
	})
	@ApiProperty()
	address: string;

	@ApiProperty()
	@IsString()
	@IsNotEmpty({ message: 'CPF is required' })
	cpf: string;
}
