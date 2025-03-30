import { ApiProperty } from '@nestjs/swagger';
export class AuthenticationEntity {
	@ApiProperty()
	token: string;
	expiresIn: string;
}
