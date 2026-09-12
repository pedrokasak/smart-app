import { InternalServerErrorException, Logger } from '@nestjs/common';
import { AiService } from 'src/ai/ai.service';
import { NotificationType } from '../domain/notification.types';
import {
	NotificationSummaryRequest,
	TransientSummaryError,
} from '../application/ports/notification-summary.port';
import { TrackerrIaNotificationSummaryAdapter } from './trackerr-ia-notification-summary.adapter';

const pedido = (): NotificationSummaryRequest => ({
	userId: '68b0e2f0c1a2b3d4e5f60011',
	notificationType: NotificationType.AllocationBreached,
	ruleId: 'allocation.drift',
	scope: 'crypto',
	deterministicTitle: 'Alocacao acima da meta em crypto',
	deterministicBody: 'Sua exposicao em crypto esta em 35,0%, contra 30,0%.',
	evidence: [
		{ label: 'Meta (%)', value: 30, source: 'allocation.targetPct' },
		{ label: 'Exposicao real (%)', value: 35, source: 'allocation.actualPct' },
	],
});

const montar = (getInsights: jest.Mock) =>
	new TrackerrIaNotificationSummaryAdapter({
		getInsights,
	} as unknown as AiService);

describe('TrackerrIaNotificationSummaryAdapter (TRA-136 fase 5)', () => {
	beforeEach(() => {
		jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
		delete process.env.NOTIFICATION_AI_SUMMARY_ENABLED;
		delete process.env.NOTIFICATION_AI_SUMMARY_TIMEOUT_MS;
	});

	afterEach(() => jest.restoreAllMocks());

	it('reusa getInsights, desliga a publicacao de evento e usa timeout curto', async () => {
		const getInsights = jest.fn().mockResolvedValue({
			insights: [{ id: '1', title: 't', body: 'b', rationale: 'Resumo.' }],
		});

		const texto = await montar(getInsights).summarize(pedido());

		expect(texto).toBe('Resumo.');
		expect(getInsights).toHaveBeenCalledTimes(1);

		const [profile, freshness, options] = getInsights.mock.calls[0];
		// Anti-laco: sem isto, resumir um evento publicaria outro evento.
		expect(options).toEqual({ publishInsightEvents: false, timeoutMs: 8000 });
		expect(freshness).toBeUndefined();
		// Anti-alucinacao: so a evidencia calculada pelo motor viaja.
		expect(profile.evidence).toEqual(pedido().evidence);
		expect(profile.user_id).toBe(pedido().userId);
	});

	it('respeita NOTIFICATION_AI_SUMMARY_TIMEOUT_MS', async () => {
		process.env.NOTIFICATION_AI_SUMMARY_TIMEOUT_MS = '2500';
		const getInsights = jest.fn().mockResolvedValue({ insights: [] });

		await montar(getInsights).summarize(pedido());

		expect(getInsights.mock.calls[0][2].timeoutMs).toBe(2500);
	});

	it('desligado por env nao chama o trackerr-ia', async () => {
		process.env.NOTIFICATION_AI_SUMMARY_ENABLED = 'false';
		const getInsights = jest.fn();

		expect(await montar(getInsights).summarize(pedido())).toBeNull();
		expect(getInsights).not.toHaveBeenCalled();
	});

	it('sem evidencia nao chama: nao ha numero verificavel para resumir', async () => {
		const getInsights = jest.fn();

		const texto = await montar(getInsights).summarize({
			...pedido(),
			evidence: [],
		});

		expect(texto).toBeNull();
		expect(getInsights).not.toHaveBeenCalled();
	});

	it('resposta vazia devolve null em vez de texto inventado', async () => {
		const getInsights = jest.fn().mockResolvedValue({ insights: [] });
		expect(await montar(getInsights).summarize(pedido())).toBeNull();
	});

	it('cai no body legado quando nao ha rationale', async () => {
		const getInsights = jest.fn().mockResolvedValue({
			insights: [{ id: '1', title: 't', body: 'Corpo legado.' }],
		});
		expect(await montar(getInsights).summarize(pedido())).toBe('Corpo legado.');
	});

	it.each([
		'timeout of 8000ms exceeded',
		'connect ECONNREFUSED 127.0.0.1:8000',
		'Erro ao conectar ao serviço de insights',
	])('falha transitoria (%s) sobe para o retry da fila', async (mensagem) => {
		const getInsights = jest
			.fn()
			.mockRejectedValue(new InternalServerErrorException(mensagem));

		await expect(
			montar(getInsights).summarize(pedido())
		).rejects.toBeInstanceOf(TransientSummaryError);
	});

	it('falha permanente devolve null — repetir daria o mesmo nada', async () => {
		const getInsights = jest
			.fn()
			.mockRejectedValue(new InternalServerErrorException('payload invalido'));

		expect(await montar(getInsights).summarize(pedido())).toBeNull();
	});

	it('trunca resumo muito longo', async () => {
		const getInsights = jest.fn().mockResolvedValue({
			insights: [{ id: '1', title: 't', body: 'x'.repeat(2000) }],
		});

		const texto = await montar(getInsights).summarize(pedido());
		expect(texto).toHaveLength(600);
		expect(texto?.endsWith('…')).toBe(true);
	});
});
