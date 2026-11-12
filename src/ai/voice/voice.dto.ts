import { Type } from 'class-transformer';
import {
	IsIn,
	IsInt,
	IsMongoId,
	IsOptional,
	IsString,
	Max,
	MaxLength,
	Min,
	MinLength,
} from 'class-validator';
import {
	VOICE_CONSENT_ORIGINS,
	VOICE_MAX_DURATION_MS,
	VOICE_MAX_QUESTION_LENGTH,
	VoiceConsentOrigin,
} from './domain/voice.constants';

export class VoiceConsentRequestDto {
	@IsIn(VOICE_CONSENT_ORIGINS)
	origin: VoiceConsentOrigin;
}

/** Campos de texto do multipart de `POST /ai/voice/transcribe`. */
export class VoiceTranscribeRequestDto {
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(0)
	@Max(VOICE_MAX_DURATION_MS * 2)
	durationMs?: number;
}

export class VoiceAnswerRequestDto {
	@IsString()
	@MinLength(2)
	@MaxLength(VOICE_MAX_QUESTION_LENGTH)
	question: string;

	/** Carteira dos chips "Consultando"; sem ela, todas (ADR-007, decisão 10). */
	@IsOptional()
	@IsMongoId()
	portfolioId?: string;
}

export class VoiceSpeechRequestDto {
	@IsMongoId()
	messageId: string;
}
