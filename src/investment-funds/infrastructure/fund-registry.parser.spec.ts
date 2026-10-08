import {
	FundRegistrySchemaError,
	parseFundRegistry,
} from './fund-registry.parser';

// Cabeçalhos reais de 08/10/2026 (registro_fundo_classe.zip).
const CLASS_HEADER =
	'ID_Registro_Fundo;ID_Registro_Classe;CNPJ_Classe;Codigo_CVM;Data_Registro;Data_Constituicao;Data_Inicio;Tipo_Classe;Denominacao_Social;Situacao;Data_Inicio_Situacao;Classificacao;Indicador_Desempenho;Classe_Cotas;Classificacao_Anbima;Tributacao_Longo_Prazo;Entidade_Investimento;Permitido_Aplicacao_CemPorCento_Exterior;Classe_ESG;Forma_Condominio;Exclusivo;Publico_Alvo;Patrimonio_Liquido;Data_Patrimonio_Liquido;CNPJ_Auditor;Auditor;CNPJ_Custodiante;Custodiante;CNPJ_Controlador;Controlador';
const SUBCLASS_HEADER =
	'ID_Registro_Classe;ID_Subclasse;Codigo_CVM;Data_Constituicao;Data_Inicio;Denominacao_Social;Situacao;Data_Inicio_Situacao;Forma_Condominio;Exclusivo;Publico_Alvo;Previdenciario;Exclusivo_INR;Exclusivo_Previdencia_Complementar';

function classRow(fields: {
	id: string;
	cnpj: string;
	type?: string;
	name: string;
	status?: string;
	classification?: string;
	condominium?: string;
	exclusive?: string;
	audience?: string;
}): string {
	const cols = new Array(30).fill('');
	cols[1] = fields.id;
	cols[2] = fields.cnpj;
	cols[7] = fields.type ?? 'Classes de Cotas de Fundos FIF';
	cols[8] = fields.name;
	cols[9] = fields.status ?? 'Em Funcionamento Normal';
	cols[11] = fields.classification ?? '';
	cols[19] = fields.condominium ?? 'Aberto';
	cols[20] = fields.exclusive ?? 'N';
	cols[21] = fields.audience ?? 'Público Geral';
	return cols.join(';');
}

const classes = [
	CLASS_HEADER,
	classRow({
		id: '82',
		cnpj: '00017024000153',
		name: 'CLASSE ÚNICA DO FUNDO MULTIMERCADO EXEMPLO',
		classification: 'Multimercado',
	}),
	classRow({
		id: '83',
		cnpj: '00332266000131',
		type: 'Classes de Cotas de Fundos FII',
		name: 'FII FORA DO ESCOPO',
	}),
	classRow({
		id: '84',
		cnpj: '09613232000190',
		name: 'FUNDO CANCELADO',
		status: 'Cancelado',
	}),
	classRow({
		id: '85',
		cnpj: '00.000.000/0000-00',
		name: 'CNPJ INVÁLIDO',
	}),
	classRow({
		id: '86',
		cnpj: '11222333000181',
		type: 'Classes de Cotas de Fundos FIF (FAPI)',
		name: 'FAPI EXEMPLO',
		classification: '',
		exclusive: 'S',
	}),
].join('\r\n');

const subclasses = [
	SUBCLASS_HEADER,
	// Aspas fazem parte do nome: o arquivo não usa aspas de CSV.
	'82;MZMRC1747322915;251690;2025-05-15;2025-05-14;SUBCLASSE "A";Em Funcionamento Normal;2025-05-15;Aberto;N;Público Geral;N;N;N',
	'82;RBMFN1747320951;251682;2025-05-15;2025-05-14;SUBCLASSE I;Cancelado;2025-05-15;Aberto;N;Público Geral;N;N;N',
].join('\r\n');

describe('parseFundRegistry', () => {
	it('keeps active FIF classes with their active subclasses', () => {
		const result = parseFundRegistry({ classes, subclasses });

		expect(result).toEqual([
			{
				cnpj: '00017024000153',
				name: 'CLASSE ÚNICA DO FUNDO MULTIMERCADO EXEMPLO',
				classification: 'Multimercado',
				status: 'Em Funcionamento Normal',
				condominium: 'Aberto',
				exclusive: false,
				targetAudience: 'Público Geral',
				subclasses: [{ id: 'MZMRC1747322915', name: 'SUBCLASSE "A"' }],
			},
			{
				cnpj: '11222333000181',
				name: 'FAPI EXEMPLO',
				classification: null,
				status: 'Em Funcionamento Normal',
				condominium: 'Aberto',
				exclusive: true,
				targetAudience: 'Público Geral',
				subclasses: [],
			},
		]);
	});

	it('works without the subclass file', () => {
		const result = parseFundRegistry({ classes, subclasses: null });

		expect(result.map((item) => item.subclasses)).toEqual([[], []]);
	});

	it('stops when a column the domain uses is missing', () => {
		expect(() =>
			parseFundRegistry({
				classes: classes.replace('Denominacao_Social', 'Nome'),
				subclasses: null,
			})
		).toThrow(FundRegistrySchemaError);
	});

	it('skips rows with a different column count', () => {
		const result = parseFundRegistry({
			classes: `${classes}\r\n86;87;quebrada`,
			subclasses: null,
		});

		expect(result).toHaveLength(2);
	});
});
