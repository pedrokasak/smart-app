import z from 'zod';
import {
	SYSTEM_THRESHOLD_POLICY,
	UserThresholdPolicyOverride,
} from 'src/thresholds/domain/threshold-policy';
import { ResolvedThresholdPolicy } from 'src/thresholds/domain/threshold.types';

/**
 * Defaults do sistema vindos de env, no mesmo padrao de `queue.config.ts`:
 * schema proprio, nenhuma variavel obrigatoria, e valor invalido cai no
 * default em vez de derrubar o processo. Um typo em
 * `THRESHOLDS_COOLDOWN_HOURS` nao pode impedir o servidor de subir.
 *
 * Os numeros e o porque de cada um estao em `threshold-policy.ts`.
 */
const schema = z.object({
	THRESHOLDS_ALLOCATION_BAND_PP: z.coerce.number().positive().optional(),
	THRESHOLDS_SCORE_DROP_POINTS: z.coerce.number().positive().optional(),
	THRESHOLDS_COOLDOWN_HOURS: z.coerce.number().min(0).optional(),
});

export function loadSystemThresholdPolicy(
	env: NodeJS.ProcessEnv = process.env
): ResolvedThresholdPolicy {
	const parsed = schema.safeParse(env);
	const values = parsed.success ? parsed.data : {};

	const override: UserThresholdPolicyOverride = {
		allocationDriftBandPp: values.THRESHOLDS_ALLOCATION_BAND_PP,
		scoreDropPoints: values.THRESHOLDS_SCORE_DROP_POINTS,
		cooldownHours: values.THRESHOLDS_COOLDOWN_HOURS,
	};

	return {
		allocationDriftBandPp:
			override.allocationDriftBandPp ??
			SYSTEM_THRESHOLD_POLICY.allocationDriftBandPp,
		scoreDropPoints:
			override.scoreDropPoints ?? SYSTEM_THRESHOLD_POLICY.scoreDropPoints,
		cooldownHours:
			override.cooldownHours ?? SYSTEM_THRESHOLD_POLICY.cooldownHours,
	};
}
