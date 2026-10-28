import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
	ASSETS_AND_RIGHTS_TABLES,
	assetsAndRightsTableFor,
	assetsAndRightsCodeCaveat,
	formatAssetsAndRightsCode,
} from 'src/fiscal/domain/assets-and-rights-codes';
import {
	buildIrGuideSteps,
	buildSummaryGuide,
} from 'src/fiscal/domain/ir-guide';

describe('códigos de Bens e Direitos', () => {
	describe('assetsAndRightsTableFor', () => {
		it('usa a tabela vigente no exercício, inclusive o que ainda não teve tabela nova', () => {
			// Ano-calendário 2026 é entregue no exercício 2027.
			expect(assetsAndRightsTableFor(2027)?.sinceExercise).toBe(2022);
			expect(assetsAndRightsTableFor(2022)?.sinceExercise).toBe(2022);
		});

		it('não devolve tabela para exercício anterior à primeira conhecida', () => {
			expect(assetsAndRightsTableFor(2021)).toBeNull();
		});

		it('prefere a tabela mais recente que já valia no exercício', () => {
			const table = assetsAndRightsTableFor(2030);
			const latest = Math.max(
				...ASSETS_AND_RIGHTS_TABLES.map((t) => t.sinceExercise)
			);
			expect(table?.sinceExercise).toBe(latest);
		});
	});

	describe('texto do código', () => {
		const { stock, fii } = ASSETS_AND_RIGHTS_TABLES[0].codes;

		it('mostra grupo e código', () => {
			expect(formatAssetsAndRightsCode(stock)).toBe('Grupo 03, Código 01');
			expect(formatAssetsAndRightsCode(fii)).toBe('Grupo 07, Código 03');
		});

		it('manda conferir quando o código não é oficial', () => {
			expect(assetsAndRightsCodeCaveat(stock)).toContain('confira');
			expect(assetsAndRightsCodeCaveat({ ...stock, status: 'official' })).toBe(
				''
			);
		});
	});
});

describe('guia do resumo fiscal (buildSummaryGuide)', () => {
	const guide = buildSummaryGuide(2026);

	it('numera os passos em ordem', () => {
		guide.forEach((step, index) => {
			expect(step.startsWith(`Passo ${index + 1}: `)).toBe(true);
		});
	});

	it('cita os códigos de ações e de FII da tabela, com o aviso de conferência', () => {
		const text = guide.join('\n');
		expect(text).toContain('Para ações, use Grupo 03, Código 01');
		expect(text).toContain('Para FIIs, use Grupo 07, Código 03');
		expect(text).toContain('confira o código na lista do programa');
	});

	it('não inventa código de ETF', () => {
		const etf = guide.find((step) => step.includes('ETF'));
		expect(etf).toContain('escolha na lista do programa');
		expect(etf).not.toMatch(/Grupo|Código \d/);
	});

	it('não traz mais o código antigo das ações', () => {
		expect(guide.join('\n')).not.toContain('Código 31');
	});
});

describe('guia do relatório de IR (buildIrGuideSteps)', () => {
	const steps = buildIrGuideSteps(2026);

	it('mantém os seis passos de antes', () => {
		expect(steps).toHaveLength(6);
		expect(steps.map((step) => step.title.slice(0, 2))).toEqual([
			'1)',
			'2)',
			'3)',
			'4)',
			'5)',
			'6)',
		]);
	});

	it('o primeiro passo usa o código de ações da tabela e fala de FII e ETF', () => {
		const [first] = steps;
		expect(first.title).toBe(
			'1) Bens e Direitos (ações) - Grupo 03, Código 01'
		);
		expect(first.details).toContain('Grupo 07, Código 03');
		expect(first.details).toContain('ETFs e outros fundos');
		expect(first.details).toContain('31/12/2026');
	});

	it('não traz o código antigo das ações', () => {
		expect(JSON.stringify(steps)).not.toContain('Código 31');
	});
});

// Exercício anterior à primeira tabela conhecida: sem tabela, o guia não
// chuta código e manda o usuário para a lista do programa.
describe('guias de um ano sem tabela de códigos', () => {
	const NO_TABLE_YEAR = 2020; // exercício 2021

	it('o guia do relatório não cita grupo nem código', () => {
		const [first] = buildIrGuideSteps(NO_TABLE_YEAR);

		expect(first.title).toBe('1) Bens e Direitos (ações)');
		expect(first.details).toContain('escolha o código na lista do programa');
		expect(first.details).not.toMatch(/Grupo\s+\d/);
	});

	it('o guia do resumo também manda escolher na lista do programa', () => {
		const text = buildSummaryGuide(NO_TABLE_YEAR).join('\n');

		expect(text).toContain('Para ações, escolha o código na lista do programa');
		expect(text).toContain('Para FIIs, escolha o código na lista do programa');
		expect(text).not.toMatch(/Grupo\s+\d/);
	});
});

// Trava: o código não pode voltar a ser escrito à mão onde o usuário lê. Olha
// todo o módulo fiscal, não só os dois arquivos que tinham o problema.
describe('códigos de bem fora da fonte única', () => {
	const root = join(__dirname, '..');
	const ALLOWED = new Set([
		'domain/assets-and-rights-codes.ts',
		'domain/ir-guide.ts',
	]);

	const sourceFiles = (dir: string, base = ''): string[] =>
		readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
			const relative = base ? `${base}/${entry.name}` : entry.name;
			if (entry.isDirectory())
				return sourceFiles(join(dir, entry.name), relative);
			return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
				? [relative]
				: [];
		});

	const files = sourceFiles(root).filter((file) => !ALLOWED.has(file));

	it('encontra os arquivos do módulo', () => {
		expect(files).toEqual(
			expect.arrayContaining([
				'fiscal.controller.ts',
				'services/ir-report.service.ts',
			])
		);
	});

	it.each(files)('%s não escreve "Grupo NN" nem "Código NN"', (file) => {
		const source = readFileSync(join(root, file), 'utf8');
		expect(source).not.toMatch(/Grupo\s+\d{2}/);
		expect(source).not.toMatch(/C[óo]digo\s+\d{2}/);
	});
});
