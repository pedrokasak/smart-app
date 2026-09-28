import { of, throwError } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import {
	RI_SYNTHESIS_MAX_CHARS,
	TrackerrIaRiSummarySynthesizerAdapter,
} from 'src/ri-intelligence/infrastructure/trackerr-ia-ri-summary-synthesizer.adapter';
import { RiSummarySynthesisInput } from 'src/ri-intelligence/application/ri-summary-synthesizer.port';
import { RiStructuredSignalItem } from 'src/ri-intelligence/application/ri-summary.types';

const signal = (
	over: Partial<RiStructuredSignalItem> = {}
): RiStructuredSignalItem => ({
	detected: false,
	direction: 'unknown',
	evidence: [],
	...over,
});

function makeInput(
	over: Partial<RiSummarySynthesisInput> = {}
): RiSummarySynthesisInput {
	return {
		document: {
			id: 'ri-doc-1',
			ticker: 'PETR4',
			company: 'Petrobras',
			title: 'Release 2T26',
			documentType: 'earnings_release',
			period: '2T26',
			publishedAt: '2026-08-07T00:00:00.000Z',
			source: { type: 'url', value: 'https://ri.petrobras.com.br/2t26.pdf' },
			classification: { method: 'provided', confidence: 'high' },
			contentStatus: 'metadata_only',
		},
		content: 'Receita cresceu 12% no trimestre.',
		structuredSignals: {
			revenue: signal({
				detected: true,
				direction: 'up',
				evidence: ['receita'],
			}),
			profit: signal(),
			margin: signal(),
			indebtedness: signal(),
			capex: signal(),
			guidance: signal(),
			risks: signal(),
			toneShift: signal(),
		},
		...over,
	};
}

describe('TrackerrIaRiSummarySynthesizerAdapter (TRA-238)', () => {
	let httpService: { post: jest.Mock };
	let adapter: TrackerrIaRiSummarySynthesizerAdapter;

	beforeEach(() => {
		httpService = { post: jest.fn() };
		adapter = new TrackerrIaRiSummarySynthesizerAdapter(
			httpService as unknown as HttpService
		);
	});

	it('posts the document to /api/ri/summarize and maps the answer', async () => {
		httpService.post.mockReturnValue(
			of({
				data: {
					highlights: ['Receita cresceu 12%.'],
					narrative: 'Trimestre de crescimento.',
					provider: 'gemini',
				},
			})
		);

		const out = await adapter.summarize(makeInput());

		expect(out).toEqual({
			highlights: ['Receita cresceu 12%.'],
			narrative: 'Trimestre de crescimento.',
			metadata: { model: 'gemini' },
		});
		const [url, body, config] = httpService.post.mock.calls[0];
		expect(url).toMatch(/\/api\/ri\/summarize$/);
		expect(body).toEqual({
			document: {
				ticker: 'PETR4',
				company: 'Petrobras',
				document_type: 'earnings_release',
				title: 'Release 2T26',
				period: '2T26',
				published_at: '2026-08-07T00:00:00.000Z',
			},
			content: 'Receita cresceu 12% no trimestre.',
			structured_signals: expect.objectContaining({
				revenue: { detected: true, direction: 'up', evidence: ['receita'] },
			}),
		});
		expect(config.headers['Content-Type']).toBe('application/json');
		expect(config.timeout).toBeGreaterThan(0);
	});

	it('caps the content sent to the model', async () => {
		httpService.post.mockReturnValue(
			of({ data: { highlights: ['x'], narrative: 'y' } })
		);

		await adapter.summarize(
			makeInput({ content: 'a'.repeat(RI_SYNTHESIS_MAX_CHARS + 10_000) })
		);

		const [, body] = httpService.post.mock.calls[0];
		expect(body.content).toHaveLength(RI_SYNTHESIS_MAX_CHARS);
	});

	// Titulo raspado de site de RI pode vir enorme; passar do limite do
	// schema do trackerr-ia vira 422 e o documento nunca ganha resumo.
	it('caps document metadata to the trackerr-ia schema limits', async () => {
		httpService.post.mockReturnValue(
			of({ data: { highlights: ['x'], narrative: 'y' } })
		);
		const base = makeInput();

		await adapter.summarize(
			makeInput({
				document: {
					...base.document,
					title: 't'.repeat(1_000),
					company: 'c'.repeat(500),
				},
			})
		);

		const [, body] = httpService.post.mock.calls[0];
		expect(body.document.title).toHaveLength(300);
		expect(body.document.company).toHaveLength(200);
	});

	// O servico trata excecao como "IA falhou" e devolve o resumo
	// estruturado. Engolir o erro aqui e devolver vazio faria o servico
	// gravar um resumo vazio em cache como se fosse sucesso.
	it('throws when trackerr-ia fails so the service falls back', async () => {
		httpService.post.mockReturnValue(
			throwError(() => new Error('Request failed with status code 422'))
		);

		await expect(adapter.summarize(makeInput())).rejects.toThrow();
	});

	it('throws when trackerr-ia answers without content', async () => {
		httpService.post.mockReturnValue(
			of({ data: { highlights: [], narrative: '  ' } })
		);

		await expect(adapter.summarize(makeInput())).rejects.toThrow(
			'ri_summary_empty'
		);
	});

	it('drops non-string highlights from the answer', async () => {
		httpService.post.mockReturnValue(
			of({ data: { highlights: ['Dívida caiu.', 42, null], narrative: '' } })
		);

		const out = await adapter.summarize(makeInput());

		expect(out.highlights).toEqual(['Dívida caiu.']);
		expect(out.narrative).toBe('');
	});
});
