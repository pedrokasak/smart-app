import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { DigestNotificationsService } from './digest-notifications.service';
import { DigestNotificationsRepository } from '../infrastructure/digest-notifications.repository';
import { MAX_DIGEST_NOTIFICATIONS } from '../domain/digest-notification.types';
import { PortfolioDigestFacts } from '../domain/portfolio-digest.types';
import { NotificationType } from 'src/notifications/events/domain/notification.types';

const USER_ID = new Types.ObjectId().toString();

const facts: PortfolioDigestFacts = {
	periodStart: '2026-08-24',
	periodEnd: '2026-08-31',
	portfolioValue: 10000,
	periodChangePct: 1.5,
	periodChangeAbs: 150,
	topGainers: [],
	topLosers: [],
	watchItems: [],
	dividendsReceived: null,
	hasSufficientData: true,
};

function notificationDoc(overrides: Record<string, any> = {}) {
	return {
		_id: new Types.ObjectId(),
		type: NotificationType.AllocationBreached,
		payload: {
			type: NotificationType.AllocationBreached,
			bucket: 'Renda variável',
			actualPct: 72.5,
			targetPct: 60,
		},
		createdAt: new Date('2026-08-26T12:00:00Z'),
		readAt: null,
		...overrides,
	};
}

describe('DigestNotificationsService', () => {
	let service: DigestNotificationsService;

	const repository = {
		findInPeriod: jest.fn(),
		countInPeriod: jest.fn(),
	};

	beforeEach(async () => {
		jest.clearAllMocks();
		repository.findInPeriod.mockResolvedValue([]);
		repository.countInPeriod.mockResolvedValue(0);

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				DigestNotificationsService,
				{ provide: DigestNotificationsRepository, useValue: repository },
			],
		}).compile();

		service = module.get(DigestNotificationsService);
	});

	it('renderiza a seção com o texto determinístico do template in-app', async () => {
		repository.findInPeriod.mockResolvedValue([notificationDoc()]);

		const result = await service.collect(USER_ID, facts);

		expect(result.items).toHaveLength(1);
		expect(result.items[0].title).toBe(
			'Alocacao acima da meta em Renda variável'
		);
		// Mesma frase que o centro in-app mostra — vem de buildTemplate.
		expect(result.items[0].body).toContain('72.5%');
		expect(result.items[0].body).toContain('60.0%');
		expect(result.items[0].type).toBe(NotificationType.AllocationBreached);
		expect(result.items[0].occurredAt).toBe('2026-08-26T12:00:00.000Z');
		expect(result.omitted).toBe(0);
	});

	it('semana sem notificações devolve seção vazia, sem contagem extra', async () => {
		repository.findInPeriod.mockResolvedValue([]);

		const result = await service.collect(USER_ID, facts);

		expect(result).toEqual({ items: [], omitted: 0 });
		expect(repository.countInPeriod).not.toHaveBeenCalled();
	});

	it('prefere aiSummary ao texto do template quando existe', async () => {
		repository.findInPeriod.mockResolvedValue([
			notificationDoc({ aiSummary: '  Sua renda variável passou da meta.  ' }),
		]);

		const result = await service.collect(USER_ID, facts);

		expect(result.items[0].body).toBe('Sua renda variável passou da meta.');
		// O título continua vindo do template — o resumo da IA nunca o
		// substitui.
		expect(result.items[0].title).toBe(
			'Alocacao acima da meta em Renda variável'
		);
	});

	it('respeita o teto e informa quantas ficaram de fora', async () => {
		repository.findInPeriod.mockResolvedValue(
			Array.from({ length: MAX_DIGEST_NOTIFICATIONS }, () => notificationDoc())
		);
		repository.countInPeriod.mockResolvedValue(40);

		const result = await service.collect(USER_ID, facts);

		expect(repository.findInPeriod).toHaveBeenCalledWith(
			expect.anything(),
			expect.any(Date),
			expect.any(Date),
			MAX_DIGEST_NOTIFICATIONS
		);
		expect(result.items).toHaveLength(MAX_DIGEST_NOTIFICATIONS);
		expect(result.omitted).toBe(40 - MAX_DIGEST_NOTIFICATIONS);
	});

	it('consulta exatamente o período que o builder já calculou', async () => {
		await service.collect(USER_ID, facts);

		const [, start, end] = repository.findInPeriod.mock.calls[0];
		expect(start).toEqual(new Date(2026, 7, 24, 0, 0, 0, 0));
		expect(end).toEqual(new Date(new Date(2026, 7, 31 + 1).getTime() - 1));
	});

	it('não derruba o digest quando a leitura falha', async () => {
		repository.findInPeriod.mockRejectedValue(new Error('mongo fora do ar'));

		await expect(service.collect(USER_ID, facts)).resolves.toEqual({
			items: [],
			omitted: 0,
		});
	});

	it('descarta doc com payload fora da união sem quebrar a lista', async () => {
		repository.findInPeriod.mockResolvedValue([
			notificationDoc({
				type: 'legacy_type',
				payload: { type: 'legacy_type' },
			}),
			notificationDoc(),
		]);

		const result = await service.collect(USER_ID, facts);

		// O legado sobrevive com o tipo como título (mapper tolerante) e a
		// notificação válida continua na lista.
		expect(result.items).toHaveLength(2);
		expect(result.items[1].body).toContain('72.5%');
	});
});
