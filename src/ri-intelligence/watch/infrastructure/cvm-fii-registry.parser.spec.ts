import { parseFiiRegistry } from 'src/ri-intelligence/watch/infrastructure/cvm-fii-registry.parser';

const HEADER =
	'Tipo_Fundo_Classe;CNPJ_Fundo_Classe;Data_Referencia;Versao;Data_Entrega;Nome_Fundo_Classe;Codigo_ISIN';

function csv(...rows: string[]): string {
	return [HEADER, ...rows].join('\r\n');
}

describe('parseFiiRegistry (TRA-266)', () => {
	it('maps the FII code in the quota ISIN to the fund CNPJ, digits only', () => {
		const registry = parseFiiRegistry(
			csv(
				'Classe;11.728.688/0001-47;2026-08-01;1;2026-09-15;PÁTRIA LOG;BRHGLGCTF004',
				'Classe;12.005.956/0001-65;2026-08-01;1;2026-09-15;KINEA RENDA;BRKNRICTF007'
			)
		);

		expect(registry.get('HGLG')).toBe('11728688000147');
		expect(registry.get('KNRI')).toBe('12005956000165');
	});

	// Fundo que mudou de CNPJ (fundo -> classe, CVM 175): vale o mais recente.
	it('keeps the CNPJ of the latest report', () => {
		const registry = parseFiiRegistry(
			csv(
				'Classe;22.222.222/0001-22;2026-08-01;1;2026-09-15;NOVO;BRABCDCTF001',
				'Fundo;11.111.111/0001-11;2026-02-01;1;2026-03-15;ANTIGO;BRABCDCTF001'
			)
		);

		expect(registry.get('ABCD')).toBe('22222222000122');
	});

	it('pads a CNPJ that lost its leading zero', () => {
		const registry = parseFiiRegistry(
			csv('Classe;332266000131;2026-01-01;2;2026-03-17;VIA PARQUE;BRFVPQCTF015')
		);

		expect(registry.get('FVPQ')).toBe('00332266000131');
	});

	it('ignores rows without a quota ISIN or a CNPJ', () => {
		const registry = parseFiiRegistry(
			csv(
				'Classe;11.728.688/0001-47;2026-08-01;1;2026-09-15;RECIBO;BRHGLGR26M17',
				'Classe;11.728.688/0001-47;2026-08-01;1;2026-09-15;SEM ISIN;',
				'Classe;;2026-08-01;1;2026-09-15;SEM CNPJ;BRXPTOCTF001',
				'Classe;00.000.000/0000-00;2026-08-01;1;2026-09-15;ZERADO;BRZERACTF001'
			)
		);

		expect(registry.size).toBe(0);
	});

	it('reads the column name used before CVM 175', () => {
		const registry = parseFiiRegistry(
			[
				'CNPJ_Fundo;Data_Referencia;Codigo_ISIN',
				'11.728.688/0001-47;2022-05-01;BRHGLGCTF004',
			].join('\n')
		);

		expect(registry.get('HGLG')).toBe('11728688000147');
	});
});
