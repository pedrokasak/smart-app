import { UserThresholdPolicyOverride } from 'src/thresholds/domain/threshold-policy';

/**
 * Politica configurada pelo usuario. Devolve `null` para quem nunca mexeu
 * em nada — e o caso comum, e a resolucao aplica os defaults do sistema.
 *
 * Separada do estado (`ThresholdStateStore`) porque tem ciclo de vida
 * proprio: a politica e configuracao, muda raramente e por acao do usuario;
 * o estado e operacional e muda a cada avaliacao.
 */
export interface ThresholdPolicyStore {
	findByUser(userId: string): Promise<UserThresholdPolicyOverride | null>;
}

export const THRESHOLD_POLICY_STORE = Symbol('THRESHOLD_POLICY_STORE');

/**
 * Defaults do sistema (`ResolvedThresholdPolicy`) injetados como valor. O
 * token vive na camada de porta para que o motor nao precise importar o
 * loader de env, que e infraestrutura.
 */
export const THRESHOLD_SYSTEM_POLICY = Symbol('THRESHOLD_SYSTEM_POLICY');
