import { Logger } from '@nestjs/common';
import { DomainEvent } from 'src/events/domain/domain-event';
import { DOMAIN_EVENT_TYPES } from 'src/events/domain/event-types';
import { InsightDto } from 'src/ai/dto/insight.dto';
import { AiInsightProducer } from './ai-insight.producer';

describe('AiInsightProducer', () => {
	const userId = '68b0e2f0c1a2b3d4e5f60011';

	let publicados: DomainEvent[];
	let publisher: { publish: jest.Mock };

	const insight = (over: Partial<InsightDto> = {}): InsightDto =>
		({
			id: 'ins-1',
			title: 'Concentracao em cripto',
			body: 'Cripto passou de 20% da carteira.',
			confidence: { value: 0.9, bucket: 'alta', reason: 'dados completos' },
			...over,
		}) as InsightDto;

	beforeEach(() => {
		jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
		publicados = [];
		publisher = {
			publish: jest.fn(async (event: DomainEvent) => {
				publicados.push(event);
			}),
		};
	});

	afterEach(() => jest.restoreAllMocks());

	const criar = () => new AiInsightProducer(publisher);

	it('publica so os insights de confianca alta', async () => {
		await criar().publishHighPriority(userId, [
			insight(),
			insight({
				id: 'ins-2',
				confidence: { value: 0.4, bucket: 'baixa', reason: 'pouco dado' },
			}),
			insight({ id: 'ins-3', confidence: undefined }),
		]);

		expect(publicados).toHaveLength(1);
		expect(publicados[0]).toMatchObject({
			type: DOMAIN_EVENT_TYPES.AiInsightHighPriority,
			subject: userId,
			producer: 'server.ai.insights',
			payload: {
				title: 'Concentracao em cripto',
				summary: 'Cripto passou de 20% da carteira.',
				insightId: 'ins-1',
			},
		});
	});

	/** `rationale` e o texto novo (TRA-56); `body` e o legado. */
	it('prefere rationale ao body legado', async () => {
		await criar().publishHighPriority(userId, [
			insight({ rationale: 'Justificativa nova' }),
		]);

		expect((publicados[0].payload as any).summary).toBe('Justificativa nova');
	});

	it('corta a rajada em 3 eventos por resposta', async () => {
		const muitos = Array.from({ length: 7 }, (_, i) =>
			insight({ id: `ins-${i}` })
		);

		await criar().publishHighPriority(userId, muitos);

		expect(publicados).toHaveLength(3);
	});

	it('ignora insight sem titulo ou sem texto', async () => {
		await criar().publishHighPriority(userId, [
			insight({ title: '  ' }),
			insight({ id: 'ins-2', body: '', rationale: '' }),
		]);

		expect(publisher.publish).not.toHaveBeenCalled();
	});

	it('sem userId ou sem lista nao publica', async () => {
		await criar().publishHighPriority('', [insight()]);
		await criar().publishHighPriority(userId, undefined);

		expect(publisher.publish).not.toHaveBeenCalled();
	});

	/** A rota /ai/insights responde 200 mesmo com o barramento fora do ar. */
	it('nao propaga falha do barramento', async () => {
		publisher.publish.mockRejectedValue(new Error('Redis fora do ar'));

		await expect(
			criar().publishHighPriority(userId, [insight()])
		).resolves.toBeUndefined();
	});
});
