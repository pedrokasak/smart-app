export type B3InvestorErrorKind =
	/** Integração desligada: faltam variáveis B3_INVESTOR_* no ambiente. */
	| 'not_configured'
	/** Falha ao obter o token OAuth (client_id/secret ou scope errados). */
	| 'auth_failed'
	/** 403 numa rota de investidor: sem consentimento ativo para o Trackerr. */
	| 'consent_missing'
	/** 403 numa rota da instituição: API fora do contrato ou certificado sem permissão. */
	| 'access_denied'
	/** Certificado, chave ou CA inválidos. Não adianta tentar de novo. */
	| 'tls_failed'
	/** Resposta fora do formato documentado (lado de negócio, paginação sem fim). */
	| 'unexpected_response'
	/** 429: a B3 limita requisições por segundo por instituição. */
	| 'rate_limited'
	/** 5xx, timeout ou erro de rede. */
	| 'unavailable'
	/** Qualquer outra resposta fora de 2xx (400, 404, 422...). */
	| 'request_rejected';

/**
 * Erro único da integração com a B3. O chamador decide pelo `kind`
 * (ex.: reagendar em `rate_limited`/`unavailable`) e nunca precisa
 * conhecer status HTTP nem o formato de erro da B3.
 */
export class B3InvestorError extends Error {
	constructor(
		readonly kind: B3InvestorErrorKind,
		message: string,
		readonly status?: number
	) {
		super(message);
		this.name = 'B3InvestorError';
	}

	get retryable(): boolean {
		return this.kind === 'rate_limited' || this.kind === 'unavailable';
	}
}
