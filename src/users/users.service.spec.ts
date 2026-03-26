import { Test, TestingModule } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { UsersService } from './users.service';
import { UserModel } from './schema/user.model';
import { EmailService } from 'src/notifications/email/email.service';
import { PasswordSecurityService } from 'src/authentication/security/password-security.service';

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
	let jwtService: JwtService;

	const emailService = {
		sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
	};

	const passwordSecurityService = {
		hashPassword: jest.fn().mockResolvedValue('argon2-hash'),
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			imports: [JwtModule.register({ secret: 'test-secret' })],
			providers: [
				UsersService,
				{ provide: EmailService, useValue: emailService },
				{ provide: PasswordSecurityService, useValue: passwordSecurityService },
			],
		}).compile();

		service = module.get<UsersService>(UsersService);
		jwtService = module.get<JwtService>(JwtService);
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
			emailService.sendWelcomeEmail.mockRejectedValueOnce(new Error('mail down'));

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
	});
});
