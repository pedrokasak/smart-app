import { FundamentusFallbackAdapter } from './fundamentus-fallback.adapter';

describe('FundamentusFallbackAdapter.getFields', () => {
	function adapterWithSnapshot(text: Record<string, string>) {
		const adapter = new FundamentusFallbackAdapter();
		jest
			.spyOn(adapter as any, 'loadSnapshot')
			.mockResolvedValue({ numeric: {}, text });
		return adapter;
	}

	it('devolve null quando a fonte marca o indicador como traco', async () => {
		const adapter = adapterWithSnapshot({ ROIC: '-' });
		const fields = await adapter.getFields('BBAS3');
		expect(fields.ROIC.value).toBeNull();
		expect(fields.ROIC.text).toBe('-');
	});

	it('preserva zero legitimo como zero, nao como ausencia', async () => {
		const adapter = adapterWithSnapshot({ 'MARG. LIQUIDA': '0,0%' });
		const fields = await adapter.getFields('BBAS3');
		expect(fields['MARG. LIQUIDA'].value).toBe(0);
		expect(fields['MARG. LIQUIDA'].text).toBe('0,0%');
	});

	it('converte numero com separador brasileiro e percentual', async () => {
		const adapter = adapterWithSnapshot({ ROIC: '24,3%' });
		const fields = await adapter.getFields('WEGE3');
		expect(fields.ROIC.value).toBeCloseTo(24.3, 5);
	});

	it('converte negativo com separador de milhar', async () => {
		const adapter = adapterWithSnapshot({ 'DIV. LIQUIDA': '-3.734.800.000' });
		const fields = await adapter.getFields('WEGE3');
		expect(fields['DIV. LIQUIDA'].value).toBe(-3734800000);
	});

	it('devolve null para vazio e para n/a', async () => {
		const adapter = adapterWithSnapshot({ A: '', B: 'N/A' });
		const fields = await adapter.getFields('X');
		expect(fields.A.value).toBeNull();
		expect(fields.B.value).toBeNull();
	});

	it('mantem parseNumber devolvendo zero para ausencia, pois o facade espera numero', () => {
		const adapter = new FundamentusFallbackAdapter();
		const parse = (adapter as any).parseNumber.bind(adapter);
		expect(parse('-')).toBe(0);
		expect(parse('')).toBe(0);
		expect(parse('N/A')).toBe(0);
		expect(parse('24,3%')).toBeCloseTo(24.3, 5);
	});

	it('nao altera getIndicators, que segue devolvendo numeros', async () => {
		const adapter = new FundamentusFallbackAdapter();
		jest
			.spyOn(adapter as any, 'loadSnapshot')
			.mockResolvedValue({ numeric: { ROIC: 0 }, text: { ROIC: '-' } });
		await expect(adapter.getIndicators('BBAS3')).resolves.toEqual({ ROIC: 0 });
	});

	it('devolve null para texto sem digitos, como setor', async () => {
		const adapter = adapterWithSnapshot({
			SETOR: 'Bancos',
			SUBSETOR: 'Intermediários Financeiros',
			SEGMENTO: 'Máquinas e Equipamentos',
		});
		const fields = await adapter.getFields('BBAS3');
		expect(fields.SETOR.value).toBeNull();
		expect(fields.SETOR.text).toBe('Bancos');
		expect(fields.SUBSETOR.value).toBeNull();
		expect(fields.SUBSETOR.text).toBe('Intermediários Financeiros');
		expect(fields.SEGMENTO.value).toBeNull();
		expect(fields.SEGMENTO.text).toBe('Máquinas e Equipamentos');
	});
});
