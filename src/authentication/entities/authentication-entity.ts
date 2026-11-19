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

	@ApiProperty()
	role?: string;
}

/**
 * Resposta dos logins. Conta com 2FA recebe só `requiresTwoFactor` e
 * `tempToken`; as demais recebem a sessão.
 */
export class AuthenticationEntity {
	@ApiProperty({ required: false })
	requiresTwoFactor?: boolean;

	@ApiProperty({
		description: 'Token de 5 minutos para concluir o 2FA',
		required: false,
	})
	tempToken?: string;

	@ApiProperty({
		required: false,
		description: 'Access token para autenticação de requisições',
		example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
	})
	accessToken: string;

	@ApiProperty({
		required: false,
		description: 'Refresh token para renovar o access token',
		example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
	})
	refreshToken: string;

	@ApiProperty({
		required: false,
		description: 'Tempo de expiração do access token',
		example: '15m',
	})
	expiresIn: string;

	@ApiProperty({
		required: false,
		description: 'Dados do usuário',
		type: UserResponse,
		example: {
			id: '123',
			email: 'teste@teste.com',
			firstName: 'John',
			lastName: 'Doe',
		},
	})
	user: UserResponse;
}
