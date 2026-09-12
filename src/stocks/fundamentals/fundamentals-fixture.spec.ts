import { readFileSync } from 'fs';
import { join } from 'path';
import {
	FundamentusFallbackAdapter,
	extractTdPairs,
} from 'src/stocks/adapter/fundamentus-fallback.adapter';
import { FundamentalsService } from './fundamentals.service';

/**
 * Teste de ponta a ponta do parsing, contra HTML REAL gravado.
 *
 * Por que ele existe: todas as tarefas anteriores testaram o servico contra
 * mocks com as chaves que o autor SUPOS ("ROIC", "MARG. LIQUIDA"). O unico
 * codigo que produz chaves de verdade e a extracao do adapter, e ela nunca
 * esteve no mesmo teste. As chaves reais carregam o marcador de ajuda que mora
 * dentro da celula de rotulo — `?ROIC` — entao o mapa do servico batia consigo
 * mesmo e com mais nada. 565 testes verdes, zero indicador na tela.
 *
 * As fixtures em `src/stocks/adapter/__fixtures__` sao os bytes originais das
 * paginas de detalhe do Fundamentus, gravados em ISO-8859-1 (latin-1) como a
 * fonte serve. Nenhuma chave e escrita a mao neste arquivo.
 */

const FIXTURES = join(__dirname, '..', 'adapter', '__fixtures__');

function loadFixture(name: string): string {
	// latin-1 de proposito (spec 7): decodificar como UTF-8 corrompe justamente
	// os rotulos acentuados usados para localizar os campos.
	return readFileSync(join(FIXTURES, name), 'latin1');
}

/**
 * `textContent` de cada `<td>`, em ordem de documento — o mesmo que o browser
 * entrega ao `page.$$eval('td', extractTdPairs)`.
 *
 * Feito por varredura de texto porque o projeto nao tem jsdom e o Chromium do
 * Puppeteer nao esta baixado; subir um browser num teste unitario tambem sairia
 * caro. A equivalencia se sustenta porque as fixtures nao tem `<td>` aninhado
 * (o teste abaixo verifica isso), entao cada celula e uma folha e o texto sai
 * igual ao do DOM. O ponto que importa — o `?` fazer parte do rotulo — vem dos
 * bytes gravados, nao desta funcao.
 */
function tdTextContents(html: string): Array<{ textContent: string }> {
	const out: Array<{ textContent: string }> = [];
	const cell = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
	let match: RegExpExecArray | null;
	while ((match = cell.exec(html)) !== null) {
		const text = match[1]
			.replace(/<[^>]*>/g, '')
			.replace(/&nbsp;/g, ' ')
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>');
		out.push({ textContent: text });
	}
	return out;
}

function fieldsFromFixture(name: string) {
	const html = loadFixture(name);
	const adapter = new FundamentusFallbackAdapter();
	// Passa pelo caminho de extracao real do adapter: os mesmos pares e a mesma
	// normalizacao de rotulo que rodam em producao. So a etapa de rede (subir o
	// Puppeteer e navegar) e substituida pelos bytes gravados.
	const snapshot = (adapter as any).buildSnapshot(
		extractTdPairs(tdTextContents(html))
	);
	jest.spyOn(adapter as any, 'loadSnapshot').mockResolvedValue(snapshot);
	return { adapter, snapshot };
}

function serviceFor(name: string) {
	const { adapter } = fieldsFromFixture(name);
	const yahoo = {
		getPayoutInputs: jest.fn().mockResolvedValue({
			payoutRatio: null,
			dividendsPaid: null,
			netIncome: null,
			fiscalPeriod: null,
		}),
	};
	return new FundamentalsService(adapter as any, yahoo as any);
}

describe('fundamentos contra HTML real do Fundamentus', () => {
	beforeEach(() => {
		(FundamentalsService as any).answered.clear();
	});

	it('as fixtures nao tem td aninhado, entao a varredura equivale ao DOM', () => {
		for (const name of ['fundamentus-wege3.html', 'fundamentus-bbas3.html']) {
			const html = loadFixture(name);
			let depth = 0;
			let nested = 0;
			const tag = /<(\/?)td\b/gi;
			let match: RegExpExecArray | null;
			while ((match = tag.exec(html)) !== null) {
				if (match[1]) depth--;
				else {
					if (depth > 0) nested++;
					depth++;
				}
			}
			expect(nested).toBe(0);
		}
	});

	it('a chave real do rotulo carrega o marcador de ajuda da celula', async () => {
		// Esta e a assercao que fixa o defeito. A pagina traz
		// `<span class="help tips">?</span><span class="txt">ROIC</span>`, entao
		// o textContent da celula e "?ROIC". Nenhum lookup exato por "ROIC"
		// pode funcionar, e nenhum mock escrito a mao mostraria isso.
		const { adapter } = fieldsFromFixture('fundamentus-wege3.html');
		const fields = await adapter.getFields('WEGE3');
		const chaves = Object.keys(fields);

		expect(chaves).toContain('?ROIC');
		expect(chaves).not.toContain('ROIC');
		expect(fields['?ROIC'].text).toBe('24,3%');
	});

	it('entrega ROIC, margem liquida e divida liquida reais para nao banco', async () => {
		const service = serviceFor('fundamentus-wege3.html');
		const result = await service.getFundamentals('WEGE3', {});

		expect(result.sector).toBe('Máquinas e Equipamentos');

		expect(result.values.roic.status).toBe('ok');
		expect(result.values.roic.source).toBe('fundamentus');
		expect(result.values.roic.value).toBeCloseTo(24.3, 5);

		expect(result.values.netMargin.status).toBe('ok');
		expect(result.values.netMargin.value).toBeCloseTo(16.6, 5);

		expect(result.values.netDebt.status).toBe('ok');
		expect(result.values.netDebt.value).toBe(-3734800000);
	});

	it('le tambem os multiplos de avaliacao da mesma pagina', async () => {
		const service = serviceFor('fundamentus-wege3.html');
		const result = await service.getFundamentals('WEGE3', {});

		expect(result.values.priceEarnings.value).toBeCloseTo(31.88, 5);
		expect(result.values.priceToBook.value).toBeCloseTo(10.57, 5);
		expect(result.values.returnOnEquity.value).toBeCloseTo(33.2, 5);
	});

	it('marca ROIC e margem de banco como nao aplicavel, nunca como 0,0%', async () => {
		const service = serviceFor('fundamentus-bbas3.html');
		const result = await service.getFundamentals('BBAS3', {});

		// O setor precisa ter sido lido: e ele que dispara a regra. Se a leitura
		// do setor ficasse para tras, `isApplicable(null, ...)` liberaria tudo e
		// o `0,0%` literal da fonte viraria margem liquida de verdade.
		expect(result.sector).toBe('Intermediários Financeiros');

		expect(result.values.roic.status).toBe('not_applicable');
		expect(result.values.roic.value).toBeNull();

		expect(result.values.netMargin.status).toBe('not_applicable');
		expect(result.values.netMargin.value).toBeNull();
		expect(result.values.netMargin.value).not.toBe(0);

		expect(result.values.netDebt.status).toBe('not_applicable');
		expect(result.values.netDebt.value).toBeNull();
	});

	it('banco ainda entrega os indicadores que se aplicam a ele', async () => {
		const service = serviceFor('fundamentus-bbas3.html');
		const result = await service.getFundamentals('BBAS3', {});

		expect(result.values.priceEarnings.value).toBeCloseTo(7.27, 5);
		expect(result.values.priceToBook.value).toBeCloseTo(0.58, 5);
		expect(result.values.returnOnEquity.value).toBeCloseTo(8.0, 5);
	});

	it('nao reporta deriva de fonte quando a pagina real e lida', async () => {
		const service = serviceFor('fundamentus-wege3.html');
		const warn = jest
			.spyOn((service as any).logger, 'warn')
			.mockImplementation(() => undefined);

		await service.getFundamentals('WEGE3', {});
		await service.getFundamentals('WEGE3', {});

		expect(warn).not.toHaveBeenCalled();
	});
});
