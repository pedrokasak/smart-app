import { Readable } from 'stream';
import { VoiceConsentOrigin } from '../domain/voice.constants';

/**
 * Portas da voz (ADR-007). O server não sabe qual provider de STT ou TTS
 * está em uso: quem escolhe é o trackerr-ia. Persistência de consentimento e
 * de uso fica atrás de porta para poder sair do Mongo sem mexer na regra.
 */

export interface SpeechTranscribeInput {
	audio: Buffer;
	mimeType: string;
	/** Tickers da carteira, do maior peso para o menor. */
	tickers: string[];
	durationMs?: number;
}

export interface SpeechTranscribeResult {
	text: string;
	noSpeech: boolean;
	provider: string;
	model: string;
}

export interface SynthesizedSpeechStream {
	stream: Readable;
	mimeType: string;
	provider: string;
	model: string;
	voice: string;
}

export class SpeechServiceUnavailableError extends Error {}

export interface SpeechGatewayPort {
	transcribe(input: SpeechTranscribeInput): Promise<SpeechTranscribeResult>;
	synthesize(text: string): Promise<SynthesizedSpeechStream>;
}
export const SPEECH_GATEWAY = Symbol('SPEECH_GATEWAY');

export interface VoiceConsentRecord {
	version: string;
	origin: VoiceConsentOrigin;
	acceptedAt: Date;
	revokedAt?: Date | null;
}

export interface VoiceConsentRepositoryPort {
	find(userId: string): Promise<VoiceConsentRecord | null>;
	accept(
		userId: string,
		version: string,
		origin: VoiceConsentOrigin,
		at: Date
	): Promise<void>;
	revoke(userId: string, at: Date): Promise<boolean>;
}
export const VOICE_CONSENT_REPOSITORY = Symbol('VOICE_CONSENT_REPOSITORY');

export interface VoiceUsagePort {
	/**
	 * Conta um turno se ainda couber no teto do dia. Atômico: dois pedidos
	 * ao mesmo tempo não passam do limite.
	 */
	tryConsume(userId: string, day: string, limit: number): Promise<boolean>;
	/** Devolve o turno quando a falha foi do provider, não do usuário. */
	release(userId: string, day: string): Promise<void>;
}
export const VOICE_USAGE = Symbol('VOICE_USAGE');

/** Relógio injetável: o dia do teto e as datas de consentimento vêm dele. */
export const VOICE_CLOCK = Symbol('VOICE_CLOCK');
