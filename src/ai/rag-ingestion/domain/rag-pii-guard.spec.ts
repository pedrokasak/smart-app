import { containsPersonalData } from 'src/ai/rag-ingestion/domain/rag-pii-guard';

describe('containsPersonalData (ADR-002, TRA-16)', () => {
	it.each([
		'CPF 123.456.789-09 comprou ITSA4',
		'documento 12345678909',
		'CNPJ 12.345.678/0001-95',
		'cnpj 12345678000195',
		'contato joao@email.com',
		'agência 1234 conta 99887-6',
		'c/c 123456',
	])('flags "%s"', (text) => {
		expect(containsPersonalData(text)).toBe(true);
	});

	it.each([
		'ITSA4 em 03/2026: 2 compras (300 unidades, preço médio R$ 10,47), custos R$ 4,90.',
		'Patrimônio total da carteira: R$ 1.234.567. 12 ativos.',
		'Renda fixa: CDB 110% do CDI · vence 06/2028. Aplicado R$ 10.000 em 15/03/2025.',
	])('lets the real fact text through: "%s"', (text) => {
		expect(containsPersonalData(text)).toBe(false);
	});
});
