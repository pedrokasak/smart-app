import { onePerDocument } from 'src/ri-intelligence/infrastructure/ipe-row-dedupe';

function row(over: Record<string, string> = {}): Record<string, string> {
	return {
		Data_Referencia: '2026-06-30',
		Categoria: 'Dados Econômico-Financeiros',
		Tipo: 'Press-release',
		Especie: '',
		Assunto: 'Earnings Release versão Português',
		Data_Entrega: '2026-08-06',
		Versao: '1',
		Link_Download: 'https://rad/pt',
		...over,
	};
}

const links = (rows: Record<string, string>[]) =>
	rows.map((item) => item.Link_Download);

describe('onePerDocument (TRA-277)', () => {
	// O caso do print: release 2T26 do ABCB4 em portugues e em ingles.
	it('drops the English release when the Portuguese one exists', () => {
		const rows = [
			row({
				Assunto: 'Earnings Release English version',
				Link_Download: 'https://rad/en',
			}),
			row(),
		];

		expect(links(onePerDocument(rows))).toEqual(['https://rad/pt']);
	});

	it('recognizes "Inglês" in the subject', () => {
		const rows = [
			row({
				Tipo: 'Demonstrações Financeiras Intermediárias',
				Assunto: 'Demonstrações Financeiras BRGAAP - Versão Inglês',
				Link_Download: 'https://rad/en',
			}),
			row({ Tipo: 'Demonstrações Financeiras Intermediárias', Assunto: '' }),
		];

		expect(links(onePerDocument(rows))).toEqual(['https://rad/pt']);
	});

	// A versao em portugues das DFs em BR GAAP vem pelo ITR, nao pelo IPE.
	it('keeps an English document that has no Portuguese sibling', () => {
		const rows = [
			row({
				Tipo: 'Demonstrações Financeiras Intermediárias',
				Assunto: 'Demonstrações Financeiras em BR GAAP (versão em inglês)',
				Link_Download: 'https://rad/en',
			}),
			row(),
		];

		expect(links(onePerDocument(rows))).toEqual([
			'https://rad/en',
			'https://rad/pt',
		]);
	});

	it('keeps only the latest version of a resubmitted document', () => {
		const rows = [
			row({ Versao: '1', Link_Download: 'https://rad/v1' }),
			row({ Versao: '2', Link_Download: 'https://rad/v2' }),
		];

		expect(links(onePerDocument(rows))).toEqual(['https://rad/v2']);
	});

	it('breaks a version tie by the later delivery', () => {
		const rows = [
			row({ Data_Entrega: '2026-08-07', Link_Download: 'https://rad/late' }),
			row({ Data_Entrega: '2026-08-06', Link_Download: 'https://rad/early' }),
		];

		expect(links(onePerDocument(rows))).toEqual(['https://rad/late']);
	});

	it('keeps different documents of the same day apart', () => {
		const rows = [
			row({
				Categoria: 'Reunião da Administração',
				Tipo: 'Conselho de Administração',
				Especie: 'Ata',
				Assunto: 'Programa de Recompra',
				Link_Download: 'https://rad/recompra',
			}),
			row({
				Categoria: 'Reunião da Administração',
				Tipo: 'Conselho de Administração',
				Especie: 'Ata',
				Assunto: 'Homologação do aumento do capital social',
				Link_Download: 'https://rad/capital',
			}),
		];

		expect(onePerDocument(rows)).toHaveLength(2);
	});

	// "Inglês" sai do IPE como latin1 lido em utf8: "Ingl�s".
	it('recognizes the English marker even with a broken accent', () => {
		const rows = [
			row({ Assunto: 'Release Ingl�s', Link_Download: 'https://rad/en' }),
			row(),
		];

		expect(links(onePerDocument(rows))).toEqual(['https://rad/pt']);
	});
});
