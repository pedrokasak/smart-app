/**
 * Classe de fundo do registro da CVM (RCVM 175: fundo → classe → subclasse).
 * Só as classes FIF entram: são elas que publicam cota diária no Informe
 * Diário. FIDC, FIP, FII e afins ficam de fora (TRA-276).
 */
export interface FundSubclass {
	id: string;
	name: string;
}

export interface InvestmentFundClass {
	/** 14 dígitos do CNPJ da classe. */
	cnpj: string;
	name: string;
	/** "Renda Fixa", "Ações", "Multimercado", "Cambial"…; `null` se a CVM não informa. */
	classification: string | null;
	/** "Em Funcionamento Normal", "Em Liquidação", "Fase Pré-Operacional". */
	status: string;
	/** "Aberto" ou "Fechado". */
	condominium: string | null;
	exclusive: boolean;
	targetAudience: string | null;
	subclasses: FundSubclass[];
}
