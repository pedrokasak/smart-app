import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class GoogleSigninDto {
	@ApiProperty({
		description: 'Google ID token returned by Google Identity Services',
	})
	@IsString()
	@IsNotEmpty()
	@MinLength(40)
	@MaxLength(4000)
	idToken: string;

	@ApiProperty({
		description: 'Whether session should be kept connected',
		required: false,
		default: false,
	})
	@IsBoolean()
	keepConnected = false;
}
