import { of, throwError } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { TrackerrIaRagIngestionAdapter } from 'src/ai/rag-ingestion/infrastructure/trackerr-ia-rag-ingestion.adapter';
import { RagIngestItem } from 'src/ai/rag-ingestion/application/rag-ingestion.port';

const ITEMS: RagIngestItem[] = [
	{
		sourceType: 'portfolio_position',
		sourceId: 'position:PETR4',
		content: 'x',
		asOf: '2026-08-21',
	},
];

describe('TrackerrIaRagIngestionAdapter (TRA-84)', () => {
	let httpService: { post: jest.Mock };
	let adapter: TrackerrIaRagIngestionAdapter;

	beforeEach(() => {
		httpService = { post: jest.fn() };
		adapter = new TrackerrIaRagIngestionAdapter(
			httpService as unknown as HttpService
		);
	});

	it('maps items to snake_case payload and returns the counts', async () => {
		httpService.post.mockReturnValue(
			of({
				data: { chunks_deleted: 1, chunks_created: 2, chunks_unchanged: 3 },
			})
		);

		const result = await adapter.ingest('user-1', ITEMS);

		expect(result).toEqual({
			ingested: true,
			chunksDeleted: 1,
			chunksCreated: 2,
			chunksUnchanged: 3,
		});
		const [url, body] = httpService.post.mock.calls[0];
		expect(url).toContain('/api/rag/ingest');
		expect(body.user_id).toBe('user-1');
		expect(body.items[0]).toEqual({
			source_type: 'portfolio_position',
			source_id: 'position:PETR4',
			content: 'x',
			metadata: null,
			as_of: '2026-08-21',
		});
	});

	it('never throws — a network failure becomes ingested:false', async () => {
		httpService.post.mockReturnValue(
			throwError(() => new Error('ECONNREFUSED'))
		);
		await expect(adapter.ingest('user-1', ITEMS)).resolves.toEqual({
			ingested: false,
			failureReason: 'ECONNREFUSED',
		});
	});

	it('rejects an empty userId without calling the network', async () => {
		const result = await adapter.ingest('', ITEMS);
		expect(result).toEqual({ ingested: false, failureReason: 'empty_user_id' });
		expect(httpService.post).not.toHaveBeenCalled();
	});
});
