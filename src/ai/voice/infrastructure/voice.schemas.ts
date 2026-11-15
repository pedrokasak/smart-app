import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/**
 * Aceite do consentimento de voz (ADR-007, decisão 10): um por usuário,
 * com a versão do texto aceito. Revogar marca `revokedAt` em vez de apagar,
 * para a trilha de auditoria e o registro continuarem coerentes.
 */
@Schema({ collection: 'voice_consents' })
export class VoiceConsent {
	@Prop({ required: true, unique: true, index: true })
	userId: string;

	@Prop({ required: true })
	version: string;

	@Prop({ required: true, enum: ['web', 'mobile'] })
	origin: 'web' | 'mobile';

	@Prop({ required: true })
	acceptedAt: Date;

	@Prop({ type: Date, default: null })
	revokedAt?: Date | null;
}
export type VoiceConsentDocument = VoiceConsent & Document;
export const VoiceConsentSchema = SchemaFactory.createForClass(VoiceConsent);

/**
 * Turnos de voz por usuário e dia, para o teto diário. Some sozinho depois
 * de alguns dias (TTL): só o dia corrente importa.
 */
@Schema({ collection: 'voice_usage' })
export class VoiceUsage {
	@Prop({ required: true })
	userId: string;

	/** AAAA-MM-DD no horário de Brasília. */
	@Prop({ required: true })
	day: string;

	@Prop({ required: true, default: 0 })
	count: number;

	@Prop({ default: Date.now })
	createdAt: Date;
}
export type VoiceUsageDocument = VoiceUsage & Document;
export const VoiceUsageSchema = SchemaFactory.createForClass(VoiceUsage);
VoiceUsageSchema.index({ userId: 1, day: 1 }, { unique: true });
VoiceUsageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 3 * 24 * 3600 });
