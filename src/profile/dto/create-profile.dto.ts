import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateProfileDto {
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

	@IsString()
	@IsNotEmpty({ message: 'CPF is required' })
	cpf: string;
}
