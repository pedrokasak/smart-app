import { Reflector } from '@nestjs/core';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import {
	PLAN_FREE,
	REQUIRED_CAPABILITY_KEY,
} from 'src/subscription/capabilities/requires-capability.decorator';
import { VoiceController } from './voice.controller';

describe('VoiceController', () => {
	const reflector = new Reflector();
	const capabilityOf = (handler: keyof VoiceController) =>
		reflector.getAllAndOverride(REQUIRED_CAPABILITY_KEY, [
			VoiceController.prototype[handler] as any,
			VoiceController,
		]);

	it('ver e revogar o consentimento vale em qualquer plano (LGPD)', () => {
		expect(capabilityOf('consentStatus')).toBe(PLAN_FREE);
		expect(capabilityOf('revokeConsent')).toBe(PLAN_FREE);
	});

	it('aceitar e usar a voz exige ai.voice', () => {
		for (const handler of [
			'acceptConsent',
			'transcribe',
			'answer',
			'speech',
		] as const) {
			expect(capabilityOf(handler)).toBe('ai.voice');
		}
	});

	it('recusa arquivo que não é áudio antes de chamar o serviço', async () => {
		const voice = { transcribe: jest.fn() };
		const controller = new VoiceController(voice as any);

		await expect(
			controller.transcribe(
				{ user: { userId: 'u1' } },
				{ buffer: Buffer.from('%PDF'), mimetype: 'application/pdf' } as any,
				{}
			)
		).rejects.toMatchObject({ status: 415 });
		expect(voice.transcribe).not.toHaveBeenCalled();
	});

	it('aceita webm com codecs e repassa o tipo sem parâmetros', async () => {
		const voice = { transcribe: jest.fn().mockResolvedValue({}) };
		await new VoiceController(voice as any).transcribe(
			{ user: { userId: 'u1' } },
			{ buffer: Buffer.from('a'), mimetype: 'audio/webm;codecs=opus' } as any,
			{ durationMs: 4000 }
		);

		expect(voice.transcribe).toHaveBeenCalledWith(
			'u1',
			Buffer.from('a'),
			'audio/webm',
			4000
		);
	});

	it('fechar a conexão derruba o stream do trackerr-ia', async () => {
		const stream = Readable.from([Buffer.from('mp3')]);
		const voice = {
			speak: jest.fn().mockResolvedValue({
				stream,
				mimeType: 'audio/mpeg',
				provider: 'openrouter',
				voice: 'voice_3150',
			}),
		};
		const res = Object.assign(new EventEmitter(), { set: jest.fn() });

		await new VoiceController(voice as any).speech(
			{ user: { userId: 'u1' } },
			{ messageId: '64b7f0c2a1b2c3d4e5f60718' },
			res
		);
		res.emit('close');

		expect(stream.destroyed).toBe(true);
		expect(res.set).toHaveBeenCalledWith(
			expect.objectContaining({ 'Cache-Control': 'no-store' })
		);
	});
});
