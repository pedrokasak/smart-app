export type B3InvestorEnvironment = 'certification' | 'production';

export interface B3InvestorConfig {
	environment: B3InvestorEnvironment;
	/** Host das APIs, com porta (ex.: https://apib3i-cert.b3.com.br:2443). */
	baseUrl: string;
	/** Endpoint OAuth2 (Azure AD) que emite o token client_credentials. */
	tokenUrl: string;
	scope: string;
	clientId: string;
	clientSecret: string;
	/** Certificado do pacote de acesso (`#.cer`), para o mTLS. */
	certPath: string;
	/** Chave do pacote de acesso (`#.key`). */
	keyPath: string;
	/** Conteúdo de `#_senha_p12.txt`; a chave vem cifrada com ela. */
	keyPassphrase?: string;
	/** CA extra, caso o host da B3 use uma cadeia fora do store do sistema. */
	caPath?: string;
	timeoutMs: number;
}

/**
 * Valores do portal developers.b3.com.br (página "Autenticação", lida em
 * 2026-10-28). A B3 marca as URLs de token como ilustrativas, por isso
 * todas podem ser sobrescritas por variável de ambiente.
 */
const DEFAULTS: Record<
	B3InvestorEnvironment,
	Pick<B3InvestorConfig, 'baseUrl' | 'tokenUrl' | 'scope'>
> = {
	certification: {
		baseUrl: 'https://apib3i-cert.b3.com.br:2443',
		tokenUrl:
			'https://login.microsoftonline.com/4bee639f-5388-44c7-bbac-cb92a93911e6/oauth2/v2.0/token',
		scope: '0c991613-4c90-454d-8685-d466a47669cb/.default',
	},
	production: {
		baseUrl: 'https://investidor.b3.com.br:2443',
		tokenUrl:
			'https://login.microsoftonline.com/aa5ac705-873b-4afc-a29d-f0adb89ccf5c/oauth2/v2.0/token',
		scope: 'abae5dfa-65e6-47c1-82ec-a54a8a3213b9/.default',
	},
};

const REQUIRED_VARIABLES = [
	'B3_INVESTOR_CLIENT_ID',
	'B3_INVESTOR_CLIENT_SECRET',
	'B3_INVESTOR_CERT_PATH',
	'B3_INVESTOR_KEY_PATH',
] as const;

const DEFAULT_TIMEOUT_MS = 20_000;

export type B3InvestorEnvSource = Record<string, string | undefined>;

export type B3InvestorConfigResult =
	| { status: 'configured'; config: B3InvestorConfig }
	/** Nenhuma variável obrigatória definida: integração desligada. */
	| { status: 'disabled' }
	/** Só parte das obrigatórias definida: quase sempre erro de deploy. */
	| { status: 'incomplete'; missing: string[] };

function read(source: B3InvestorEnvSource, name: string): string | undefined {
	const value = source[name]?.trim();
	return value ? value : undefined;
}

function parseEnvironment(raw: string | undefined): B3InvestorEnvironment {
	return raw?.toLowerCase() === 'production' ? 'production' : 'certification';
}

function parseTimeout(raw: string | undefined): number {
	const value = Number(raw);
	return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

/**
 * Monta a configuração a partir das variáveis `B3_INVESTOR_*`. Sem nenhuma
 * delas a integração fica desligada; o ambiente padrão é o de certificação,
 * então produção só é usada quando pedida explicitamente.
 */
export function loadB3InvestorConfig(
	source: B3InvestorEnvSource
): B3InvestorConfigResult {
	const missing = REQUIRED_VARIABLES.filter((name) => !read(source, name));
	if (missing.length === REQUIRED_VARIABLES.length) {
		return { status: 'disabled' };
	}
	if (missing.length > 0) {
		return { status: 'incomplete', missing: [...missing] };
	}

	const environment = parseEnvironment(read(source, 'B3_INVESTOR_ENV'));
	const defaults = DEFAULTS[environment];
	return {
		status: 'configured',
		config: {
			environment,
			baseUrl: (
				read(source, 'B3_INVESTOR_BASE_URL') ?? defaults.baseUrl
			).replace(/\/+$/, ''),
			tokenUrl: read(source, 'B3_INVESTOR_TOKEN_URL') ?? defaults.tokenUrl,
			scope: read(source, 'B3_INVESTOR_SCOPE') ?? defaults.scope,
			clientId: read(source, 'B3_INVESTOR_CLIENT_ID')!,
			clientSecret: read(source, 'B3_INVESTOR_CLIENT_SECRET')!,
			certPath: read(source, 'B3_INVESTOR_CERT_PATH')!,
			keyPath: read(source, 'B3_INVESTOR_KEY_PATH')!,
			keyPassphrase: read(source, 'B3_INVESTOR_KEY_PASSPHRASE'),
			caPath: read(source, 'B3_INVESTOR_CA_PATH'),
			timeoutMs: parseTimeout(read(source, 'B3_INVESTOR_TIMEOUT_MS')),
		},
	};
}
