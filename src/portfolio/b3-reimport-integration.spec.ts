import * as fs from 'fs';
import * as xlsx from 'xlsx';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { AssetsService } from 'src/assets/assets.service';
import { PortfolioService } from 'src/portfolio/portfolio.service';
import { parseB3Workbook } from './portfolio.controller';

/**
 * Prova ponta a ponta da correção de proventos: arquivo real da B3 ->
 * parser real -> AssetsService real, com um armazenamento em memória no
 * lugar do Mongo.
 *
 * Responde às duas perguntas que os testes unitários não respondem:
 * os proventos se espalham pelos meses certos, e reimportar corrige em
 * vez de dobrar o total. O segundo ponto é o risco de verdade — a chave
 * de dedupe é `data|tipo|valor`, então antes do `replaceRange` o mesmo
 * provento com data errada e com data certa sobreviveria duas vezes.
 *
 * O arquivo real fica fora do repositório; sem ele os casos são pulados
 * em vez de falharem, para o CI não depender do Downloads de ninguém.
 */
const REAL_MOVEMENT_FILE =
	'C:/Users/Pedro Henrique/Downloads/movimentacao-2026-08-25-11-29-15.xlsx';

const hasRealFile = fs.existsSync(REAL_MOVEMENT_FILE);
const describeWithRealFile = hasRealFile ? describe : describe.skip;

describeWithRealFile('reimportação do extrato real da B3', () => {
	let service: AssetsService;
	let store: Map<string, any>;

	beforeEach(async () => {
		store = new Map();

		const mockAssetModel = {
			findById: jest.fn((id: string) => Promise.resolve(store.get(id) ?? null)),
			findByIdAndUpdate: jest.fn((id: string, update: any) => {
				const current = store.get(id) ?? {};
				const next = {
					...current,
					dividendHistory: update?.$set?.dividendHistory ?? [],
				};
				store.set(id, next);
				return Promise.resolve(next);
			}),
		};

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				AssetsService,
				{ provide: getModelToken('Asset'), useValue: mockAssetModel },
				{ provide: PortfolioService, useValue: {} },
			],
		}).compile();

		service = module.get<AssetsService>(AssetsService);
	});

	/**
	 * Cria o ativo no store para cada símbolo do arquivo, com quantidade 1.
	 * `upsertDividendHistoryEntries` desiste quando o ativo não existe, então
	 * sem esta semeadura os testes passariam comparando dois zeros.
	 */
	const seedAssetsFromFile = (): Map<string, number> => {
		const workbook = xlsx.readFile(REAL_MOVEMENT_FILE);
		const { dividendsBySymbol } = parseB3Workbook(workbook, new Date());
		const quantities = new Map<string, number>();
		for (const symbol of dividendsBySymbol.keys()) {
			quantities.set(symbol, 1);
			store.set(symbol, { dividendHistory: [] });
		}
		return quantities;
	};

	/** Repete o que o controller faz: parse + anexa proventos por ativo. */
	const runImport = async (quantityBySymbol: Map<string, number>) => {
		const workbook = xlsx.readFile(REAL_MOVEMENT_FILE);
		const { dividendsBySymbol, hasDatedDividends } = parseB3Workbook(
			workbook,
			new Date()
		);

		const allDates = [...dividendsBySymbol.values()]
			.flat()
			.map((event) => event.eventDate.getTime());
		// Mesma janela do controller: termina hoje, não no último evento.
		const replaceRange = hasDatedDividends
			? {
					from: new Date(Math.min(...allDates)),
					to: new Date(Math.max(Math.max(...allDates), Date.now())),
				}
			: undefined;

		for (const [symbol, events] of dividendsBySymbol.entries()) {
			const quantity = quantityBySymbol.get(symbol);
			if (!quantity) continue;

			await service.upsertDividendHistoryEntries(
				symbol,
				events.map((event) => ({
					date: event.eventDate,
					value: event.totalValue / quantity,
					paymentType: event.paymentType,
				})),
				replaceRange ? { replaceRange } : undefined
			);
		}

		return { dividendsBySymbol };
	};

	/** Reverte a divisão por quantidade, como o frontend faz ao exibir. */
	const totalStored = (quantityBySymbol: Map<string, number>): number => {
		let total = 0;
		for (const [symbol, asset] of store.entries()) {
			const quantity = quantityBySymbol.get(symbol) ?? 0;
			for (const entry of asset.dividendHistory ?? []) {
				total += Number(entry.value) * quantity;
			}
		}
		return total;
	};

	const monthsCovered = (): string[] => {
		const months = new Set<string>();
		for (const asset of store.values()) {
			for (const entry of asset.dividendHistory ?? []) {
				months.add(new Date(entry.date).toISOString().slice(0, 7));
			}
		}
		return [...months].sort();
	};

	it('espalha os proventos pelos meses reais e não empilha num só', async () => {
		const quantities = seedAssetsFromFile();

		await runImport(quantities);

		const meses = monthsCovered();
		// O extrato cobre mais de um ano; empilhar tudo num mês era o bug.
		expect(meses.length).toBeGreaterThan(12);
		expect(meses).toContain('2025-09');
	});

	it('reimportar o mesmo arquivo não dobra o total recebido', async () => {
		const quantities = seedAssetsFromFile();

		await runImport(quantities);
		const depoisDoPrimeiro = totalStored(quantities);

		await runImport(quantities);
		const depoisDoSegundo = totalStored(quantities);

		// Guarda contra passar comparando dois zeros.
		expect(depoisDoPrimeiro).toBeGreaterThan(0);
		expect(depoisDoSegundo).toBeCloseTo(depoisDoPrimeiro, 6);
	});

	it('substitui proventos carimbados com a data do upload pelo histórico correto', async () => {
		const quantities = seedAssetsFromFile();

		// Estado do banco de quem importou antes da correção: provento com a
		// data do upload, depois do último evento real do extrato.
		const [primeiroSimbolo] = quantities.keys();
		store.set(primeiroSimbolo, {
			dividendHistory: [
				{ date: new Date('2026-08-25'), value: 999, paymentType: 'DIVIDEND' },
			],
		});

		await runImport(quantities);

		const datas = (store.get(primeiroSimbolo).dividendHistory ?? []).map(
			(entry: any) => new Date(entry.date).toISOString().slice(0, 10)
		);
		// A entrada inventada estava dentro da janela do extrato, então saiu.
		expect(datas).not.toContain('2026-08-25');
		expect(datas.length).toBeGreaterThan(0);
	});

	it('a soma de 2025 bate com o total declarado pelo relatório consolidado', async () => {
		// Validação cruzada: dois arquivos da B3, layouts diferentes, mesmo
		// número. É a evidência mais forte de que o parse está certo.
		const workbook = xlsx.readFile(REAL_MOVEMENT_FILE);
		const { dividendsBySymbol } = parseB3Workbook(workbook, new Date());

		let soma2025 = 0;
		for (const events of dividendsBySymbol.values()) {
			for (const event of events) {
				if (event.eventDate.getUTCFullYear() === 2025) {
					soma2025 += event.totalValue;
				}
			}
		}

		expect(soma2025).toBeCloseTo(639.61, 2);
	});
});
