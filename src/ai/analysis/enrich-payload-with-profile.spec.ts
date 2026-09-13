import { enrichPayloadWithProfile } from './enrich-payload-with-profile';
import { InvestorSophisticationProfile } from 'src/intelligence/application/investor-profile/investor-profile.types';

const profile: InvestorSophisticationProfile = {
	sophistication: 'experienced',
	riskTolerance: 'aggressive',
	confidence: 0.82,
	signals: {
		distinctAssetCount: 12,
		distinctSectorCount: 0,
		tradesLast12Months: 60,
		accountAgeDays: 400,
		variableIncomeAllocationPct: 80,
		hasAdvancedInstrument: true,
	},
	source: 'inferred',
};

describe('enrichPayloadWithProfile', () => {
	it('injeta sofisticacao e tolerancia a risco vindas do perfil', () => {
		const result = enrichPayloadWithProfile({
			body: { portfolio: { assets: [] } },
			userId: 'user-1',
			profile,
		});

		expect(result.sophistication).toBe('experienced');
		expect(result.risk_profile).toBe('aggressive');
		expect(result.profile_confidence).toBe(0.82);
		expect(result.profile_source).toBe('inferred');
	});

	it('preserva o resto do corpo enviado pelo cliente', () => {
		const result = enrichPayloadWithProfile({
			body: { portfolio: { assets: [1, 2] }, profile_plan: 'pro' },
			userId: 'user-1',
			profile,
		});

		expect(result.portfolio).toEqual({ assets: [1, 2] });
		expect(result.profile_plan).toBe('pro');
	});

	// O ponto central: perfil e dado derivado que o servidor possui. Aceitar o
	// valor do cliente seria confiar em entrada nao verificada para decidir o tom
	// de uma recomendacao financeira.
	it('sobrescreve o que o cliente tentou ditar sobre o perfil', () => {
		const result = enrichPayloadWithProfile({
			body: {
				risk_profile: 'conservative',
				sophistication: 'beginner',
				profile_confidence: 1,
				profile_source: 'user_override',
			},
			userId: 'user-1',
			profile,
		});

		expect(result.risk_profile).toBe('aggressive');
		expect(result.sophistication).toBe('experienced');
		expect(result.profile_confidence).toBe(0.82);
		expect(result.profile_source).toBe('inferred');
	});

	// Um default silencioso e indistinguivel de um perfil real do outro lado.
	it('omite os campos quando nao ha perfil, em vez de inventar um default', () => {
		const result = enrichPayloadWithProfile({
			body: { risk_profile: 'moderate', sophistication: 'experienced' },
			userId: 'user-1',
			profile: null,
		});

		expect(result).not.toHaveProperty('sophistication');
		expect(result).not.toHaveProperty('risk_profile');
		expect(result).not.toHaveProperty('profile_confidence');
		expect(result).not.toHaveProperty('profile_source');
	});

	it('usa o userId do token quando o corpo nao traz user_id', () => {
		const result = enrichPayloadWithProfile({
			body: {},
			userId: 'user-do-token',
			profile,
		});

		expect(result.user_id).toBe('user-do-token');
	});

	it('respeita o user_id do corpo quando ele vem preenchido', () => {
		const result = enrichPayloadWithProfile({
			body: { user_id: 'user-do-corpo' },
			userId: 'user-do-token',
			profile,
		});

		expect(result.user_id).toBe('user-do-corpo');
	});
});
