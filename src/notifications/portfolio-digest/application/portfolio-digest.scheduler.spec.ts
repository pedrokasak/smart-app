import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { PortfolioDigestScheduler } from './portfolio-digest.scheduler';
import { PortfolioDigestBuilderService } from './portfolio-digest-builder.service';
import { DigestUnsubscribeTokenService } from './digest-unsubscribe-token.service';
import { DIGEST_NARRATOR } from './digest-narrator.port';
import { EmailService } from 'src/notifications/email/email.service';
import { SubscriptionService } from 'src/subscription/subscription.service';
import { DigestNotificationsService } from './digest-notifications.service';

function user(overrides: Record<string, any> = {}) {
	return {
		_id: 'user-1',
		email: 'investidor@example.com',
		firstName: 'Pedro',
		notificationPreferences: { portfolioDigest: { enabled: true } },
		...overrides,
	};
}

const okFacts = {
	periodStart: '2026-08-11',
	periodEnd: '2026-08-18',
	portfolioValue: 10000,
	periodChangePct: 5,
	periodChangeAbs: 500,
	topGainers: [],
	topLosers: [],
	watchItems: [],
	dividendsReceived: null,
	hasSufficientData: true,
};

describe('PortfolioDigestScheduler', () => {
	let scheduler: PortfolioDigestScheduler;

	const mockUserModel = {
		find: jest.fn(),
		findByIdAndUpdate: jest.fn().mockResolvedValue({}),
	};
	const mockBuilder = { build: jest.fn() };
	const mockNarrator = { narrate: jest.fn() };
	const mockEmailService = { sendPortfolioDigestEmail: jest.fn() };
	const mockTokenService = { sign: jest.fn().mockReturnValue('signed-token') };
	const mockSubscriptionService = { findUserSubscription: jest.fn() };
	const mockDigestNotifications = { collect: jest.fn() };

	beforeEach(async () => {
		jest.clearAllMocks();
		mockBuilder.build.mockResolvedValue(okFacts);
		mockEmailService.sendPortfolioDigestEmail.mockResolvedValue(undefined);
		mockSubscriptionService.findUserSubscription.mockRejectedValue(
			new Error('not found')
		);
		mockDigestNotifications.collect.mockResolvedValue({
			items: [],
			omitted: 0,
		});

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				PortfolioDigestScheduler,
				{ provide: getModelToken('User'), useValue: mockUserModel },
				{ provide: PortfolioDigestBuilderService, useValue: mockBuilder },
				{ provide: DIGEST_NARRATOR, useValue: mockNarrator },
				{ provide: EmailService, useValue: mockEmailService },
				{
					provide: DigestUnsubscribeTokenService,
					useValue: mockTokenService,
				},
				{ provide: SubscriptionService, useValue: mockSubscriptionService },
				{
					provide: DigestNotificationsService,
					useValue: mockDigestNotifications,
				},
			],
		}).compile();

		scheduler = module.get<PortfolioDigestScheduler>(PortfolioDigestScheduler);
	});

	it('consulta só usuários com portfolioDigest.enabled true', async () => {
		mockUserModel.find.mockResolvedValue([]);

		await scheduler.sendWeeklyDigests();

		expect(mockUserModel.find).toHaveBeenCalledWith({
			'notificationPreferences.portfolioDigest.enabled': true,
		});
	});

	it('pula usuário que já recebeu digest nos últimos 6 dias', async () => {
		const recentDate = new Date();
		recentDate.setDate(recentDate.getDate() - 2);
		mockUserModel.find.mockResolvedValue([
			user({
				notificationPreferences: {
					portfolioDigest: { enabled: true, lastDigestSentAt: recentDate },
				},
			}),
		]);

		await scheduler.sendWeeklyDigests();

		expect(mockEmailService.sendPortfolioDigestEmail).not.toHaveBeenCalled();
	});

	it('envia para usuário sem lastDigestSentAt', async () => {
		mockUserModel.find.mockResolvedValue([user()]);

		await scheduler.sendWeeklyDigests();

		expect(mockEmailService.sendPortfolioDigestEmail).toHaveBeenCalledTimes(1);
	});

	it('envia para usuário cujo último digest foi há mais de 6 dias', async () => {
		const oldDate = new Date();
		oldDate.setDate(oldDate.getDate() - 8);
		mockUserModel.find.mockResolvedValue([
			user({
				notificationPreferences: {
					portfolioDigest: { enabled: true, lastDigestSentAt: oldDate },
				},
			}),
		]);

		await scheduler.sendWeeklyDigests();

		expect(mockEmailService.sendPortfolioDigestEmail).toHaveBeenCalledTimes(1);
	});

	it('não manda e-mail quando hasSufficientData é false', async () => {
		mockUserModel.find.mockResolvedValue([user()]);
		mockBuilder.build.mockResolvedValue({
			...okFacts,
			hasSufficientData: false,
		});

		await scheduler.sendWeeklyDigests();

		expect(mockEmailService.sendPortfolioDigestEmail).not.toHaveBeenCalled();
		expect(mockUserModel.findByIdAndUpdate).not.toHaveBeenCalled();
	});

	it('narra só quando o usuário tem assinatura ativa', async () => {
		mockUserModel.find.mockResolvedValue([user()]);
		mockSubscriptionService.findUserSubscription.mockResolvedValue({
			status: 'active',
		});
		mockNarrator.narrate.mockResolvedValue('Sua carteira subiu essa semana.');

		await scheduler.sendWeeklyDigests();

		expect(mockNarrator.narrate).toHaveBeenCalled();
		expect(mockEmailService.sendPortfolioDigestEmail).toHaveBeenCalledWith(
			'investidor@example.com',
			expect.objectContaining({ narrative: 'Sua carteira subiu essa semana.' })
		);
	});

	it('não narra usuário sem assinatura ativa (Free) — nunca chama o narrator', async () => {
		mockUserModel.find.mockResolvedValue([user()]);
		mockSubscriptionService.findUserSubscription.mockRejectedValue(
			new Error('not found')
		);

		await scheduler.sendWeeklyDigests();

		expect(mockNarrator.narrate).not.toHaveBeenCalled();
		expect(mockEmailService.sendPortfolioDigestEmail).toHaveBeenCalledWith(
			'investidor@example.com',
			expect.objectContaining({ narrative: null })
		);
	});

	it('atualiza lastDigestSentAt só após envio bem-sucedido', async () => {
		mockUserModel.find.mockResolvedValue([user()]);

		await scheduler.sendWeeklyDigests();

		expect(mockUserModel.findByIdAndUpdate).toHaveBeenCalledWith(
			'user-1',
			expect.objectContaining({
				$set: expect.objectContaining({
					'notificationPreferences.portfolioDigest.lastDigestSentAt':
						expect.any(Date),
				}),
			})
		);
	});

	it('isola falha de um usuário — os outros continuam sendo processados', async () => {
		mockUserModel.find.mockResolvedValue([
			user({ _id: 'user-1', email: 'falha@example.com' }),
			user({ _id: 'user-2', email: 'ok@example.com' }),
		]);
		mockBuilder.build
			.mockRejectedValueOnce(new Error('builder explodiu'))
			.mockResolvedValueOnce(okFacts);

		await scheduler.sendWeeklyDigests();

		expect(mockEmailService.sendPortfolioDigestEmail).toHaveBeenCalledTimes(1);
		expect(mockEmailService.sendPortfolioDigestEmail).toHaveBeenCalledWith(
			'ok@example.com',
			expect.anything()
		);
	});

	it('inclui o token de unsubscribe assinado na URL', async () => {
		mockUserModel.find.mockResolvedValue([user()]);

		await scheduler.sendWeeklyDigests();

		expect(mockTokenService.sign).toHaveBeenCalledWith('user-1');
		expect(mockEmailService.sendPortfolioDigestEmail).toHaveBeenCalledWith(
			'investidor@example.com',
			expect.objectContaining({
				unsubscribeUrl: expect.stringContaining('signed-token'),
			})
		);
	});

	describe('avisos da semana (TRA-136 fase 7)', () => {
		it('coleta pelo mesmo período que o builder calculou e repassa ao e-mail', async () => {
			mockUserModel.find.mockResolvedValue([user()]);
			const weekNotifications = {
				items: [
					{
						type: 'allocation_breached',
						title: 'Alocacao acima da meta em FIIs',
						body: 'Sua exposicao em FIIs esta em 40.0%.',
						occurredAt: '2026-08-12T12:00:00.000Z',
					},
				],
				omitted: 0,
			};
			mockDigestNotifications.collect.mockResolvedValue(weekNotifications);

			await scheduler.sendWeeklyDigests();

			expect(mockDigestNotifications.collect).toHaveBeenCalledWith(
				'user-1',
				okFacts
			);
			expect(mockEmailService.sendPortfolioDigestEmail).toHaveBeenCalledWith(
				'investidor@example.com',
				expect.objectContaining({ weekNotifications })
			);
		});

		it('o narrador recebe SÓ os fatos — avisos da semana nunca são narrados', async () => {
			mockUserModel.find.mockResolvedValue([user()]);
			mockSubscriptionService.findUserSubscription.mockResolvedValue({
				status: 'active',
			});
			mockNarrator.narrate.mockResolvedValue('Semana estável.');
			mockDigestNotifications.collect.mockResolvedValue({
				items: [
					{
						type: 'allocation_breached',
						title: 'Alocacao acima da meta em FIIs',
						body: 'BBAS3 passou da meta.',
						occurredAt: '2026-08-12T12:00:00.000Z',
					},
				],
				omitted: 0,
			});

			await scheduler.sendWeeklyDigests();

			expect(mockNarrator.narrate).toHaveBeenCalledTimes(1);
			expect(mockNarrator.narrate).toHaveBeenCalledWith(okFacts);
			// Nenhum argumento extra: a única entrada do narrador continua
			// sendo o mesmo objeto que `validateDigestNarrative` usa para
			// conferir a saída.
			expect(mockNarrator.narrate.mock.calls[0]).toHaveLength(1);
		});

		it('semana sem avisos: o digest sai normalmente, com a seção vazia', async () => {
			mockUserModel.find.mockResolvedValue([user()]);
			mockDigestNotifications.collect.mockResolvedValue({
				items: [],
				omitted: 0,
			});

			await scheduler.sendWeeklyDigests();

			expect(mockEmailService.sendPortfolioDigestEmail).toHaveBeenCalledWith(
				'investidor@example.com',
				expect.objectContaining({
					weekNotifications: { items: [], omitted: 0 },
				})
			);
		});
	});
});
