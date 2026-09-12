import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { NotFoundException } from '@nestjs/common';
import { PrivacyService } from './privacy.service';
import { UsersService } from 'src/users/users.service';
import { ProfileService } from 'src/profile/profile.service';
import { AddressService } from 'src/address/address.service';
import { PortfolioService } from 'src/portfolio/portfolio.service';
import { SubscriptionService } from 'src/subscription/subscription.service';
import { TokenBlacklistService } from 'src/token-blacklist/token-blacklist.service';

describe('PrivacyService', () => {
	let service: PrivacyService;

	const usersService = {
		findOne: jest.fn(),
		delete: jest.fn(),
	};
	const profileService = { findOne: jest.fn() };
	const addressService = { findByUserId: jest.fn() };
	const portfolioService = { getUserPortfolios: jest.fn() };
	const subscriptionService = { findUserSubscription: jest.fn() };
	const tokenBlacklistService = { addToBlacklist: jest.fn() };

	const tradeModel = {
		find: jest.fn(),
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			imports: [JwtModule.register({ secret: 'test-secret' })],
			providers: [
				PrivacyService,
				{ provide: getModelToken('Trade'), useValue: tradeModel },
				{ provide: UsersService, useValue: usersService },
				{ provide: ProfileService, useValue: profileService },
				{ provide: AddressService, useValue: addressService },
				{ provide: PortfolioService, useValue: portfolioService },
				{ provide: SubscriptionService, useValue: subscriptionService },
				{ provide: TokenBlacklistService, useValue: tokenBlacklistService },
			],
		}).compile();

		service = module.get<PrivacyService>(PrivacyService);
		module.get<JwtService>(JwtService);
	});

	afterEach(() => jest.clearAllMocks());

	describe('exportUserData', () => {
		it('aggregates account, profile, addresses, portfolios, transactions and subscription', async () => {
			usersService.findOne.mockResolvedValue({
				toObject: () => ({
					_id: 'user-1',
					email: 'a@b.com',
					password: 'hash',
					refreshToken: 'rt',
					resetPasswordToken: 'rpt',
					resetPasswordExpires: new Date(),
					twoFactorSecret: 'secret',
				}),
			});
			profileService.findOne.mockResolvedValue({ phone: '123' });
			addressService.findByUserId.mockResolvedValue([{ city: 'SP' }]);
			portfolioService.getUserPortfolios.mockResolvedValue([
				{ name: 'Carteira' },
			]);
			subscriptionService.findUserSubscription.mockResolvedValue({
				status: 'active',
			});
			tradeModel.find.mockReturnValue({
				lean: () => ({ exec: () => Promise.resolve([{ symbol: 'PETR4' }]) }),
			});

			const result = await service.exportUserData('user-1');

			// Dados sensiveis de autenticacao nunca podem vazar na exportacao.
			expect(result.account.password).toBeUndefined();
			expect(result.account.refreshToken).toBeUndefined();
			expect(result.account.resetPasswordToken).toBeUndefined();
			expect(result.account.twoFactorSecret).toBeUndefined();
			expect(result.account.email).toBe('a@b.com');
			expect(result.profile).toEqual({ phone: '123' });
			expect(result.addresses).toEqual([{ city: 'SP' }]);
			expect(result.portfolios).toEqual([{ name: 'Carteira' }]);
			expect(result.transactions).toEqual([{ symbol: 'PETR4' }]);
			expect(result.subscription).toEqual({ status: 'active' });
		});

		it('throws when the user does not exist', async () => {
			usersService.findOne.mockResolvedValue(null);
			profileService.findOne.mockResolvedValue(null);
			addressService.findByUserId.mockResolvedValue([]);
			portfolioService.getUserPortfolios.mockResolvedValue([]);
			subscriptionService.findUserSubscription.mockResolvedValue(null);
			tradeModel.find.mockReturnValue({
				lean: () => ({ exec: () => Promise.resolve([]) }),
			});

			await expect(service.exportUserData('nope')).rejects.toThrow(
				NotFoundException
			);
		});

		it('does not fail the whole export when profile/address/portfolio/subscription lookups reject', async () => {
			usersService.findOne.mockResolvedValue({
				toObject: () => ({ _id: 'user-1', email: 'a@b.com' }),
			});
			profileService.findOne.mockRejectedValue(new NotFoundException());
			addressService.findByUserId.mockRejectedValue(new Error('down'));
			portfolioService.getUserPortfolios.mockRejectedValue(new Error('down'));
			subscriptionService.findUserSubscription.mockRejectedValue(
				new Error('down')
			);
			tradeModel.find.mockReturnValue({
				lean: () => ({ exec: () => Promise.resolve([]) }),
			});

			const result = await service.exportUserData('user-1');

			expect(result.profile).toBeNull();
			expect(result.addresses).toEqual([]);
			expect(result.portfolios).toEqual([]);
			expect(result.subscription).toBeNull();
		});
	});

	describe('deleteOwnAccount', () => {
		it('deletes the user and blacklists the current token', async () => {
			usersService.delete.mockResolvedValue({ _id: 'user-1' });
			const module = await Test.createTestingModule({
				imports: [JwtModule.register({ secret: 'test-secret' })],
				providers: [
					PrivacyService,
					{ provide: getModelToken('Trade'), useValue: tradeModel },
					{ provide: UsersService, useValue: usersService },
					{ provide: ProfileService, useValue: profileService },
					{ provide: AddressService, useValue: addressService },
					{ provide: PortfolioService, useValue: portfolioService },
					{ provide: SubscriptionService, useValue: subscriptionService },
					{ provide: TokenBlacklistService, useValue: tokenBlacklistService },
				],
			}).compile();
			service = module.get<PrivacyService>(PrivacyService);
			const jwtService = module.get<JwtService>(JwtService);
			const token = jwtService.sign({ userId: 'user-1' }, { expiresIn: '1h' });

			const result = await service.deleteOwnAccount('user-1', token);

			expect(usersService.delete).toHaveBeenCalledWith('user-1');
			expect(tokenBlacklistService.addToBlacklist).toHaveBeenCalledWith(
				token,
				expect.any(Number)
			);
			expect(result.message).toBe('Conta removida com sucesso.');
		});

		it('throws when the account does not exist', async () => {
			usersService.delete.mockResolvedValue(null);

			await expect(service.deleteOwnAccount('nope')).rejects.toThrow(
				NotFoundException
			);
		});

		it('still deletes the account when blacklisting an invalid token fails', async () => {
			usersService.delete.mockResolvedValue({ _id: 'user-1' });
			tokenBlacklistService.addToBlacklist.mockRejectedValueOnce(
				new Error('db down')
			);

			await expect(
				service.deleteOwnAccount('user-1', 'not-a-real-jwt')
			).resolves.toEqual({ message: 'Conta removida com sucesso.' });
		});
	});
});
