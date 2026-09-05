/**
 * Vocabulario do motor de limiares (TRA-136, fase 4).
 *
 * O motor existe porque produtor nao decide. `allocation-breach.producer`
 * publica o par (meta, real) cru toda vez que avalia; sem uma camada de
 * decisao entre o consumidor e o `NotificationsService`, uma carteira 0,4pp
 * fora da meta viraria e-mail — e viraria de novo no dia seguinte, e no
 * outro, porque a condicao *continua* verdadeira. Ruido assim treina o
 * usuario a ignorar o canal inteiro.
 *
 * As regras aqui sao PURAS: recebem a leitura, o estado anterior e a
 * politica, devolvem uma decisao. Nada de Mongo, nada de Nest. A
 * persistencia do estado anterior fica atras da porta
 * `ThresholdStateStore`, entao toda a logica de borda e testavel sem banco.
 */

/** Identificador estavel da regra. Vira chave do estado persistido. */
export const THRESHOLD_RULE_IDS = {
	AllocationDrift: 'allocation.drift',
	PortfolioScoreDrop: 'portfolio.score.drop',
} as const;

export type ThresholdRuleId =
	(typeof THRESHOLD_RULE_IDS)[keyof typeof THRESHOLD_RULE_IDS];

/**
 * Chave do estado. `scope` separa condicoes independentes dentro da mesma
 * regra: para alocacao e o balde ('crypto', 'stocks', ...), porque estar
 * fora da meta em cripto e um fato distinto de estar fora em FIIs e cada um
 * arma e desarma sozinho. Regras cujo escopo e a carteira inteira usam um
 * escopo fixo.
 */
export interface ThresholdStateKey {
	userId: string;
	ruleId: ThresholdRuleId;
	scope: string;
}

/**
 * Leitura anterior de (usuario, regra, escopo). E o que transforma o motor
 * de "level-triggered" em "edge-triggered": sem isto nao ha como saber se a
 * condicao ACABOU de ficar verdadeira ou se ja estava.
 */
export interface ThresholdStateSnapshot {
	/** A ultima avaliacao ficou fora da banda? */
	breaching: boolean;
	/**
	 * Valor de referencia da regra. Para alocacao e o desvio observado (em
	 * pontos percentuais); para o score e o pico de score desde o ultimo
	 * desarme — ver `portfolio-score-drop.rule.ts`.
	 */
	referenceValue: number;
	/** ISO-8601 do ultimo disparo. `null` = nunca notificou nesta ativacao. */
	lastNotifiedAt: string | null;
	/** ISO-8601 da ultima avaliacao, para diagnostico. */
	lastEvaluatedAt: string;
}

export type ThresholdOutcome =
	/** Borda de subida (ou re-arme por cooldown): vale notificar. */
	| 'notify'
	/** Dentro da banda e ja estava dentro: nada a fazer. */
	| 'suppressed_inside_band'
	/** Continua fora da banda, ja notificado, cooldown nao venceu. */
	| 'suppressed_standing'
	/** Borda de descida: voltou para dentro da banda. Desarma, nao notifica. */
	| 'cleared'
	/** Fato discreto: nao passa por limiar nenhum, segue direto. */
	| 'pass_through'
	/** Leitura sem os numeros necessarios. Descartada. */
	| 'invalid';

/**
 * Ponto de evidencia deterministico. Mesmo shape de `InsightEvidenceDto`
 * (`label`/`value`/`source`) de proposito: a fase 5 manda isto ao
 * trackerr-ia como a UNICA fonte de numeros permitida no resumo. TRA-55 e
 * TRA-56 ja pagaram o preco de numero inventado; aqui a evidencia sai do
 * mesmo calculo que decidiu notificar.
 */
export interface ThresholdEvidenceItem {
	label: string;
	value: number | string;
	source: string;
}

export interface ThresholdDecision {
	ruleId: ThresholdRuleId | null;
	scope: string;
	outcome: ThresholdOutcome;
	/** Motivo legivel. Vai para o log — investigar "por que nao chegou". */
	reason: string;
	/** Atalho: o consumidor so precisa disto para seguir ou parar. */
	shouldNotify: boolean;
	/**
	 * Estado a persistir. `null` quando nao ha o que gravar (fato discreto
	 * ou leitura invalida).
	 */
	nextState: ThresholdStateSnapshot | null;
	evidence: ThresholdEvidenceItem[];
	/**
	 * Numeros derivados pela regra que o payload da notificacao precisa e o
	 * evento cru nao carrega (ex.: `previousScore`, `dropPoints`).
	 */
	metrics: Record<string, number>;
}

/** Politica efetiva ja resolvida (default do sistema + override do usuario). */
export interface ResolvedThresholdPolicy {
	/** Banda de tolerancia da regra de alocacao, em pontos percentuais. */
	allocationDriftBandPp: number;
	/** Queda minima de pontos de score que merece aviso. */
	scoreDropPoints: number;
	/** Re-arme por tempo para condicao que fica de pe, em horas. */
	cooldownHours: number;
}

/**
 * Contrato de uma regra de limiar. Generico no input porque cada regra le
 * numeros diferentes; o que e comum — comparar com o estado anterior e
 * decidir a borda — vive em `edge-trigger.ts` e e reusado por todas.
 */
export interface ThresholdRule<TInput> {
	readonly id: ThresholdRuleId;
	/** Escopo da leitura dentro da regra. Ver `ThresholdStateKey.scope`. */
	scopeOf(input: TInput): string;
	evaluate(
		input: TInput,
		previous: ThresholdStateSnapshot | null,
		policy: ResolvedThresholdPolicy,
		now: Date
	): ThresholdDecision;
}
