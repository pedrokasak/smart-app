import {
	BadRequestException,
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	HttpStatus,
	Post,
	Request,
	Res,
	StreamableFile,
	UnauthorizedException,
	UnsupportedMediaTypeException,
	UploadedFile,
	UseGuards,
	UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import {
	PlanFree,
	RequiresCapability,
} from 'src/subscription/capabilities/requires-capability.decorator';
import { VoiceTurnService } from './application/voice-turn.service';
import {
	VOICE_AUDIO_MIME_TYPES,
	VOICE_MAX_AUDIO_BYTES,
} from './domain/voice.constants';
import {
	VoiceAnswerRequestDto,
	VoiceConsentRequestDto,
	VoiceSpeechRequestDto,
	VoiceTranscribeRequestDto,
} from './voice.dto';

/**
 * Copiloto por voz (ADR-007). O turno tem três chamadas, para a transcrição
 * aparecer antes da resposta e o texto sobreviver se o áudio falhar
 * (decisão 8): `transcribe`, `answer` e `speech`.
 *
 * Desligado por padrão (`VOICE_ENABLED`): sem a variável, toda rota responde
 * 404.
 */
@Controller('ai/voice')
@ApiTags('ai')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequiresCapability('ai.voice')
export class VoiceController {
	constructor(private readonly voice: VoiceTurnService) {}

	// Ver e revogar o consentimento vale em qualquer plano: quem mudou para um
	// plano sem voz ainda tem o direito de revogar (LGPD).
	@Get('consent')
	@PlanFree()
	consentStatus(@Request() req: any) {
		return this.voice.consentStatus(userIdOf(req));
	}

	@Post('consent')
	@HttpCode(HttpStatus.OK)
	acceptConsent(@Request() req: any, @Body() body: VoiceConsentRequestDto) {
		return this.voice.acceptConsent(userIdOf(req), body.origin);
	}

	@Delete('consent')
	@PlanFree()
	revokeConsent(@Request() req: any) {
		return this.voice.revokeConsent(userIdOf(req));
	}

	@Post('transcribe')
	@HttpCode(HttpStatus.OK)
	@UseInterceptors(
		// Em memória: o áudio não pode tocar o disco (ADR-007).
		FileInterceptor('file', {
			storage: memoryStorage(),
			limits: { fileSize: VOICE_MAX_AUDIO_BYTES, files: 1 },
		})
	)
	async transcribe(
		@Request() req: any,
		@UploadedFile() file: Express.Multer.File | undefined,
		@Body() body: VoiceTranscribeRequestDto
	) {
		const userId = userIdOf(req);
		if (!file?.buffer?.length) throw new BadRequestException('audio_required');
		const mimeType = String(file.mimetype || '')
			.split(';')[0]
			.trim()
			.toLowerCase();
		if (!(VOICE_AUDIO_MIME_TYPES as readonly string[]).includes(mimeType)) {
			throw new UnsupportedMediaTypeException('unsupported_audio_type');
		}
		return this.voice.transcribe(
			userId,
			file.buffer,
			mimeType,
			body.durationMs
		);
	}

	@Post('answer')
	@HttpCode(HttpStatus.OK)
	answer(@Request() req: any, @Body() body: VoiceAnswerRequestDto) {
		return this.voice.answer(
			userIdOf(req),
			body.question.trim(),
			body.portfolioId,
			body.conversationId
		);
	}

	@Post('speech')
	@HttpCode(HttpStatus.OK)
	async speech(
		@Request() req: any,
		@Body() body: VoiceSpeechRequestDto,
		@Res({ passthrough: true }) res: any
	): Promise<StreamableFile> {
		const speech = await this.voice.speak(userIdOf(req), body.messageId);
		// Quem fecha a folha ou toca em "Parar" derruba a conexão: o stream do
		// trackerr-ia fecha junto, em vez de sintetizar um áudio que ninguém ouve.
		res.on?.('close', () => speech.stream.destroy());
		res.set({
			'Cache-Control': 'no-store',
			'X-Speech-Provider': speech.provider,
			'X-Speech-Voice': speech.voice,
		});
		return new StreamableFile(speech.stream, { type: speech.mimeType });
	}
}

function userIdOf(req: any): string {
	const userId = String(req.user?.userId ?? req.user?.sub ?? '');
	if (!userId) throw new UnauthorizedException('User ID ausente no token');
	return userId;
}
