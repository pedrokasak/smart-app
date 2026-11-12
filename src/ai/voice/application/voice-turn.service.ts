import {
	ForbiddenException,
	HttpException,
	HttpStatus,
	Inject,
	Injectable,
	Logger,
	NotFoundException,
	ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
	SECURITY_AUDIT,
	SecurityAudit,
} from 'src/audit/application/security-audit.service';
import { SECURITY_EVENT } from 'src/audit/domain/security-events';
import { ChatHistoryService } from 'src/ai/chat-history/chat-history.service';
import { IntelligentChatAnswerService } from 'src/ai/intelligence/intelligent-chat-answer.service';
import { PortfolioService } from 'src/portfolio/portfolio.service';
import { toSpokenText } from '../domain/spoken-text';
import {
	CURRENT_VOICE_CONSENT_VERSION,
	VOICE_SPEECH_PLAYS_PER_TURN,
	VoiceConsentOrigin,
	voiceDailyLimit,
	voiceEnabled,
	voiceUsageDay,
} from '../domain/voice.constants';
import {
	SPEECH_GATEWAY,
	SpeechGatewayPort,
	SpeechServiceUnavailableError,
	SpeechTranscribeResult,
	SynthesizedSpeechStream,
	VOICE_CLOCK,
	VOICE_CONSENT_REPOSITORY,
	VOICE_USAGE,
	VoiceConsentRepositoryPort,
	VoiceUsagePort,
} from './voice.ports';

export interface VoiceConsentStatus {
	accepted: boolean;
	version: string;
	acceptedVersion: string | null;
}

/**
 * Turno de voz do Copiloto (ADR-007, decisões 8 e 10): transcrever,
 * responder e gerar o áudio, cada um numa chamada.
 *
 * Toda chamada passa pelas mesmas travas: plano com `ai.voice` (no
 * `PlanCapabilityGuard`, pelo `@RequiresCapability` do controller), voz
 * ligada no ambiente e consentimento na versão vigente. O teto diário só
 * conta na transcrição, uma vez por turno.
 */
@Injectable()
export class VoiceTurnService {
	private readonly logger = new Logger(VoiceTurnService.name);

	constructor(
		@Inject(SPEECH_GATEWAY) private readonly speech: SpeechGatewayPort,
		@Inject(VOICE_CONSENT_REPOSITORY)
		private readonly consents: VoiceConsentRepositoryPort,
		@Inject(VOICE_USAGE) private readonly usage: VoiceUsagePort,
		@Inject(SECURITY_AUDIT) private readonly audit: SecurityAudit,
		@Inject(VOICE_CLOCK) private readonly clock: () => Date,
		private readonly chatAnswer: IntelligentChatAnswerService,
		private readonly chatHistory: ChatHistoryService,
		private readonly portfolios: PortfolioService
	) {}

	// ---- consentimento ---------------------------------------------------------

	async consentStatus(userId: string): Promise<VoiceConsentStatus> {
		this.ensureEnabled();
		const record = await this.consents.find(userId);
		const active = record && !record.revokedAt ? record : null;
		return {
			accepted: active?.version === CURRENT_VOICE_CONSENT_VERSION,
			version: CURRENT_VOICE_CONSENT_VERSION,
			acceptedVersion: active?.version ?? null,
		};
	}

	async acceptConsent(
		userId: string,
		origin: VoiceConsentOrigin
	): Promise<VoiceConsentStatus> {
		this.ensureEnabled();
		await this.consents.accept(
			userId,
			CURRENT_VOICE_CONSENT_VERSION,
			origin,
			this.clock()
		);
		this.audit.emit({
			type: SECURITY_EVENT.VoiceConsentAccepted,
			actor: { userId },
			payload: { version: CURRENT_VOICE_CONSENT_VERSION, origin },
		});
		return this.consentStatus(userId);
	}

	async revokeConsent(userId: string): Promise<VoiceConsentStatus> {
		this.ensureEnabled();
		if (await this.consents.revoke(userId, this.clock())) {
			this.audit.emit({
				type: SECURITY_EVENT.VoiceConsentRevoked,
				actor: { userId },
			});
		}
		return this.consentStatus(userId);
	}

	// ---- turno -----------------------------------------------------------------

	async transcribe(
		userId: string,
		audio: Buffer,
		mimeType: string,
		durationMs?: number
	): Promise<SpeechTranscribeResult> {
		await this.ensureAllowed(userId);
		const day = voiceUsageDay(this.clock());
		if (!(await this.usage.tryConsume(userId, day, voiceDailyLimit()))) {
			throw new HttpException(
				'voice_daily_limit',
				HttpStatus.TOO_MANY_REQUESTS
			);
		}
		try {
			return await this.speech.transcribe({
				audio,
				mimeType,
				tickers: await this.portfolioTickers(userId),
				durationMs,
			});
		} catch (error) {
			if (error instanceof SpeechServiceUnavailableError) {
				// Falha do provider não gasta o teto do usuário.
				await this.usage.release(userId, day);
				throw new ServiceUnavailableException('speech_unavailable');
			}
			throw error;
		}
	}

	async answer(userId: string, question: string): Promise<any> {
		await this.ensureAllowed(userId);
		const response = await this.chatAnswer.answer(userId, { question });
		await this.chatHistory.append(userId, {
			clientId: `voice-u-${randomUUID()}`,
			role: 'user',
			text: question,
			channel: 'voice',
		});
		const saved: any = await this.chatHistory.append(userId, {
			clientId: `voice-a-${randomUUID()}`,
			role: 'assistant',
			text: String(response?.message || ''),
			status: response?.warnings?.includes('chat_orchestration_failed')
				? 'error'
				: 'ok',
			payload: response,
			// O chat inteligente responde por rota determinística (ver
			// IntelligentChatAnswerService); o texto não é gerado por LLM.
			aiGenerated: false,
			channel: 'voice',
		});
		return { ...response, messageId: String(saved?._id ?? '') };
	}

	async speak(
		userId: string,
		messageId: string
	): Promise<SynthesizedSpeechStream> {
		await this.ensureAllowed(userId);
		const message = await this.chatHistory.findOwnAssistantMessage(
			userId,
			messageId
		);
		if (!message) throw new NotFoundException('message_not_found');
		const spoken = toSpokenText(message.text);
		if (!spoken) throw new NotFoundException('message_not_found');
		// Síntese tem custo próprio e pode repetir ("Ouvir de novo"): teto à
		// parte, folgado para as repetições de um dia normal.
		const day = `${voiceUsageDay(this.clock())}:tts`;
		const limit = voiceDailyLimit() * VOICE_SPEECH_PLAYS_PER_TURN;
		if (!(await this.usage.tryConsume(userId, day, limit))) {
			throw new HttpException(
				'voice_daily_limit',
				HttpStatus.TOO_MANY_REQUESTS
			);
		}
		try {
			return await this.speech.synthesize(spoken);
		} catch (error) {
			if (error instanceof SpeechServiceUnavailableError) {
				await this.usage.release(userId, day);
				throw new ServiceUnavailableException('speech_unavailable');
			}
			throw error;
		}
	}

	// ---- travas ----------------------------------------------------------------

	private ensureEnabled(): void {
		// Desligada, a voz não existe para o cliente.
		if (!voiceEnabled()) throw new NotFoundException();
	}

	private async ensureAllowed(userId: string): Promise<void> {
		if (!(await this.consentStatus(userId)).accepted) {
			throw new ForbiddenException('voice_consent_required');
		}
	}

	/**
	 * Tickers da carteira, do maior valor para o menor. O trackerr-ia usa os
	 * primeiros no `prompt` do Whisper e todos na correção de ticker.
	 */
	private async portfolioTickers(userId: string): Promise<string[]> {
		try {
			const portfolios: any[] = await this.portfolios.getUserPortfolios(userId);
			const value = new Map<string, number>();
			for (const asset of portfolios.flatMap((p) => p?.assets || [])) {
				const symbol = String(asset?.symbol || '')
					.trim()
					.toUpperCase();
				if (!symbol) continue;
				const price = Number(asset?.currentPrice ?? asset?.price) || 0;
				const amount = (Number(asset?.quantity) || 0) * price;
				value.set(symbol, (value.get(symbol) || 0) + amount);
			}
			return [...value.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
		} catch (error: any) {
			// Sem tickers a transcrição continua; só perde a ajuda do vocabulário.
			this.logger.warn(
				`voz: tickers indisponíveis: ${error?.message || 'erro'}`
			);
			return [];
		}
	}
}
