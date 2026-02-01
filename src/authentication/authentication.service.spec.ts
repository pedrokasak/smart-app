import { Test, TestingModule } from '@nestjs/testing';
import { AuthenticationService } from './authentication.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { TokenBlacklistService } from 'src/token-blacklist/token-blacklist.service';
import { UserModel } from 'src/users/schema/user.model';
import { NotFoundException } from '@nestjs/common';

jest.mock('../env.ts', () => ({
	jwtSecret: 'fakeJwtSecretsdadxczxc,mfnlfnvlvnvlzmxcmv',
}));

jest.mock('./jwt-auth.guard', () => ({
	JwtAuthGuard: jest.fn().mockImplementation(() => true),
}));

jest.mock('src/users/schema/user.model', () => {
	const mockUserModel = {
		findOne: jest.fn(),
		findById: jest.fn(),
		findByIdAndUpdate: jest.fn(),
		findByIdAndDelete: jest.fn(),
		find: jest.fn(),
		select: jest.fn(),
		exec: jest.fn(),
	};

	return { UserModel: mockUserModel };
});
jest.mock('bcrypt');

describe('AuthenticationService', () => {
	let service: AuthenticationService;

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	let jwtService: JwtService;

	const mockJwtService = {
		sign: jest.fn(),
		verify: jest.fn(),
	};

	const mockTokenBlacklistService = {
		addToBlacklist: jest.fn(),
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				AuthenticationService,
				{ provide: JwtService, useValue: mockJwtService },
				{ provide: TokenBlacklistService, useValue: mockTokenBlacklistService },
			],
		}).compile();

		service = module.get<AuthenticationService>(AuthenticationService);
		jwtService = module.get<JwtService>(JwtService);
	});

	afterEach(() => jest.clearAllMocks());

	describe('SignIn', () => {
		beforeEach(() => {
			(UserModel.findOne as jest.Mock).mockReturnValue({
				exec: jest.fn().mockResolvedValue(null),
			});
			(bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
		});

		it('should sign in successfully', async () => {
			const mockUser = {
				id: '123',
				email: 'test@example.com',
				password: 'hashed-password',
				firstName: 'John',
				lastName: 'Doe',
				save: jest.fn(),
			};

			(UserModel.findOne as jest.Mock).mockReturnValue({
				select: jest.fn().mockReturnThis(),
				exec: jest.fn().mockResolvedValue(mockUser),
			});

			(bcrypt.compare as jest.Mock).mockResolvedValue(true);
			(jwtService.sign as jest.Mock).mockReturnValue('mocked-token');

			const result = await service.signin({
				email: 'test@example.com',
				password: '123456',
				keepConnected: false,
				token: '',
			});

			expect(UserModel.findOne).toHaveBeenCalledWith({
				email: 'test@example.com',
			});
			expect(bcrypt.compare).toHaveBeenCalledWith('123456', 'hashed-password');
			expect(jwtService.sign).toHaveBeenCalledTimes(2);
			expect(mockUser.save).toHaveBeenCalled();
			expect(result).toEqual(
				expect.objectContaining({
					accessToken: 'mocked-token',
					refreshToken: 'mocked-token',
					user: expect.objectContaining({
						email: 'test@example.com',
					}),
				})
			);
		});

		it('should throw an error if user is not found', async () => {
			(UserModel.findOne as jest.Mock).mockReturnValue({
				select: jest.fn().mockReturnThis(),
				exec: jest.fn().mockResolvedValue(null),
			});

			await expect(
				service.signin({
					email: 'test@example.com',
					password: '123456',
					keepConnected: false,
					token: '',
				})
			).rejects.toThrow(
				new NotFoundException('No user found for email: test@example.com')
			);
		});

		it('should throw an error if password is incorrect', async () => {
			const mockUser = {
				id: '123',
				email: 'test@example.com',
				password: 'hashed-password',
				firstName: 'John',
				lastName: 'Doe',
				save: jest.fn(),
			};

			(UserModel.findOne as jest.Mock).mockReturnValue({
				select: jest.fn().mockReturnThis(),
				exec: jest.fn().mockResolvedValue(mockUser),
			});

			(bcrypt.compare as jest.Mock).mockResolvedValue(false);

			await expect(
				service.signin({
					email: 'test@example.com',
					password: 'wrong-password',
					keepConnected: false,
					token: '',
				})
			).rejects.toThrowError('Invalid password');
		});

		it('should throw an error if email is invalid', async () => {
			(UserModel.findOne as jest.Mock).mockReturnValue({
				select: jest.fn().mockReturnThis(),
				exec: jest.fn().mockResolvedValue(null),
			});
			await expect(
				service.signin({
					email: 'invalid-email',
					password: '123456',
					keepConnected: false,
					token: '',
				})
			).rejects.toThrow(NotFoundException);
		});

		it('should throw an error if password is empty', async () => {
			(UserModel.findOne as jest.Mock).mockReturnValue({
				select: jest.fn().mockReturnThis(),
				exec: jest.fn().mockResolvedValue(null),
			});
			await expect(
				service.signin({
					email: 'test@example.com',
					password: '',
					keepConnected: false,
					token: '',
				})
			).rejects.toThrow('No user found for email: test@example.com');
		});

		it('should throw an error if email is empty', async () => {
			(UserModel.findOne as jest.Mock).mockReturnValue({
				select: jest.fn().mockReturnThis(),
				exec: jest.fn().mockResolvedValue(null),
			});
			await expect(
				service.signin({
					email: '',
					password: '123456',
					keepConnected: false,
					token: '',
				})
			).rejects.toThrow('No user found for email:');
		});

		it('should throw an error if token is not empty', async () => {
			(UserModel.findOne as jest.Mock).mockReturnValue({
				select: jest.fn().mockReturnThis(),
				exec: jest.fn().mockResolvedValue(null),
			});
			await expect(
				service.signin({
					email: 'test@example.com',
					password: '123456',
					keepConnected: false,
					token: 'mocked-token',
				})
			).rejects.toThrow('No user found for email: test@example.com');
		});

		it('should throw an error if user is not found', async () => {
			(UserModel.findOne as jest.Mock).mockReturnValue({
				select: jest.fn().mockReturnThis(),
				exec: jest.fn().mockResolvedValue(null),
			});

			await expect(
				service.signin({
					email: 'test@example.com',
					password: '123456',
					keepConnected: false,
					token: '',
				})
			).rejects.toThrow('No user found for email: test@example.com');
		});
	});
});
