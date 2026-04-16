import {
	inferQuarterFromDocument,
	previousQuarter,
	resolveExpectedReportingQuarter,
	sameQuarter,
	toQuarterLabel,
} from 'src/ri-intelligence/domain/ri-quarter-resolution';

describe('ri-quarter-resolution', () => {
	it('infers quarter from period and title/url patterns', () => {
		const byPeriod = inferQuarterFromDocument({
			period: '1T26',
			title: 'Release',
			source: { type: 'url', value: 'https://ri.example.com/doc.pdf' },
		});
		const byTitle = inferQuarterFromDocument({
			period: null,
			title: 'Quarterly Results 2025Q4',
			source: { type: 'url', value: 'https://ri.example.com/doc.pdf' },
		});
		const byUrl = inferQuarterFromDocument({
			period: null,
			title: 'Release de Resultados',
			source: { type: 'url', value: 'https://ri.example.com/release-3t24.pdf' },
		});

		expect(byPeriod).toEqual({ year: 2026, quarter: 1 });
		expect(byTitle).toEqual({ year: 2025, quarter: 4 });
		expect(byUrl).toEqual({ year: 2024, quarter: 3 });
	});

	it('returns null when quarter cannot be inferred safely', () => {
		const output = inferQuarterFromDocument({
			period: null,
			title: 'Investor Day Presentation 2026',
			source: { type: 'url', value: 'https://ri.example.com/presentation.pdf' },
		});

		expect(output).toBeNull();
	});

	it('resolves expected reporting quarter from current date and previous quarter fallback', () => {
		const expectedFromApril = resolveExpectedReportingQuarter(
			new Date('2026-04-10T00:00:00.000Z')
		);
		const expectedFromJanuary = resolveExpectedReportingQuarter(
			new Date('2026-01-10T00:00:00.000Z')
		);

		expect(expectedFromApril).toEqual({ year: 2026, quarter: 1 });
		expect(previousQuarter(expectedFromApril)).toEqual({
			year: 2025,
			quarter: 4,
		});
		expect(expectedFromJanuary).toEqual({ year: 2025, quarter: 4 });
		expect(toQuarterLabel(expectedFromApril)).toBe('1T26');
		expect(sameQuarter(expectedFromApril, { year: 2026, quarter: 1 })).toBe(true);
	});
});
