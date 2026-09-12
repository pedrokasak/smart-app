import {
	buildCspMiddleware,
	isCspReportOnly,
	isSwaggerRequest,
} from './content-security-policy';

/**
 * O middleware do helmet so precisa de `res.setHeader` e de um `next`, entao
 * o teste roda sem servidor HTTP: nada de supertest, nada de porta aberta.
 */
function runMiddleware(path: string, reportOnly: boolean) {
	const headers = new Map<string, string>();
	const req = { path, url: path, method: 'GET' } as any;
	const res = {
		setHeader: (name: string, value: string) =>
			headers.set(name.toLowerCase(), value),
	} as any;
	const next = jest.fn();

	buildCspMiddleware(reportOnly)(req, res, next);

	expect(next).toHaveBeenCalledTimes(1);
	return headers;
}

describe('Content Security Policy (TRK-009)', () => {
	describe('modo', () => {
		it('e report-only quando CSP_REPORT_ONLY esta ausente', () => {
			expect(isCspReportOnly({} as NodeJS.ProcessEnv)).toBe(true);
		});

		it('e report-only quando a variavel esta vazia ou com valor inesperado', () => {
			expect(isCspReportOnly({ CSP_REPORT_ONLY: '' } as any)).toBe(true);
			expect(isCspReportOnly({ CSP_REPORT_ONLY: 'sim' } as any)).toBe(true);
			expect(isCspReportOnly({ CSP_REPORT_ONLY: 'true' } as any)).toBe(true);
		});

		it('so promove para enforce com o literal "false"', () => {
			expect(isCspReportOnly({ CSP_REPORT_ONLY: 'false' } as any)).toBe(false);
			expect(isCspReportOnly({ CSP_REPORT_ONLY: 'FALSE' } as any)).toBe(false);
		});
	});

	describe('header emitido', () => {
		it('sai como report-only e nao bloqueia nada', () => {
			const headers = runMiddleware('/broker-sync/connections', true);

			expect(headers.has('content-security-policy-report-only')).toBe(true);
			expect(headers.has('content-security-policy')).toBe(false);
		});

		it('vira enforce quando o modo muda — sem mudanca de codigo', () => {
			const headers = runMiddleware('/broker-sync/connections', false);

			expect(headers.has('content-security-policy')).toBe(true);
			expect(headers.has('content-security-policy-report-only')).toBe(false);
		});
	});

	describe('politica das rotas JSON', () => {
		it('nega tudo por padrao e tranca base-uri, form-action e frame-ancestors', () => {
			const policy = runMiddleware('/users', true).get(
				'content-security-policy-report-only'
			);

			expect(policy).toContain("default-src 'none'");
			expect(policy).toContain("frame-ancestors 'none'");
			expect(policy).toContain("base-uri 'none'");
			expect(policy).toContain("form-action 'none'");
		});

		it('nao libera script inline em rota de API', () => {
			const policy = runMiddleware('/users', true).get(
				'content-security-policy-report-only'
			);

			expect(policy).not.toContain('unsafe-inline');
			expect(policy).not.toContain('script-src');
		});
	});

	describe('politica do Swagger', () => {
		it.each([
			'/api',
			'/api/',
			'/api/swagger-ui-bundle.js',
			'/api-json',
			'/api-ui-init.js',
		])('reconhece %s como request da documentacao', (path) => {
			expect(isSwaggerRequest(path)).toBe(true);
		});

		it.each(['/users', '/apiary', '/broker-sync/connections', '/'])(
			'nao confunde %s com a documentacao',
			(path) => {
				expect(isSwaggerRequest(path)).toBe(false);
			}
		);

		it('libera inline apenas no path da documentacao', () => {
			const swagger = runMiddleware('/api', true).get(
				'content-security-policy-report-only'
			);

			expect(swagger).toContain("script-src 'self' 'unsafe-inline'");
			expect(swagger).toContain("style-src 'self' 'unsafe-inline'");
			expect(swagger).toContain("connect-src 'self'");
		});

		it('o afrouxamento nao vaza para a rota vizinha', () => {
			const api = runMiddleware('/apiary', true).get(
				'content-security-policy-report-only'
			);

			expect(api).not.toContain('unsafe-inline');
		});
	});
});
