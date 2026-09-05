import {
	SYSTEM_THRESHOLD_POLICY,
	resolveThresholdPolicy,
} from './threshold-policy';

describe('resolveThresholdPolicy (TRA-136 fase 4)', () => {
	it('usuario sem configuracao recebe os defaults do sistema', () => {
		expect(resolveThresholdPolicy(null)).toEqual(SYSTEM_THRESHOLD_POLICY);
		expect(resolveThresholdPolicy(undefined)).toEqual(SYSTEM_THRESHOLD_POLICY);
		expect(resolveThresholdPolicy({})).toEqual(SYSTEM_THRESHOLD_POLICY);
	});

	it('override parcial so troca o campo informado', () => {
		expect(resolveThresholdPolicy({ allocationDriftBandPp: 5 })).toEqual({
			...SYSTEM_THRESHOLD_POLICY,
			allocationDriftBandPp: 5,
		});
	});

	it('cooldown 0 e valido: significa "so a borda de descida rearma"', () => {
		expect(resolveThresholdPolicy({ cooldownHours: 0 }).cooldownHours).toBe(0);
	});

	it('valor fora dos limites de sanidade cai no default', () => {
		const p = resolveThresholdPolicy({
			allocationDriftBandPp: -1,
			scoreDropPoints: 9999,
			cooldownHours: Number.NaN,
		});

		expect(p).toEqual(SYSTEM_THRESHOLD_POLICY);
	});

	it('defaults documentados nao mudam por acidente', () => {
		expect(SYSTEM_THRESHOLD_POLICY).toEqual({
			allocationDriftBandPp: 2,
			scoreDropPoints: 10,
			cooldownHours: 72,
		});
	});
});
