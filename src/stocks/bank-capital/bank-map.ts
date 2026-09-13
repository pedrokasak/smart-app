import { BankEntry } from './bank-capital.types';

// Verificado ao vivo contra a API do BCB (Olinda/IF.data) durante o desenho
// desta feature. BPAN4 e BPAC11 compartilham `prudentialCode` de proposito:
// o Banco Pan foi consolidado no conglomerado prudencial do BTG Pactual
// apos a aquisicao de controle, e esse e o dado real que o BCB publica.
const BANK_ENTRIES: readonly BankEntry[] = [
	{ symbol: 'BBAS3', bankName: 'Banco do Brasil', prudentialCode: 'C0080329' },
	{ symbol: 'ITUB3', bankName: 'Itaú Unibanco', prudentialCode: 'C0080099' },
	{ symbol: 'ITUB4', bankName: 'Itaú Unibanco', prudentialCode: 'C0080099' },
	{ symbol: 'BBDC3', bankName: 'Bradesco', prudentialCode: 'C0080075' },
	{ symbol: 'BBDC4', bankName: 'Bradesco', prudentialCode: 'C0080075' },
	{ symbol: 'SANB3', bankName: 'Santander Brasil', prudentialCode: 'C0080185' },
	{ symbol: 'SANB4', bankName: 'Santander Brasil', prudentialCode: 'C0080185' },
	{
		symbol: 'SANB11',
		bankName: 'Santander Brasil',
		prudentialCode: 'C0080185',
	},
	{ symbol: 'BPAC11', bankName: 'BTG Pactual', prudentialCode: 'C0080336' },
	{ symbol: 'ABCB4', bankName: 'Banco ABC Brasil', prudentialCode: 'C0080312' },
	{ symbol: 'BMGB4', bankName: 'Banco BMG', prudentialCode: 'C0080178' },
	{ symbol: 'BPAN4', bankName: 'Banco Pan', prudentialCode: 'C0080336' },
	{ symbol: 'BRSR3', bankName: 'Banrisul', prudentialCode: 'C0080154' },
	{ symbol: 'BRSR5', bankName: 'Banrisul', prudentialCode: 'C0080154' },
	{ symbol: 'BRSR6', bankName: 'Banrisul', prudentialCode: 'C0080154' },
	{ symbol: 'PINE4', bankName: 'Banco Pine', prudentialCode: 'C0080374' },
	{
		symbol: 'BAZA3',
		bankName: 'Banco da Amazônia',
		prudentialCode: 'C0081249',
	},
	{ symbol: 'BEES3', bankName: 'Banestes', prudentialCode: 'C0080147' },
	{ symbol: 'BEES4', bankName: 'Banestes', prudentialCode: 'C0080147' },
];

const BANK_MAP = new Map<string, BankEntry>(
	BANK_ENTRIES.map((entry) => [entry.symbol, entry])
);

export function getBankEntry(symbol: string): BankEntry | null {
	const normalized = String(symbol || '')
		.trim()
		.toUpperCase();
	if (!normalized) return null;
	return BANK_MAP.get(normalized) ?? null;
}
