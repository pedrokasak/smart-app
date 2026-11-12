import { of, throwError } from 'rxjs';
import { Readable } from 'stream';
import { SpeechServiceUnavailableError } from '../application/voice.ports';
import { TrackerrIaSpeechAdapter } from './trackerr-ia-speech.adapter';

describe('TrackerrIaSpeechAdapter', () => {
	const env = process.env;
	beforeEach(() => {
		process.env = {
			...env,
			TRACKERR_IA_SERVICE_TOKEN: 'segredo',
			TRAKKER_IA_URL: 'http://ia:8000',
		};
	});
	afterAll(() => {
		process.env = env;
	});

	it('manda o áudio em multipart com tickers e duração, sem Content-Type JSON', async () => {
		const http = {
			post: jest.fn().mockReturnValue(
				of({
					data: {
						text: 'A PETR4?',
						no_speech: false,
						provider: 'groq',
						model: 'w',
					},
				})
			),
		};
		const adapter = new TrackerrIaSpeechAdapter(http as any);

		const result = await adapter.transcribe({
			audio: Buffer.from('m4a'),
			mimeType: 'audio/mp4',
			tickers: ['PETR4', 'ITUB4'],
			durationMs: 5200,
		});

		const [url, form, options] = http.post.mock.calls[0];
		expect(url).toBe('http://ia:8000/api/speech/transcribe');
		expect(form).toBeInstanceOf(FormData);
		expect(form.get('tickers')).toBe('PETR4,ITUB4');
		expect(form.get('duration_ms')).toBe('5200');
		expect((form.get('file') as Blob).type).toBe('audio/mp4');
		expect(options.headers).toEqual({ 'x-service-token': 'segredo' });
		expect(result).toEqual({
			text: 'A PETR4?',
			noSpeech: false,
			provider: 'groq',
			model: 'w',
		});
	});

	it('falha do trackerr-ia vira SpeechServiceUnavailableError', async () => {
		const http = {
			post: jest
				.fn()
				.mockReturnValue(throwError(() => ({ response: { status: 503 } }))),
		};
		await expect(
			new TrackerrIaSpeechAdapter(http as any).transcribe({
				audio: Buffer.from('a'),
				mimeType: 'audio/mp4',
				tickers: [],
			})
		).rejects.toBeInstanceOf(SpeechServiceUnavailableError);
	});

	it('repassa o áudio em stream com os cabeçalhos do provider', async () => {
		const stream = Readable.from([Buffer.from('mp3')]);
		const http = {
			post: jest.fn().mockReturnValue(
				of({
					data: stream,
					headers: {
						'content-type': 'audio/mpeg',
						'x-speech-provider': 'openrouter',
						'x-speech-model': 'voxtral',
						'x-speech-voice': 'voice_3150',
					},
				})
			),
		};

		const result = await new TrackerrIaSpeechAdapter(http as any).synthesize(
			'Olá.'
		);

		expect(http.post.mock.calls[0][1]).toEqual({ text: 'Olá.' });
		expect(http.post.mock.calls[0][2]).toEqual(
			expect.objectContaining({ responseType: 'stream' })
		);
		expect(result).toEqual({
			stream,
			mimeType: 'audio/mpeg',
			provider: 'openrouter',
			model: 'voxtral',
			voice: 'voice_3150',
		});
	});
});
