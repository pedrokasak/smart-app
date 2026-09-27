import { buildRealReturn, ipcaLookupStart } from './real-return';

const ipca = {
	points: [
		{ date: '2026-05-01', value: 0.58 },
		{ date: '2026-06-01', value: 0.16 },
		{ date: '2026-07-01', value: 0.07 },
	],
	extractedAt: new Date('2026-09-26T13:30:00.000Z'),
	sourceUrl: 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.433/dados',
};

describe('buildRealReturn', () => {
	it('deflates the TWR by the IPCA of the same period, with provenance', () => {
		const result = buildRealReturn({
			twr: 0.05,
			from: '2026-05-01',
			to: '2026-08-01',
			ipca,
		});

		expect(result.inflation).toBeCloseTo(0.008114, 6);
		expect(result.value).toBeCloseTo(1.05 / (1.0058 * 1.0016 * 1.0007) - 1, 6);
		expect(result.estimatedMonths).toBe(0);
		expect(result.convention).toBe('fisher_geometric_ipca_pro_rata');
		expect(result.source).toEqual({
			series: 'BACEN_SGS_433',
			extractedAt: '2026-09-26T13:30:00.000Z',
			url: ipca.sourceUrl,
			license: 'ODbL-1.0',
		});
		expect(result.annualized).not.toBeNull();
	});

	it('declares how many months were estimated', () => {
		const result = buildRealReturn({
			twr: 0.02,
			from: '2026-07-01',
			to: '2026-09-26',
			ipca,
		});

		expect(result.estimatedMonths).toBe(2);
		expect(result.lastPublishedMonth).toBe('2026-07-01');
	});

	it('returns nulls without source when there is no TWR or no IPCA', () => {
		expect(
			buildRealReturn({ twr: null, from: '2026-05-01', to: '2026-08-01', ipca })
				.value
		).toBeNull();
		const noIpca = buildRealReturn({
			twr: 0.05,
			from: '2026-05-01',
			to: '2026-08-01',
			ipca: null,
		});
		expect(noIpca.value).toBeNull();
		expect(noIpca.source).toBeNull();
	});

	it('returns null when the IPCA series does not reach the start', () => {
		const result = buildRealReturn({
			twr: 0.05,
			from: '2026-01-01',
			to: '2026-08-01',
			ipca,
		});

		expect(result.value).toBeNull();
	});
});

describe('ipcaLookupStart', () => {
	it('goes back two months to the first day, crossing the year', () => {
		expect(ipcaLookupStart('2026-01-15')).toBe('2025-11-01');
		expect(ipcaLookupStart('2026-07-31')).toBe('2026-05-01');
	});
});
