import { ApiProperty } from '@nestjs/swagger';

export class AuthenticationEntity {
	@ApiProperty({
		description: 'Access token para autenticação de requisições',
		example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
	})
	accessToken: string;

	@ApiProperty({
		description: 'Refresh token para renovar o access token',
		example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
	})
	refreshToken: string;

	@ApiProperty({
		description: 'Tempo de expiração do access token',
		example: '15m',
	})
	expiresIn: string;
}
