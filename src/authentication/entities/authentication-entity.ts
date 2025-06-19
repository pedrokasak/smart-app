import { ApiProperty } from '@nestjs/swagger';
export class AuthenticationEntity {
	@ApiProperty()
	token: string;
	refreshToken: string;
	expiresIn: string;
}
