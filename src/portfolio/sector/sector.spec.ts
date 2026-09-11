import {
	isSectorApplicable,
	resolveSectorForStorage,
	toDisplaySector,
} from './sector';

describe('isSectorApplicable', () => {
	it('aceita ação e FII', () => {
		expect(isSectorApplicable('stock')).toBe(true);
		expect(isSectorApplicable('fii')).toBe(true);
		expect(isSectorApplicable('STOCK')).toBe(true);
	});

	// ETF é cesta de vários setores; cripto e renda fixa não têm setor.
	it('recusa ETF, cripto, renda fixa e outros', () => {
		for (const type of [
			'etf',
			'crypto',
			'fund',
			'other',
			'',
			null,
			undefined,
		]) {
			expect(isSectorApplicable(type)).toBe(false);
		}
	});
});

describe('toDisplaySector', () => {
	// O ponto do módulo: gravar a chave do normalizeSector faria o grupo
	// aparecer em maiúsculas e sem acento no card de exposição.
	it('preserva acentos e capitalização originais', () => {
		expect(toDisplaySector('Intermediários Financeiros')).toBe(
			'Intermediários Financeiros'
		);
	});

	it('colapsa espaços e apara as pontas', () => {
		expect(toDisplaySector('  Energia   Elétrica ')).toBe('Energia Elétrica');
	});

	// Placeholder gravado criaria um grupo "-" e impediria o backfill de
	// tentar de novo.
	it('descarta placeholders de "sem dado"', () => {
		for (const value of ['-', '--', 'N/A', 'n/d', 'null', 'None', '  ']) {
			expect(toDisplaySector(value)).toBeNull();
		}
	});

	it('devolve null para vazio, null e undefined', () => {
		expect(toDisplaySector('')).toBeNull();
		expect(toDisplaySector(null)).toBeNull();
		expect(toDisplaySector(undefined)).toBeNull();
	});
});

describe('resolveSectorForStorage', () => {
	it('grava o setor de ação na forma de exibição', () => {
		expect(
			resolveSectorForStorage({
				assetType: 'stock',
				snapshotSector: ' Petróleo, Gás e Biocombustíveis ',
			})
		).toBe('Petróleo, Gás e Biocombustíveis');
	});

	// Não aplicável fica null mesmo que a fonte devolva algo.
	it('não grava setor para tipo sem setor, mesmo com dado da fonte', () => {
		expect(
			resolveSectorForStorage({
				assetType: 'etf',
				snapshotSector: 'Financeiro',
			})
		).toBeNull();
		expect(
			resolveSectorForStorage({
				assetType: 'crypto',
				snapshotSector: 'Tecnologia',
			})
		).toBeNull();
	});

	it('devolve null quando a fonte não trouxe setor', () => {
		expect(
			resolveSectorForStorage({ assetType: 'stock', snapshotSector: null })
		).toBeNull();
	});
});
