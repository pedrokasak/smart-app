/**
 * Regras fixas da voz do Copiloto (ADR-007).
 */

/** Versão do texto de consentimento aprovado em 11/11/2026 (decisão 10). */
export const CURRENT_VOICE_CONSENT_VERSION = 'voz-v1';

export const VOICE_CONSENT_ORIGINS = ['web', 'mobile'] as const;
export type VoiceConsentOrigin = (typeof VOICE_CONSENT_ORIGINS)[number];

/** 60s de m4a de celular dá ~1,8 MB; o trackerr-ia aceita até 3 MB. */
export const VOICE_MAX_AUDIO_BYTES = 3 * 1024 * 1024;
export const VOICE_MAX_DURATION_MS = 60_000;
export const VOICE_MAX_QUESTION_LENGTH = 500;

export const VOICE_AUDIO_MIME_TYPES = [
	'audio/webm',
	'audio/ogg',
	'audio/mp4',
	'audio/m4a',
	'audio/x-m4a',
	'audio/aac',
	'audio/mpeg',
	'audio/wav',
	'audio/x-wav',
] as const;

export const DEFAULT_VOICE_DAILY_LIMIT = 30;

/** Sínteses por turno no teto do dia: a resposta e duas repetições. */
export const VOICE_SPEECH_PLAYS_PER_TURN = 3;

/** Teto diário por usuário; `VOICE_DAILY_LIMIT` no ambiente muda sem deploy de código. */
export function voiceDailyLimit(env: NodeJS.ProcessEnv = process.env): number {
	const parsed = Number(env.VOICE_DAILY_LIMIT);
	return Number.isInteger(parsed) && parsed > 0
		? parsed
		: DEFAULT_VOICE_DAILY_LIMIT;
}

/** A voz nasce desligada e só liga com `VOICE_ENABLED=true`. */
export function voiceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return (env.VOICE_ENABLED || '').trim().toLowerCase() === 'true';
}

/**
 * Dia do teto no horário de Brasília: "renova à meia-noite" no texto do
 * app quer dizer meia-noite daqui, não UTC.
 */
export function voiceUsageDay(now: Date): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: 'America/Sao_Paulo',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).format(now);
}
