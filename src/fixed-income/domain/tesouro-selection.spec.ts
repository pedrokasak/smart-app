import { pickTitlesForHorizon, resolveTitlesById } from './tesouro-selection';
import type { TesouroFamily, TesouroTitle } from './tesouro-title';

const title = (
	family: TesouroFamily,
	maturityDate: string,
	buyRatePct = 7
): TesouroTitle => ({
	id: `${family}:${maturityDate}`,
	family,
	name: `${family} ${maturityDate.slice(0, 4)}`,
	maturityDate,
	buyRatePct,
	sellRatePct: buyRatePct + 0.12,
	unitPrice: 1000,
	baseDate: '2026-10-02',
});

const catalog = [
	title('SELIC', '2027-03-01'),
	title('SELIC', '2031-03-01'),
	title('PREFIXED', '2029-01-01'),
	title('PREFIXED', '2032-01-01'),
	title('IPCA_PLUS', '2035-05-15'),
	title('IPCA_PLUS', '2029-05-15'),
	title('IPCA_PLUS', '2045-05-15'),
];

describe('pickTitlesForHorizon', () => {
	it('escolhe, por família, o vencimento mais próximo sem vencer antes do prazo', () => {
		const { titles, warnings } = pickTitlesForHorizon(catalog, '2029-10-05');
		expect(titles.map((t) => t.id)).toEqual([
			'SELIC:2031-03-01',
			'PREFIXED:2032-01-01',
			'IPCA_PLUS:2035-05-15',
		]);
		expect(warnings).toEqual([]);
	});

	it('aceita o título que vence exatamente no fim do prazo', () => {
		const { titles } = pickTitlesForHorizon(catalog, '2029-01-01');
		expect(titles.find((t) => t.family === 'PREFIXED')?.id).toBe(
			'PREFIXED:2029-01-01'
		);
	});

	it('Selic sem título que alcance o prazo usa o mais longo; os demais saem com aviso', () => {
		const { titles, warnings } = pickTitlesForHorizon(catalog, '2050-01-01');
		expect(titles.map((t) => t.id)).toEqual(['SELIC:2031-03-01']);
		expect(warnings).toHaveLength(2);
		expect(warnings.join(' ')).toContain('Tesouro Prefixado');
		expect(warnings.join(' ')).toContain('Tesouro IPCA+');
	});

	it('ignora família sem nenhum título à venda', () => {
		const { titles, warnings } = pickTitlesForHorizon(
			[title('SELIC', '2031-03-01')],
			'2029-10-05'
		);
		expect(titles.map((t) => t.family)).toEqual(['SELIC']);
		expect(warnings).toEqual([]);
	});
});

describe('resolveTitlesById', () => {
	it('mantém a ordem Selic → Prefixado → IPCA+ e por vencimento', () => {
		const { titles } = resolveTitlesById(catalog, [
			'IPCA_PLUS:2045-05-15',
			'SELIC:2031-03-01',
			'IPCA_PLUS:2029-05-15',
		]);
		expect(titles.map((t) => t.id)).toEqual([
			'SELIC:2031-03-01',
			'IPCA_PLUS:2029-05-15',
			'IPCA_PLUS:2045-05-15',
		]);
	});

	it('id fora da oferta vira aviso, não erro, e repetido conta uma vez', () => {
		const { titles, warnings } = resolveTitlesById(catalog, [
			'SELIC:2031-03-01',
			'SELIC:2031-03-01',
			'PREFIXED:2099-01-01',
		]);
		expect(titles).toHaveLength(1);
		expect(warnings).toHaveLength(1);
	});
});
