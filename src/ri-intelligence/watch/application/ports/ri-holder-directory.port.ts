/** Quem tem o papel, e qual classe (TRA-261). */
export interface RiHolder {
	userId: string;
	/** A classe que ESTE usuario tem (PETR4), para o aviso falar dela. */
	ticker: string;
}

/**
 * Detentores de um emissor (TRA-261). O documento da CVM e da empresa, nao
 * da classe: quem tem PETR3 e quem tem PETR4 recebem o mesmo aviso, mesmo
 * que o vigia tenha registrado o documento so sob uma delas.
 */
export interface RiHolderDirectory {
	/** Usuarios com posicao > 0 em qualquer classe do emissor do ticker. */
	holdersOfIssuer(ticker: string): Promise<RiHolder[]>;
}

export const RI_HOLDER_DIRECTORY = Symbol('RI_HOLDER_DIRECTORY');
