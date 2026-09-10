import { InvestorSophisticationProfile } from 'src/intelligence/application/investor-profile/investor-profile.types';

/**
 * Injeta o perfil do investidor no payload enviado ao trakker-ia (TRA-142).
 *
 * Antes desta função o `/ai/analyze` repassava o corpo do cliente quase intacto,
 * e o front mandava `risk_profile: 'moderate'` fixo. Resultado: o modelo gerava
 * todo texto sem saber com quem estava falando — nem a sofisticação do
 * investidor, nem a tolerância a risco real que o servidor já calculava
 * diariamente.
 *
 * O perfil é dado DERIVADO que o servidor possui. Aceitar o valor do cliente
 * seria confiar em entrada não verificada para decidir o tom de uma
 * recomendação financeira, então os campos são sobrescritos, não mesclados.
 */

export interface ProfileEnrichedPayload extends Record<string, unknown> {
	user_id: string;
	sophistication?: InvestorSophisticationProfile['sophistication'];
	risk_profile?: InvestorSophisticationProfile['riskTolerance'];
	profile_confidence?: number;
	profile_source?: InvestorSophisticationProfile['source'];
}

export function enrichPayloadWithProfile(params: {
	body: Record<string, unknown>;
	userId: string;
	profile: InvestorSophisticationProfile | null;
}): ProfileEnrichedPayload {
	const { body, userId, profile } = params;

	// Campos controlados pelo servidor. Removidos do corpo do cliente antes de
	// qualquer coisa, para que um cliente desatualizado (ou malicioso) não
	// consiga ditá-los por omissão nossa.
	const {
		sophistication: _ignoredSophistication,
		risk_profile: _ignoredRiskProfile,
		profile_confidence: _ignoredConfidence,
		profile_source: _ignoredSource,
		...clientControlled
	} = body;

	const payload: ProfileEnrichedPayload = {
		...clientControlled,
		user_id: String(body.user_id || userId),
	};

	// Sem perfil, os campos ficam AUSENTES em vez de receberem um valor padrão.
	// Um default silencioso ("moderate") é indistinguível de um perfil real do
	// lado do trakker-ia, e foi exatamente esse tipo de mentira conveniente que
	// motivou a mudança.
	if (!profile) {
		return payload;
	}

	payload.sophistication = profile.sophistication;
	payload.risk_profile = profile.riskTolerance;
	payload.profile_confidence = profile.confidence;
	payload.profile_source = profile.source;

	return payload;
}
