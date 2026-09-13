import {
	buildDataHealthReport,
	type HealthAsset,
} from './portfolio-data-health';

const asset = (over: Partial<HealthAsset> = {}): HealthAsset => ({
	symbol: 'BEEF3',
	avgPrice: 4.5,
	price: 5.76,
	quantity: 46,
	source: 'b3',
	dividendHistory: [],
	...over,
});

/** Histórico com valores diferentes: caso saudável, sem achados. */
const historicoVariado = [{ totalValue: 100 }, { totalValue: 110 }];

describe('buildDataHealthReport', () => {
	const codes = (report: ReturnType<typeof buildDataHealthReport>) =>
		report.findings.map((finding) => finding.code);

	it('não acusa nada quando os dados estão consistentes', () => {
		const report = buildDataHealthReport([asset()], historicoVariado);

		expect(report.healthy).toBe(true);
		expect(report.findings).toHaveLength(0);
		expect(report.assetsChecked).toBe(1);
	});

	it('detecta o custo gravado igual à cotação', () => {
		// Assinatura exata do caso reportado: PM 5,76 e cotação 5,76.
		const report = buildDataHealthReport(
			[asset({ avgPrice: 5.76, price: 5.76 })],
			historicoVariado
		);

		expect(codes(report)).toContain('custo-igual-a-cotacao');
		const finding = report.findings.find(
			(item) => item.code === 'custo-igual-a-cotacao'
		)!;
		expect(finding.severity).toBe('alta');
		expect(finding.symbols).toEqual(['BEEF3']);
		expect(finding.remedy).toMatch(/extrato de negocia/i);
	});

	it('não acusa custo igual à cotação em ativo digitado à mão', () => {
		const report = buildDataHealthReport(
			[asset({ avgPrice: 5.76, price: 5.76, source: 'manual' })],
			historicoVariado
		);

		expect(codes(report)).not.toContain('custo-igual-a-cotacao');
	});

	it('aponta posição sem custo de aquisição', () => {
		const report = buildDataHealthReport(
			[asset({ avgPrice: null })],
			historicoVariado
		);

		expect(codes(report)).toContain('sem-custo-de-aquisicao');
	});

	it('não conta o mesmo ativo como corrompido e sem custo ao mesmo tempo', () => {
		const report = buildDataHealthReport(
			[asset({ avgPrice: 5.76, price: 5.76 })],
			historicoVariado
		);

		expect(codes(report)).toContain('custo-igual-a-cotacao');
		expect(codes(report)).not.toContain('sem-custo-de-aquisicao');
	});

	it('detecta proventos empilhados num mês só', () => {
		const report = buildDataHealthReport(
			[
				asset({
					dividendHistory: [
						{ date: '2026-08-25', value: 1 },
						{ date: '2026-08-25', value: 2 },
						{ date: '2026-08-25', value: 3 },
					],
				}),
			],
			historicoVariado
		);

		const finding = report.findings.find(
			(item) => item.code === 'proventos-em-data-unica'
		)!;
		expect(finding.severity).toBe('alta');
		expect(finding.remedy).toMatch(/extrato de movimenta/i);
	});

	it('não acusa empilhamento quando os proventos já estão distribuídos', () => {
		const report = buildDataHealthReport(
			[
				asset({
					dividendHistory: [
						{ date: '2025-09-20', value: 1 },
						{ date: '2025-11-21', value: 2 },
						{ date: '2026-02-20', value: 3 },
					],
				}),
			],
			historicoVariado
		);

		expect(codes(report)).not.toContain('proventos-em-data-unica');
	});

	it('não acusa empilhamento com poucos eventos', () => {
		// Dois proventos no mesmo mês é coincidência comum, não sintoma.
		const report = buildDataHealthReport(
			[
				asset({
					dividendHistory: [
						{ date: '2026-08-20', value: 1 },
						{ date: '2026-08-25', value: 2 },
					],
				}),
			],
			historicoVariado
		);

		expect(codes(report)).not.toContain('proventos-em-data-unica');
	});

	it('avisa quando o histórico é constante', () => {
		const report = buildDataHealthReport(
			[asset()],
			[{ totalValue: 11933.23 }, { totalValue: 11933.23 }]
		);

		const finding = report.findings.find(
			(item) => item.code === 'historico-constante'
		)!;
		expect(finding.detail).toMatch(/linha fica reta/i);
		expect(finding.remedy).toMatch(/cota[çc][ãa]o/i);
	});

	it('avisa quando não há histórico suficiente para desenhar variação', () => {
		const report = buildDataHealthReport([asset()], [{ totalValue: 100 }]);

		expect(codes(report)).toContain('historico-insuficiente');
	});

	it('reúne vários achados de uma vez', () => {
		const report = buildDataHealthReport(
			[
				asset({ symbol: 'BEEF3', avgPrice: 5.76, price: 5.76 }),
				asset({
					symbol: 'BBAS3',
					avgPrice: null,
					dividendHistory: [
						{ date: '2026-08-25', value: 1 },
						{ date: '2026-08-25', value: 2 },
						{ date: '2026-08-25', value: 3 },
					],
				}),
			],
			[{ totalValue: 500 }, { totalValue: 500 }]
		);

		expect(report.healthy).toBe(false);
		expect(codes(report)).toEqual(
			expect.arrayContaining([
				'custo-igual-a-cotacao',
				'sem-custo-de-aquisicao',
				'proventos-em-data-unica',
				'historico-constante',
			])
		);
	});
});
