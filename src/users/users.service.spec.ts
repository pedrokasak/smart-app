import { Test, TestingModule } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { UsersService } from './users.service';
import { UserModel } from './schema/user.model';
import { EmailService } from 'src/notifications/email/email.service';
import { PasswordSecurityService } from 'src/authentication/security/password-security.service';
import { RAG_ERASURE } from 'src/users/application/rag-erasure.port';
import { BreachedPasswordPolicy } from 'src/authentication/application/breached-password.policy';
import {
	BreachedPasswordChecker,
	BreachedPasswordVerdict,
} from 'src/authentication/application/ports/breached-password-checker.port';

jest.mock('./schema/user.model', () => {
	const mockUserModel = jest.fn().mockImplementation(() => ({
		save: jest.fn(),
	}));

	(mockUserModel as any).findOne = jest.fn();
	(mockUserModel as any).findById = jest.fn();
	(mockUserModel as any).findByIdAndUpdate = jest.fn();
	(mockUserModel as any).findByIdAndDelete = jest.fn();
	(mockUserModel as any).find = jest.fn();

	return { UserModel: mockUserModel };
});

describe('UsersService', () => {
	let service: UsersService;

	const emailService = {
		sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
	};

	const passwordSecurityService = {
		hashPassword: jest.fn().mockResolvedValue('argon2-hash'),
	};

	const ragErasure = {
		eraseUserData: jest.fn().mockResolvedValue({ erased: true }),
	};

	/**
	 * TRK-012: a politica REAL, com a porta trocada por um stub. Assim o
	 * teste exercita a decisao de politica de verdade (o que faz com cada
	 * veredito) sem tocar na rede.
	 */
	let verdictoAtual: BreachedPasswordVerdict = 'not_breached';
	const breachedChecker: BreachedPasswordChecker = {
		check: jest.fn(async () => verdictoAtual),
	};

	beforeEach(async () => {
		verdictoAtual = 'not_breached';
		const module: TestingModule = await Test.createTestingModule({
			imports: [JwtModule.register({ secret: 'test-secret' })],
			providers: [
				UsersService,
				{ provide: EmailService, useValue: emailService },
				{ provide: PasswordSecurityService, useValue: passwordSecurityService },
				{ provide: RAG_ERASURE, useValue: ragErasure },
				{
					provide: BreachedPasswordPolicy,
					useValue: new BreachedPasswordPolicy(breachedChecker),
				},
			],
		}).compile();

		service = module.get<UsersService>(UsersService);
		// JwtService é resolvido para satisfazer a dependência do módulo, mas
		// não é usado diretamente nos testes — descartamos o valor.
		module.get<JwtService>(JwtService);
	});

	afterEach(() => jest.clearAllMocks());

	describe('create', () => {
		it('should create user with valid password', async () => {
			(UserModel.findOne as jest.Mock).mockResolvedValue(null);

			const mockSave = jest.fn().mockResolvedValue(true);
			(UserModel as any).mockImplementationOnce(() => ({
				_id: 'u1',
				id: 'u1',
				firstName: 'Pedro',
				lastName: 'SantAnna',
				email: 'pedro@example.com',
				password: 'argon2-hash',
				save: mockSave,
			}));

			const result = await service.create({
				firstName: 'Pedro',
				lastName: 'SantAnna',
				email: 'pedro@example.com',
				password: 'Password123@',
				confirmPassword: 'Password123@',
				avatar: 'http://example.com/avatar.jpg',
			});

			expect(passwordSecurityService.hashPassword).toHaveBeenCalledWith(
				'Password123@'
			);
			expect(mockSave).toHaveBeenCalled();
			expect(emailService.sendWelcomeEmail).toHaveBeenCalledWith(
				'pedro@example.com',
				'Pedro'
			);
			expect(result.message).toBe('User created successfully');
			expect(result.accessToken).toBeDefined();
		});

		it('should throw if email already exists', async () => {
			(UserModel.findOne as jest.Mock).mockResolvedValue({
				email: 'pedro@example.com',
			});

			await expect(
				service.create({
					firstName: 'Pedro',
					lastName: 'SantAnna',
					email: 'pedro@example.com',
					password: 'Password123@',
					confirmPassword: 'Password123@',
					avatar: 'http://example.com/avatar.jpg',
				})
			).rejects.toThrow(HttpException);
		});

		it('should throw if password confirmation diverges', async () => {
			(UserModel.findOne as jest.Mock).mockResolvedValue(null);

			await expect(
				service.create({
					firstName: 'Pedro',
					lastName: 'SantAnna',
					email: 'pedro@example.com',
					password: 'Password123@',
					confirmPassword: 'Wrong123@',
					avatar: 'http://example.com/avatar.jpg',
				})
			).rejects.toThrow(HttpException);
		});

		it('should continue when welcome email fails', async () => {
			(UserModel.findOne as jest.Mock).mockResolvedValue(null);
			emailService.sendWelcomeEmail.mockRejectedValueOnce(
				new Error('mail down')
			);

			const mockSave = jest.fn().mockResolvedValue(true);
			(UserModel as any).mockImplementationOnce(() => ({
				_id: 'u2',
				id: 'u2',
				firstName: 'Maria',
				lastName: 'Silva',
				email: 'maria@example.com',
				password: 'argon2-hash',
				save: mockSave,
			}));

			const result = await service.create({
				firstName: 'Maria',
				lastName: 'Silva',
				email: 'maria@example.com',
				password: 'Password123@',
				confirmPassword: 'Password123@',
				avatar: 'http://example.com/avatar.jpg',
			});

			expect(result.message).toBe('User created successfully');
			expect(result.accessToken).toBeDefined();
		});

		/**
		 * TRK-012 (ASVS 5.0 6.2.12). Fica no FIM do describe de proposito:
		 * `mockImplementationOnce` no construtor de `UserModel` e uma fila
		 * global, e um teste que enfileira sem consumir (porque a criacao foi
		 * recusada antes) empurraria a implementacao para o teste seguinte.
		 */
		describe('senha vazada', () => {
			const dadosDeCadastro = {
				firstName: 'Pedro',
				lastName: 'SantAnna',
				email: 'pedro@example.com',
				password: 'Password123@',
				confirmPassword: 'Password123@',
				avatar: 'http://example.com/avatar.jpg',
			};

			function prepararCadastro() {
				(UserModel.findOne as jest.Mock).mockResolvedValue(null);
				const save = jest.fn().mockResolvedValue(true);
				(UserModel as any).mockImplementationOnce(() => ({
					_id: 'u1',
					id: 'u1',
					...dadosDeCadastro,
					save,
				}));
				return save;
			}

			it('recusa o cadastro quando a senha esta em vazamento', async () => {
				verdictoAtual = 'breached';
				(UserModel.findOne as jest.Mock).mockResolvedValue(null);

				const erro = await service
					.create(dadosDeCadastro)
					.then(() => null)
					.catch((e) => e);

				expect(erro).toBeInstanceOf(HttpException);
				// A mensagem precisa dizer o que houve e o que fazer — nao
				// "senha invalida", que nao daria ao usuario nenhuma saida.
				expect((erro.getResponse() as any).error).toMatch(
					/vazamentos públicos/i
				);
				// Nem chega a construir o usuario nem a gastar Argon2id.
				expect(UserModel).not.toHaveBeenCalled();
				expect(passwordSecurityService.hashPassword).not.toHaveBeenCalled();
			});

			it('aceita o cadastro quando a senha nao esta em vazamento', async () => {
				verdictoAtual = 'not_breached';
				const save = prepararCadastro();

				const resultado = await service.create(dadosDeCadastro);

				expect(resultado.message).toBe('User created successfully');
				expect(save).toHaveBeenCalled();
			});

			/**
			 * O teste que da nome a decisao: com o HIBP fora do ar o adaptador
			 * devolve `unknown`, e o cadastro TEM que continuar funcionando.
			 * Bloquear aqui trocaria um ganho pequeno de seguranca por uma
			 * indisponibilidade acionavel por terceiro.
			 */
			it('HIBP indisponivel NAO impede o cadastro (falha aberta)', async () => {
				verdictoAtual = 'unknown';
				const save = prepararCadastro();

				const resultado = await service.create(dadosDeCadastro);

				expect(resultado.message).toBe('User created successfully');
				expect(save).toHaveBeenCalled();
				expect(passwordSecurityService.hashPassword).toHaveBeenCalledWith(
					'Password123@'
				);
			});
		});
	});

	describe('delete (TRA-78 — LGPD)', () => {
		beforeEach(() => {
			ragErasure.eraseUserData.mockClear();
		});

		it('erases the user RAG data after deleting the account', async () => {
			(UserModel as any).findByIdAndDelete.mockResolvedValue({ _id: 'user-1' });

			await service.delete('user-1');

			expect(ragErasure.eraseUserData).toHaveBeenCalledWith('user-1');
		});

		it('does not erase RAG data when no user was deleted', async () => {
			// Sem isso, um id inexistente dispararia exclusao de dado de outro
			// usuario se o id fosse reaproveitado — e gastaria chamada a toa.
			(UserModel as any).findByIdAndDelete.mockResolvedValue(null);

			await service.delete('nao-existe');

			expect(ragErasure.eraseUserData).not.toHaveBeenCalled();
		});

		it('still completes the account deletion when RAG erasure fails', async () => {
			// Recusar a exclusao da conta porque um servico secundario esta fora
			// negaria ao usuario o direito que esta rotina existe pra atender.
			(UserModel as any).findByIdAndDelete.mockResolvedValue({ _id: 'user-1' });
			ragErasure.eraseUserData.mockResolvedValueOnce({
				erased: false,
				failureReason: 'ECONNREFUSED',
			});

			await expect(service.delete('user-1')).resolves.toEqual({
				_id: 'user-1',
			});
		});
	});
});
