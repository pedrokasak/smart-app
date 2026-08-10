import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { GoogleCseRiOriginSearchAdapter } from './google-cse-ri-origin-search.adapter';

describe('GoogleCseRiOriginSearchAdapter', () => {
	function buildAdapter(getImpl: () => any, apiKey = 'key', engineId = 'engine') {
		const httpService = { get: jest.fn(getImpl) } as unknown as HttpService;
		return new GoogleCseRiOriginSearchAdapter(httpService, apiKey, engineId);
	}

	it('returns the first result domain when Google CSE finds a match', async () => {
		const adapter = buildAdapter(() =>
			of({
				data: {
					items: [{ link: 'https://ri.empresa-real.com.br/resultados' }],
				},
			})
		);
		const result = await adapter.searchOfficialOrigin('Empresa Real S.A.');
		expect(result).toBe('https://ri.empresa-real.com.br');
	});

	it('returns null when Google CSE returns no items', async () => {
		const adapter = buildAdapter(() => of({ data: {} }));
		const result = await adapter.searchOfficialOrigin('Empresa Sem RI S.A.');
		expect(result).toBeNull();
	});

	it('returns null and does not throw when the request fails', async () => {
		const adapter = buildAdapter(() => throwError(() => new Error('quota exceeded')));
		await expect(adapter.searchOfficialOrigin('Empresa X')).resolves.toBeNull();
	});

	it('returns null immediately without a request when credentials are missing', async () => {
		const httpService = { get: jest.fn() } as unknown as HttpService;
		const adapter = new GoogleCseRiOriginSearchAdapter(httpService, undefined, undefined);
		const result = await adapter.searchOfficialOrigin('Empresa Y');
		expect(result).toBeNull();
		expect(httpService.get).not.toHaveBeenCalled();
	});
});
