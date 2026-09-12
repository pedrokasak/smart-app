import {
	ThresholdStateKey,
	ThresholdStateSnapshot,
} from 'src/thresholds/domain/threshold.types';

/**
 * Persistencia da leitura anterior por (usuario, regra, escopo).
 *
 * E porta, e nao um model injetado direto, porque e o unico ponto do motor
 * que precisa de I/O: com ela atras de uma interface, TODA a logica de
 * borda, histerese e cooldown roda em teste unitario com um Map em memoria.
 * Era o requisito da fase — regra pura, estado plugavel.
 */
export interface ThresholdStateStore {
	load(key: ThresholdStateKey): Promise<ThresholdStateSnapshot | null>;
	save(key: ThresholdStateKey, state: ThresholdStateSnapshot): Promise<void>;
}

export const THRESHOLD_STATE_STORE = Symbol('THRESHOLD_STATE_STORE');
