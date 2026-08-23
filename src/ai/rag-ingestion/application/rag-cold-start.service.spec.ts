import { RagColdStartService } from 'src/ai/rag-ingestion/application/rag-cold-start.service';
import { RagIngestionScheduler } from 'src/ai/rag-ingestion/application/rag-ingestion.scheduler';

describe('RagColdStartService (TRA-88)', () => {
	let scheduler: { ingestForUser: jest.Mock };
	let service: RagColdStartService;

	beforeEach(() => {
		scheduler = { ingestForUser: jest.fn().mockResolvedValue(true) };
		service = new RagColdStartService(
			scheduler as unknown as RagIngestionScheduler
		);
	});

	const flush = () => new Promise((r) => setTimeout(r, 0));

	it('triggers ingestion for a user (fire-and-forget)', async () => {
		service.trigger('user-1');
		await flush();
		expect(scheduler.ingestForUser).toHaveBeenCalledWith('user-1');
	});

	it('returns immediately and never rejects, even if ingestion throws', async () => {
		scheduler.ingestForUser.mockRejectedValue(new Error('trackerr-ia down'));
		// Não deve lançar de forma alguma — o chat não pode quebrar por isso.
		expect(() => service.trigger('user-1')).not.toThrow();
		await flush();
		expect(scheduler.ingestForUser).toHaveBeenCalledTimes(1);
	});

	it('debounces repeated triggers within the cooldown window', async () => {
		service.trigger('user-1');
		service.trigger('user-1');
		service.trigger('user-1');
		await flush();
		expect(scheduler.ingestForUser).toHaveBeenCalledTimes(1);
	});

	it('triggers separately for different users', async () => {
		service.trigger('user-1');
		service.trigger('user-2');
		await flush();
		expect(scheduler.ingestForUser).toHaveBeenCalledTimes(2);
	});

	it('does nothing for an empty userId', () => {
		service.trigger('');
		expect(scheduler.ingestForUser).not.toHaveBeenCalled();
	});
});
