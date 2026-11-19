/**
 * Leitura de variável de ambiente como kill switch (ADR-005, seção 5).
 *
 * O ambiente só desliga, nunca liga por cima do painel: é o freio de quem
 * opera o servidor. Sem valor ou com "true", não opina. QUALQUER outro valor
 * escrito desliga ("false", "0", "off", "False") — quem mexe na variável
 * quer parar o agente, e a intenção não pode se perder num jeito diferente
 * de escrever "desligado". Mesma regra de `killSwitch` do vigia de RI.
 */
export function envKills(value: string | undefined): boolean {
	const normalized = String(value ?? '')
		.trim()
		.toLowerCase();
	return normalized !== '' && normalized !== 'true';
}

/** Leitura antiga de flag "liga só com true", usada para semear o banco. */
export function envIsTrue(value: string | undefined): boolean {
	return (
		String(value ?? '')
			.trim()
			.toLowerCase() === 'true'
	);
}

/** Desliga todos os agentes que não são críticos. */
export const AGENTS_KILL_ALL_ENV = 'AGENTS_KILL_ALL';

export function killAllActive(env: NodeJS.ProcessEnv): boolean {
	return envIsTrue(env[AGENTS_KILL_ALL_ENV]);
}
