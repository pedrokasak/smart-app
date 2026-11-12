import { HttpException, NotFoundException } from '@nestjs/common';
import { Readable } from 'stream';
import { SECURITY_EVENT } from 'src/audit/domain/security-events';
import { CURRENT_VOICE_CONSENT_VERSION } from '../domain/voice.constants';
import { VoiceTurnService } from './voice-turn.service';
import {
	SpeechGatewayPort,
	SpeechServiceUnavailableError,
	VoiceConsentRecord,
	VoiceConsentRepositoryPort,
	VoiceUsagePort,
} from './voice.ports';

const NOW = new Date('2026-11-12T02:30:00Z'); // 23:30 de 11/11 em Brasília

class InMemoryConsents implements VoiceConsentRepositoryPort {
	records = new Map<string, VoiceConsentRecord>();
	async find(userId: string) {
		return this.records.get(userId) ?? null;
	}
	async accept(userId: string, version: string, origin: any, at: Date) {
		this.records.set(userId, {
			version,
			origin,
			acceptedAt: at,
			revokedAt: null,
		});
	}
	async revoke(userId: string, at: Date) {
		const record = this.records.get(userId);
		if (!record || record.revokedAt) return false;
		record.revokedAt = at;
		return true;
	}
}

class InMemoryUsage implements VoiceUsagePort {
	counts = new Map<string, number>();
	async tryConsume(userId: string, day: string, limit: number) {
		const key = `${userId}:${day}`;
		const used = this.counts.get(key) ?? 0;
		if (used >= limit) return false;
		this.counts.set(key, used + 1);
		return true;
	}
	async release(userId: string, day: string) {
		const key = `${userId}:${day}`;
		this.counts.set(key, Math.max(0, (this.counts.get(key) ?? 0) - 1));
	}
}

function setup() {
	const consents = new InMemoryConsents();
	const usage = new InMemoryUsage();
	const speech: jest.Mocked<SpeechGatewayPort> = {
		transcribe: jest.fn().mockResolvedValue({
			text: 'A PETR4 pagou?',
			noSpeech: false,
			provider: 'groq',
			model: 'w',
		}),
		synthesize: jest.fn().mockResolvedValue({
			stream: Readable.from([Buffer.from('mp3')]),
			mimeType: 'audio/mpeg',
			provider: 'openrouter',
			model: 'voxtral',
			voice: 'voice_3150',
		}),
	};
	const audit = { emit: jest.fn() };
	const chatAnswer = {
		answer: jest.fn().mockResolvedValue({
			message: 'A PETR4 pagou R$ 10.',
			intent: 'dividends',
			warnings: [],
		}),
	};
	const chatHistory = {
		append: jest.fn().mockImplementation(async (_u: string, dto: any) => ({
			...dto,
			_id: dto.role === 'assistant' ? 'msg-a' : 'msg-u',
		})),
		findOwnAssistantMessage: jest.fn(),
	};
	const portfolios = {
		getUserPortfolios: jest.fn().mockResolvedValue([
			{
				assets: [
					{ symbol: 'itub4', quantity: 10, currentPrice: 30 },
					{ symbol: 'PETR4', quantity: 100, price: 40 },
				],
			},
			{
				assets: [
					{ symbol: 'ITUB4', quantity: 200, currentPrice: 30 },
					{ symbol: 'VALE3', quantity: 1, price: 60 },
				],
			},
		]),
	};
	const service = new VoiceTurnService(
		speech,
		consents,
		usage,
		audit as any,
		() => NOW,
		chatAnswer as any,
		chatHistory as any,
		portfolios as any
	);
	return {
		service,
		consents,
		usage,
		speech,
		audit,
		chatAnswer,
		chatHistory,
		portfolios,
	};
}

describe('VoiceTurnService', () => {
	const env = process.env;
	beforeEach(() => {
		process.env = { ...env, VOICE_ENABLED: 'true', VOICE_DAILY_LIMIT: '2' };
	});
	afterAll(() => {
		process.env = env;
	});

	describe('voz desligada', () => {
		it('responde 404 em tudo, inclusive no consentimento', async () => {
			process.env.VOICE_ENABLED = '';
			const { service } = setup();
			await expect(service.consentStatus('u1')).rejects.toBeInstanceOf(
				NotFoundException
			);
			await expect(
				service.transcribe('u1', Buffer.from('a'), 'audio/mp4')
			).rejects.toBeInstanceOf(NotFoundException);
		});
	});

	describe('consentimento', () => {
		it('aceita, audita e passa a valer', async () => {
			const { service, audit } = setup();
			const status = await service.acceptConsent('u1', 'mobile');

			expect(status).toEqual({
				accepted: true,
				version: CURRENT_VOICE_CONSENT_VERSION,
				acceptedVersion: CURRENT_VOICE_CONSENT_VERSION,
			});
			expect(audit.emit).toHaveBeenCalledWith({
				type: SECURITY_EVENT.VoiceConsentAccepted,
				actor: { userId: 'u1' },
				payload: { version: CURRENT_VOICE_CONSENT_VERSION, origin: 'mobile' },
			});
		});

		it('versão antiga não vale: pede o aceite de novo', async () => {
			const { service, consents } = setup();
			await consents.accept('u1', 'voz-v0', 'web', NOW);

			expect(await service.consentStatus('u1')).toEqual({
				accepted: false,
				version: CURRENT_VOICE_CONSENT_VERSION,
				acceptedVersion: 'voz-v0',
			});
		});

		it('revogar desliga a voz e audita só quando havia aceite', async () => {
			const { service, audit } = setup();
			await service.acceptConsent('u1', 'web');
			audit.emit.mockClear();

			expect((await service.revokeConsent('u1')).accepted).toBe(false);
			expect(audit.emit).toHaveBeenCalledWith({
				type: SECURITY_EVENT.VoiceConsentRevoked,
				actor: { userId: 'u1' },
			});

			audit.emit.mockClear();
			await service.revokeConsent('u1');
			expect(audit.emit).not.toHaveBeenCalled();
		});

		it('sem aceite, o turno é recusado com 403 antes de gastar o teto', async () => {
			const { service, speech, usage } = setup();
			await expect(
				service.transcribe('u1', Buffer.from('a'), 'audio/mp4')
			).rejects.toMatchObject({
				status: 403,
				response: expect.objectContaining({
					message: 'voice_consent_required',
				}),
			});
			expect(speech.transcribe).not.toHaveBeenCalled();
			expect(usage.counts.size).toBe(0);
		});
	});

	describe('transcribe', () => {
		it('manda os tickers da carteira do maior valor para o menor, somando carteiras', async () => {
			const { service, speech } = setup();
			await service.acceptConsent('u1', 'web');
			await service.transcribe('u1', Buffer.from('audio'), 'audio/mp4', 5200);

			expect(speech.transcribe).toHaveBeenCalledWith({
				audio: Buffer.from('audio'),
				mimeType: 'audio/mp4',
				// ITUB4: 210 × 30 = 6.300; PETR4: 4.000; VALE3: 60.
				tickers: ['ITUB4', 'PETR4', 'VALE3'],
				durationMs: 5200,
			});
		});

		it('conta o teto no dia de Brasília e recusa com 429 quando enche', async () => {
			const { service, usage } = setup();
			await service.acceptConsent('u1', 'web');
			await service.transcribe('u1', Buffer.from('a'), 'audio/mp4');
			await service.transcribe('u1', Buffer.from('a'), 'audio/mp4');

			await expect(
				service.transcribe('u1', Buffer.from('a'), 'audio/mp4')
			).rejects.toMatchObject({ status: 429 });
			expect(usage.counts.get('u1:2026-11-11')).toBe(2);
		});

		it('falha do provider devolve o turno e responde 503', async () => {
			const { service, speech, usage } = setup();
			await service.acceptConsent('u1', 'web');
			speech.transcribe.mockRejectedValueOnce(
				new SpeechServiceUnavailableError('x')
			);

			await expect(
				service.transcribe('u1', Buffer.from('a'), 'audio/mp4')
			).rejects.toMatchObject({ status: 503 });
			expect(usage.counts.get('u1:2026-11-11')).toBe(0);
		});

		it('sem carteira acessível, transcreve mesmo assim sem tickers', async () => {
			const { service, speech, portfolios } = setup();
			await service.acceptConsent('u1', 'web');
			portfolios.getUserPortfolios.mockRejectedValueOnce(
				new Error('mongo fora')
			);
			await service.transcribe('u1', Buffer.from('a'), 'audio/mp4');

			expect(speech.transcribe.mock.calls[0][0].tickers).toEqual([]);
		});
	});

	describe('answer', () => {
		it('responde pelo mesmo caminho do chat e grava os dois lados como voz', async () => {
			const { service, chatAnswer, chatHistory } = setup();
			await service.acceptConsent('u1', 'web');
			const response = await service.answer('u1', 'A PETR4 pagou?');

			expect(chatAnswer.answer).toHaveBeenCalledWith('u1', {
				question: 'A PETR4 pagou?',
			});
			expect(chatHistory.append).toHaveBeenNthCalledWith(
				1,
				'u1',
				expect.objectContaining({
					role: 'user',
					text: 'A PETR4 pagou?',
					channel: 'voice',
				})
			);
			expect(chatHistory.append).toHaveBeenNthCalledWith(
				2,
				'u1',
				expect.objectContaining({
					role: 'assistant',
					text: 'A PETR4 pagou R$ 10.',
					status: 'ok',
					channel: 'voice',
				})
			);
			expect(response).toEqual(
				expect.objectContaining({
					message: 'A PETR4 pagou R$ 10.',
					messageId: 'msg-a',
				})
			);
		});

		it('não conta no teto diário', async () => {
			const { service, usage } = setup();
			await service.acceptConsent('u1', 'web');
			await service.answer('u1', 'oi?');
			expect(usage.counts.size).toBe(0);
		});
	});

	describe('speak', () => {
		it('sintetiza a resposta salva do próprio usuário, formatada para fala', async () => {
			const { service, chatHistory, speech } = setup();
			await service.acceptConsent('u1', 'web');
			chatHistory.findOwnAssistantMessage.mockResolvedValue({
				text: '**Total:** R$ 10\n• HGLG11 dia 14',
			});

			const result = await service.speak('u1', 'msg-a');

			expect(chatHistory.findOwnAssistantMessage).toHaveBeenCalledWith(
				'u1',
				'msg-a'
			);
			expect(speech.synthesize).toHaveBeenCalledWith(
				'Total: R$ 10. HGLG11 dia 14.'
			);
			expect(result.voice).toBe('voice_3150');
		});

		it('síntese tem teto próprio de 3x o diário e devolve o uso se o TTS falhar', async () => {
			const { service, chatHistory, speech, usage } = setup();
			await service.acceptConsent('u1', 'web');
			chatHistory.findOwnAssistantMessage.mockResolvedValue({ text: 'Olá.' });

			speech.synthesize.mockRejectedValueOnce(
				new SpeechServiceUnavailableError('x')
			);
			await service.speak('u1', 'msg-a').catch(() => undefined);
			expect(usage.counts.get('u1:2026-11-11:tts')).toBe(0);

			// VOICE_DAILY_LIMIT=2 no teste: 6 sínteses no dia.
			for (let i = 0; i < 6; i++) await service.speak('u1', 'msg-a');
			await expect(service.speak('u1', 'msg-a')).rejects.toMatchObject({
				status: 429,
			});
			// O teto da síntese não consome o da pergunta.
			expect(usage.counts.get('u1:2026-11-11')).toBeUndefined();
		});

		it('mensagem de outro usuário ou inexistente responde 404', async () => {
			const { service, chatHistory, speech } = setup();
			await service.acceptConsent('u1', 'web');
			chatHistory.findOwnAssistantMessage.mockResolvedValue(null);

			await expect(service.speak('u1', 'msg-de-outro')).rejects.toBeInstanceOf(
				NotFoundException
			);
			expect(speech.synthesize).not.toHaveBeenCalled();
		});

		it('TTS indisponível responde 503', async () => {
			const { service, chatHistory, speech } = setup();
			await service.acceptConsent('u1', 'web');
			chatHistory.findOwnAssistantMessage.mockResolvedValue({ text: 'Olá.' });
			speech.synthesize.mockRejectedValueOnce(
				new SpeechServiceUnavailableError('x')
			);

			const error = await service.speak('u1', 'msg-a').catch((e) => e);
			expect(error).toBeInstanceOf(HttpException);
			expect(error.getStatus()).toBe(503);
		});
	});
});
