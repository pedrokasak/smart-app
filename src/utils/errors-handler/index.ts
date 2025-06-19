import {
	BadRequestException,
	NotFoundException,
	UnauthorizedException,
} from '@nestjs/common';

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

	static handleUserAlreadyExists(email: string): never {
		throw new NotFoundException(`User already exists for email: ${email}`);
	}

	static handleInvalidConfirmPassword(): never {
		throw new UnauthorizedException('Invalid confirm password');
	}
}

export class ProfileErrorService {
	static handleCpfAlreadyExists(cpf: string): never {
		throw new BadRequestException(`CPF already exists: ${cpf}`);
	}
}
