import { ResolvedThresholdPolicy } from './threshold.types';

/**
 * Politica de limiares: defaults do sistema + override por usuario.
 *
 * ------------------------------------------------------------------
 * Por que estes numeros
 * ------------------------------------------------------------------
 * BANDA DE ALOCACAO — 2,0 pontos percentuais. Uma meta de 30% com 30,4%
 * real nao e um rompimento: e oscilacao de preco de um dia. O produtor ja
 * arredonda o percentual em duas casas, entao qualquer banda abaixo de
 * ~0,5pp notificaria ruido de arredondamento. 2pp e a menor banda em que o
 * aviso ainda corresponde a algo que o usuario conseguiria corrigir com um
 * aporte — abaixo disso, o custo de corretagem do rebalanceamento supera o
 * desvio.
 *
 * QUEDA DE SCORE — 10 pontos. O score de diversificacao vai de 0 a 100 e o
 * proprio motor de inteligencia o classifica em quatro faixas
 * (poor/moderate/good/excellent) de ~25 pontos cada. 10 pontos e a metade
 * de uma faixa: grande o bastante para nao ser recomposicao normal de
 * carteira, pequeno o bastante para avisar antes da troca de faixa.
 *
 * COOLDOWN — 72 horas. Precisa ser MAIOR que a janela de deduplicacao do
 * NotificationsService (24h, `DEDUPE_WINDOW_HOURS`), senao os dois
 * mecanismos se sobrepoem e fica impossivel dizer qual segurou o disparo.
 * 72h tambem cobre o fim de semana: uma condicao que aparece na sexta nao
 * repete no sabado e no domingo, quando o usuario nao tem como agir.
 *
 * Tudo ajustavel por env (default do sistema) e por usuario (override).
 */
export const SYSTEM_THRESHOLD_POLICY: ResolvedThresholdPolicy = {
	allocationDriftBandPp: 2,
	scoreDropPoints: 10,
	cooldownHours: 72,
};

/** Override parcial do usuario. Campo ausente = usa o default do sistema. */
export type UserThresholdPolicyOverride = Partial<ResolvedThresholdPolicy>;

/**
 * Limites de sanidade. Um override vindo do banco nao pode desligar o motor
 * por acidente (banda gigante cala tudo; banda negativa notifica sempre).
 */
const BOUNDS: Record<keyof ResolvedThresholdPolicy, [number, number]> = {
	allocationDriftBandPp: [0.1, 50],
	scoreDropPoints: [1, 100],
	// 0 e valido e significa "sem re-arme por cooldown": so a borda de
	// descida rearma. Teto de 90 dias evita estado preso por engano.
	cooldownHours: [0, 24 * 90],
};

/**
 * Resolve a politica efetiva. Funcao pura — quem nao configurou nada recebe
 * exatamente os defaults do sistema, e um override fora dos limites e
 * ignorado em vez de derrubar a avaliacao.
 */
export function resolveThresholdPolicy(
	override?: UserThresholdPolicyOverride | null,
	systemDefaults: ResolvedThresholdPolicy = SYSTEM_THRESHOLD_POLICY
): ResolvedThresholdPolicy {
	return {
		allocationDriftBandPp: pick(
			override?.allocationDriftBandPp,
			systemDefaults.allocationDriftBandPp,
			'allocationDriftBandPp'
		),
		scoreDropPoints: pick(
			override?.scoreDropPoints,
			systemDefaults.scoreDropPoints,
			'scoreDropPoints'
		),
		cooldownHours: pick(
			override?.cooldownHours,
			systemDefaults.cooldownHours,
			'cooldownHours'
		),
	};
}

function pick(
	value: number | undefined,
	fallback: number,
	key: keyof ResolvedThresholdPolicy
): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
	const [min, max] = BOUNDS[key];
	if (value < min || value > max) return fallback;
	return value;
}
