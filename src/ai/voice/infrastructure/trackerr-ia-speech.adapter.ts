import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { Readable } from 'stream';
import { trackerrIaHeaders } from 'src/ai/infrastructure/trackerr-ia-request';
import {
	SpeechGatewayPort,
	SpeechServiceUnavailableError,
	SpeechTranscribeInput,
	SpeechTranscribeResult,
	SynthesizedSpeechStream,
} from '../application/voice.ports';

/**
 * Voz pelo trackerr-ia (`/api/speech/*`, módulo `speech/`). Lá ficam as
 * chaves e a escolha de provider, modelo e voz; aqui só chega o resultado.
 */
@Injectable()
export class TrackerrIaSpeechAdapter implements SpeechGatewayPort {
	private readonly logger = new Logger(TrackerrIaSpeechAdapter.name);
	private readonly baseUrl =
		process.env.TRAKKER_IA_URL || 'http://localhost:8000';

	constructor(private readonly http: HttpService) {}

	async transcribe(
		input: SpeechTranscribeInput
	): Promise<SpeechTranscribeResult> {
		const form = new FormData();
		form.append(
			'file',
			new Blob([new Uint8Array(input.audio)], { type: input.mimeType }),
			'audio'
		);
		form.append('tickers', input.tickers.join(','));
		if (input.durationMs) form.append('duration_ms', String(input.durationMs));

		// O FormData monta o boundary sozinho: o Content-Type JSON dos outros
		// adapters não pode ir junto.
		const headers = trackerrIaHeaders();
		delete headers['Content-Type'];
		try {
			const { data } = await firstValueFrom(
				this.http.post<{
					text: string;
					no_speech: boolean;
					provider: string;
					model: string;
				}>(`${this.baseUrl}/api/speech/transcribe`, form, {
					headers,
					timeout: 30000,
				})
			);
			return {
				text: data.text,
				noSpeech: data.no_speech,
				provider: data.provider,
				model: data.model,
			};
		} catch (error: any) {
			// Só o status: o corpo de erro pode ecoar trecho da fala.
			this.logger.error(
				`transcribe falhou: HTTP ${error?.response?.status ?? 'sem resposta'}`
			);
			throw new SpeechServiceUnavailableError('transcribe');
		}
	}

	async synthesize(text: string): Promise<SynthesizedSpeechStream> {
		try {
			const response = await firstValueFrom(
				this.http.post<Readable>(
					`${this.baseUrl}/api/speech/synthesize`,
					{ text },
					{
						headers: trackerrIaHeaders(),
						timeout: 60000,
						responseType: 'stream',
					}
				)
			);
			const header = (name: string) => String(response.headers[name] ?? '');
			return {
				stream: response.data,
				mimeType: header('content-type') || 'audio/mpeg',
				provider: header('x-speech-provider'),
				model: header('x-speech-model'),
				voice: header('x-speech-voice'),
			};
		} catch (error: any) {
			this.logger.error(
				`synthesize falhou: HTTP ${error?.response?.status ?? 'sem resposta'}`
			);
			throw new SpeechServiceUnavailableError('synthesize');
		}
	}
}
