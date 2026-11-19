/**
 * Evento corporativo que muda quantidade e preço médio sem ser compra ou
 * venda (TRA-231). Global por ativo: o mesmo desdobramento vale para todo
 * mundo que tem o papel na data ex.
 *
 * `ratio` é sempre "ações novas por ação antiga":
 * - SPLIT 1:2 → ratio 2 (cada ação vira duas);
 * - REVERSE_SPLIT 10:1 → ratio 0,1 (dez ações viram uma);
 * - BONUS de 10% → ratio 0,1 (uma ação nova a cada dez), com
 *   `bonusUnitCost`: o custo por ação que a companhia atribui à bonificação
 *   e que, pela regra da Receita, entra no custo de aquisição.
 */
export type CorporateEventType = 'SPLIT' | 'REVERSE_SPLIT' | 'BONUS';

export interface CorporateEvent {
	symbol: string;
	type: CorporateEventType;
	ratio: number;
	/** Data ex: quem tinha o papel no fechamento do dia anterior recebe. */
	exDate: Date;
	/** Só na bonificação. Sem valor informado, a bonificação entra sem custo. */
	bonusUnitCost?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Dia (UTC) da data ex, para ordenar evento antes dos negócios do mesmo dia. */
export const exDay = (event: Pick<CorporateEvent, 'exDate'>) =>
	Math.floor(event.exDate.getTime() / DAY_MS);

export function corporateEventError(event: CorporateEvent): string | null {
	if (!(event.ratio > 0) || !Number.isFinite(event.ratio)) {
		return 'ratio deve ser positivo';
	}
	if (event.type === 'SPLIT' && event.ratio <= 1) {
		return 'desdobramento deve ter ratio maior que 1';
	}
	if (event.type === 'REVERSE_SPLIT' && event.ratio >= 1) {
		return 'grupamento deve ter ratio menor que 1';
	}
	if (event.bonusUnitCost !== undefined && event.bonusUnitCost < 0) {
		return 'custo da bonificação não pode ser negativo';
	}
	return null;
}
