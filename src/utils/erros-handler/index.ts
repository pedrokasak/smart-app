import { NotFoundException, UnauthorizedException } from '@nestjs/common';

export class AuthErrorService {
	static handleUserNotFound(email: string): never {
		throw new NotFoundException(`No user found for email: ${email}`);
	}

	static handleInvalidPassword(): never {
		throw new UnauthorizedException('Invalid password');
	}

	static handleInvalidToken(): never {
		throw new UnauthorizedException('Invalid token');
	}
}
