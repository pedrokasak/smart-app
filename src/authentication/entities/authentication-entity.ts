import { ApiProperty } from '@nestjs/swagger';

export class UserResponse {
	@ApiProperty()
	id: string;

	@ApiProperty()
	email: string;

	@ApiProperty()
	firstName?: string;

	@ApiProperty()
	lastName?: string;
}

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

	@ApiProperty({
		description: 'Dados do usuário',
		type: String,
		example: {
			id: '123',
			email: 'teste@teste.com',
			firstName: 'John',
			lastName: 'Doe',
		},
	})
	user: UserResponse;
}
