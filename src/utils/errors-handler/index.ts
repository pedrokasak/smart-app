import {
	BadRequestException,
	NotFoundException,
	UnauthorizedException,
} from '@nestjs/common';

export class AuthErrorService {
	/**
	 * Resposta única para "e-mail não existe" e "senha errada" (TRA-89).
	 *
	 * Separar os dois — 404 com o e-mail na mensagem versus 401 — entregava
	 * de graça quem tem conta na plataforma.
	 */
	static handleInvalidCredentials(): never {
		throw new UnauthorizedException('E-mail ou senha inválidos');
	}

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
	static handleInvalidCpf(cpf: string): never {
		throw new BadRequestException(`Invalid CPF: ${cpf}`);
	}
}
