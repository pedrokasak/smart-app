/**
 * Política de investimento de uma carteira (TRA-106).
 *
 * A finalidade escolhida no assistente "Nova carteira" sugere metas por
 * classe e um limite de concentração por ativo. Os números são os do handoff
 * (`Trackerr App.dc.html`, `walletPolicy`) e moram só aqui: o web pede a
 * sugestão pela API em vez de repetir a tabela.
 *
 * As metas não precisam somar 100%: o que sobra fica livre (a sugestão de
 * "Renda" deixa 5% sem destino). Somar mais de 100% é erro.
 */

export const PORTFOLIO_PURPOSES = [
	'long_term',
	'income',
	'speculative',
	'reserve',
] as const;

export type PortfolioPurpose = (typeof PORTFOLIO_PURPOSES)[number];

export const MAX_POLICY_TARGETS = 8;

export type PolicyTarget = {
	/** Identificador estável da classe (`fiis`, `fixed_income`...). */
	key: string;
	label: string;
	/** Meta em % do patrimônio da carteira, 0–100. */
	pct: number;
};

export type InvestmentPolicy = {
	targets: PolicyTarget[];
	/** Peso máximo de um único ativo, em %, 1–100. */
	maxPositionPct: number;
};

export type PurposeOption = {
	id: PortfolioPurpose;
	label: string;
	hint: string;
	policy: InvestmentPolicy;
};

const PURPOSES: Record<PortfolioPurpose, Omit<PurposeOption, 'id'>> = {
	long_term: {
		label: 'Longo prazo',
		hint: 'crescimento com aporte mensal',
		policy: {
			targets: [
				{ key: 'br_stocks', label: 'Ações BR', pct: 30 },
				{ key: 'global_etfs', label: 'ETFs globais', pct: 30 },
				{ key: 'fixed_income', label: 'Renda fixa', pct: 30 },
			],
			maxPositionPct: 8,
		},
	},
	income: {
		label: 'Renda',
		hint: 'proventos como objetivo',
		policy: {
			targets: [
				{ key: 'fiis', label: 'FIIs', pct: 40 },
				{ key: 'dividend_stocks', label: 'Ações pagadoras', pct: 30 },
				{ key: 'fixed_income', label: 'Renda fixa', pct: 25 },
			],
			maxPositionPct: 8,
		},
	},
	speculative: {
		label: 'Especulativa',
		hint: 'giro curto e risco alto',
		policy: {
			targets: [
				{ key: 'stocks', label: 'Ações', pct: 60 },
				{ key: 'crypto', label: 'Cripto', pct: 25 },
				{ key: 'cash', label: 'Caixa', pct: 15 },
			],
			maxPositionPct: 20,
		},
	},
	reserve: {
		label: 'Reserva',
		hint: 'liquidez diária',
		policy: {
			targets: [
				{ key: 'daily_liquidity', label: 'Liquidez diária', pct: 85 },
				{ key: 'treasury_selic', label: 'Tesouro Selic', pct: 15 },
				{ key: 'crypto', label: 'Cripto', pct: 0 },
			],
			maxPositionPct: 50,
		},
	},
};

export function isPortfolioPurpose(value: unknown): value is PortfolioPurpose {
	return (
		typeof value === 'string' &&
		(PORTFOLIO_PURPOSES as readonly string[]).includes(value)
	);
}

function clonePolicy(policy: InvestmentPolicy): InvestmentPolicy {
	return {
		targets: policy.targets.map((target) => ({ ...target })),
		maxPositionPct: policy.maxPositionPct,
	};
}

/** Cópia: quem recebe pode mexer sem alterar a tabela. */
export function suggestedPolicy(purpose: PortfolioPurpose): InvestmentPolicy {
	return clonePolicy(PURPOSES[purpose].policy);
}

export function purposeOptions(): PurposeOption[] {
	return PORTFOLIO_PURPOSES.map((id) => ({
		id,
		label: PURPOSES[id].label,
		hint: PURPOSES[id].hint,
		policy: suggestedPolicy(id),
	}));
}

export class InvalidPolicyError extends Error {}

/**
 * Valida e arredonda uma política vinda de fora (corpo da requisição ou
 * documento antigo). Formato e faixas já passam pelo DTO; aqui ficam as
 * regras que olham o conjunto: soma, chaves repetidas e quantidade.
 */
export function normalizePolicy(policy: InvestmentPolicy): InvestmentPolicy {
	const targets = policy.targets.map((target) => ({
		key: target.key.trim(),
		label: target.label.trim(),
		pct: Math.round(target.pct * 100) / 100,
	}));
	if (targets.length === 0 || targets.length > MAX_POLICY_TARGETS) {
		throw new InvalidPolicyError(
			`A política precisa de 1 a ${MAX_POLICY_TARGETS} metas.`
		);
	}
	const keys = new Set(targets.map((target) => target.key));
	if (keys.size !== targets.length) {
		throw new InvalidPolicyError('Cada classe aparece uma vez só na política.');
	}
	const total = targets.reduce((sum, target) => sum + target.pct, 0);
	// Mesma tolerância da meta de alocação: 33.33 x3 + 0.01.
	if (total > 100.01) {
		throw new InvalidPolicyError(
			'A soma das metas da política não pode passar de 100%.'
		);
	}
	return {
		targets,
		maxPositionPct: Math.round(policy.maxPositionPct * 100) / 100,
	};
}
