import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InsightDto, InsightsResponseDto } from './insight.dto';

/**
 * Contract test do espelho do `/api/insights` do trackerr-ia (TRA-133).
 *
 * A fixture reproduz o payload que `trackerr-ia/models/models.py::Insight`
 * emite hoje (TRA-56). Se o Pydantic mudar a shape, este teste falha antes
 * do web receber dado quebrado.
 */
describe('InsightDto (contract)', () => {
	const fullPayload = {
		insights: [
			{
				id: 'exposure_cripto_1',
				title: 'Exposicao a cripto acima do teto do perfil',
				body: 'Cripto responde por 18% da carteira; o teto sugerido do perfil moderado e 10%.',
				rationale:
					'Reduzir a fatia de cripto libera espaco para renda fixa sem alterar o retorno esperado significativamente.',
				evidence: [
					{ label: 'Peso cripto', value: 0.18, source: 'exposure.cripto' },
					{ label: 'Teto do perfil', value: 0.1 },
					{ label: 'Sinalizado', value: true, source: 'profile.moderate' },
				],
				confidence: {
					value: 0.82,
					bucket: 'alta',
					reason: 'Peso 80% acima do teto do perfil.',
				},
				action: {
					label: 'Rebalancear cripto',
					route: '/rebalance',
					payload: { focus: 'crypto', targetPct: 0.1 },
					why: 'Reduz risco sem alterar retorno esperado.',
				},
				sources: [
					{
						source_type: 'portfolio_snapshot',
						source_id: 'snap_2026_02_11',
						as_of: '2026-02-11',
					},
					{
						knowledge_base: 'risk_playbook',
						source_id: 'playbook.crypto_cap',
					},
				],
			},
		],
	};

	const legacyPayload = {
		insights: [
			{
				id: 'legacy_1',
				title: 'Insight legado',
				body: 'Este payload nao carrega os campos novos.',
			},
		],
	};

	it('accepts the full trackerr-ia payload with new fields', async () => {
		const instance = plainToInstance(InsightsResponseDto, fullPayload);
		const errors = await validate(instance, { whitelist: false });
		expect(errors).toEqual([]);
	});

	it('accepts the legacy subset (title + body only) for backward compatibility', async () => {
		const instance = plainToInstance(InsightsResponseDto, legacyPayload);
		const errors = await validate(instance);
		expect(errors).toEqual([]);
	});

	it('round-trips the new fields without losing structure', () => {
		const instance = plainToInstance(InsightsResponseDto, fullPayload);
		const first = instance.insights[0];
		expect(first).toBeInstanceOf(InsightDto);
		expect(first.rationale).toBe(fullPayload.insights[0].rationale);
		expect(first.evidence).toHaveLength(3);
		expect(first.evidence?.[0].value).toBe(0.18);
		expect(first.evidence?.[0].source).toBe('exposure.cripto');
		expect(first.confidence?.bucket).toBe('alta');
		expect(first.confidence?.value).toBeCloseTo(0.82);
		expect(first.action?.route).toBe('/rebalance');
		expect(first.action?.payload).toEqual({
			focus: 'crypto',
			targetPct: 0.1,
		});
		expect(first.sources).toHaveLength(2);
		expect(first.sources?.[1].knowledge_base).toBe('risk_playbook');
	});

	it('rejects a confidence value outside [0,1]', async () => {
		const broken = {
			insights: [
				{
					id: 'broken_confidence',
					title: 't',
					body: 'b',
					confidence: { value: 1.5, bucket: 'alta', reason: 'x' },
				},
			],
		};
		const instance = plainToInstance(InsightsResponseDto, broken);
		const errors = await validate(instance);
		expect(errors.length).toBeGreaterThan(0);
	});

	it('rejects an unknown confidence bucket', async () => {
		const broken = {
			insights: [
				{
					id: 'broken_bucket',
					title: 't',
					body: 'b',
					confidence: { value: 0.5, bucket: 'muito_alta', reason: 'x' },
				},
			],
		};
		const instance = plainToInstance(InsightsResponseDto, broken);
		const errors = await validate(instance);
		expect(errors.length).toBeGreaterThan(0);
	});
});
