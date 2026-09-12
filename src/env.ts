import z from 'zod';

const envSchema = z.object({
	DATABASE_URL: z.string().url(),
	JWT_SECRET: z.string(),
	EXPIRES_IN: z.string(),
	EXPIRES_IN_REFRESH_TOKEN: z.string(),
	URL_PRODUCTION: z.string(),
	URL_DEVELOPMENT: z.string(),
	TWELVE_DATA_API_KEY: z.string(),
	BRAPI_DATA_API_KEY: z.string(),
	STRIPE_PRIVATE_API_KEY: z.string(),
	STRIPE_PUBLIC_API_KEY: z.string(),
	STRIPE_WEBHOOK_SECRET: z.string(),
	STRIPE_WEBHOOK_SECRET_PROD: z.string(),
	PORT: z.string().optional(),
	ASAAS_API_KEY: z.string(),
	ASAAS_URL_SANDBOX: z.string(),
	GOOGLE_CLIENT_ID: z.string().optional(),
	GOOGLE_CSE_API_KEY: z.string().optional(),
	GOOGLE_CSE_ENGINE_ID: z.string().optional(),
	BRAPI_SUPPORTED_RANGES: z.string().optional(),
	DIGEST_TOKEN_SECRET: z.string(),
	/**
	 * Web Push / VAPID (TRA-136, fase 6). Opcionais de proposito: sem elas o
	 * modulo sobe com o push desligado (null object) em vez de derrubar o
	 * boot. Gerar o par com `npx web-push generate-vapid-keys`.
	 */
	VAPID_PUBLIC_KEY: z.string().optional(),
	VAPID_PRIVATE_KEY: z.string().optional(),
	VAPID_SUBJECT: z.string().optional(),
	/**
	 * Cifragem das credenciais de corretora (TRA-144). Opcional no schema
	 * porque ausencia = feature desligada (null object), nao boot quebrado.
	 * A validacao de FORMATO (64 hex) mora em `credential-cipher.factory.ts`
	 * e derruba o boot quando a variavel existe e esta malformada.
	 * Gerar com: openssl rand -hex 32
	 */
	BROKER_ENCRYPTION_KEY: z.string().optional(),
	/** Chave do formato v1 (AES-256-CBC). Somente leitura de linhas antigas. */
	BROKER_ENCRYPTION_KEY_LEGACY: z.string().optional(),
});

const isTestEnvironment = process.env.NODE_ENV === 'test';
const testDefaults: Record<string, string> = {
	DATABASE_URL: 'https://example.com',
	JWT_SECRET: 'test-secret',
	EXPIRES_IN: '1h',
	EXPIRES_IN_REFRESH_TOKEN: '7d',
	URL_PRODUCTION: 'https://example.com',
	URL_DEVELOPMENT: 'http://localhost:3000',
	TWELVE_DATA_API_KEY: 'test-key',
	BRAPI_DATA_API_KEY: 'test-key',
	STRIPE_PRIVATE_API_KEY: 'test-key',
	STRIPE_PUBLIC_API_KEY: 'test-key',
	STRIPE_WEBHOOK_SECRET: 'test-key',
	STRIPE_WEBHOOK_SECRET_PROD: 'test-key',
	ASAAS_API_KEY: 'test-key',
	ASAAS_URL_SANDBOX: 'https://example.com',
	DIGEST_TOKEN_SECRET: 'test-digest-secret',
};

// Parse the environment variables
const envSource = isTestEnvironment
	? { ...testDefaults, ...process.env }
	: process.env;
const env = envSchema.safeParse(envSource);
if (!env.success) {
	console.error('Invalid environment variables:', env.error.format());
	process.exit(1);
}

export const jwtSecret: string = env.data.JWT_SECRET;
export const expireKeepAliveConected: string = env.data.EXPIRES_IN;
export const expireKeepAliveConectedRefreshToken: string =
	env.data.EXPIRES_IN_REFRESH_TOKEN;
export const urlProduction: string = env.data.URL_PRODUCTION;
export const urlDevelopment: string = env.data.URL_DEVELOPMENT;
export const twelveDataApiKey: string = env.data.TWELVE_DATA_API_KEY;
export const brapiApiKey: string = env.data.BRAPI_DATA_API_KEY;
export const stripePrivateApiKey: string = env.data.STRIPE_PRIVATE_API_KEY;
export const stripePublicApiKey: string = env.data.STRIPE_PUBLIC_API_KEY;
export const stripeWebhookSecret: string = env.data.STRIPE_WEBHOOK_SECRET;
export const stripeWebhookSecretProduction: string =
	env.data.STRIPE_WEBHOOK_SECRET_PROD;
export const port: string = env.data.PORT;
export const asaasApiKey: string = env.data.ASAAS_API_KEY;
export const asaasUrlSandbox: string = env.data.ASAAS_URL_SANDBOX;
export const googleClientId: string | undefined = env.data.GOOGLE_CLIENT_ID;
export const googleCseApiKey: string | undefined = env.data.GOOGLE_CSE_API_KEY;
export const googleCseEngineId: string | undefined =
	env.data.GOOGLE_CSE_ENGINE_ID;
export const digestTokenSecret: string = env.data.DIGEST_TOKEN_SECRET;
export const vapidPublicKey: string | undefined = env.data.VAPID_PUBLIC_KEY;
export const vapidPrivateKey: string | undefined = env.data.VAPID_PRIVATE_KEY;
export const vapidSubject: string | undefined = env.data.VAPID_SUBJECT;
export const brokerEncryptionKey: string | undefined =
	env.data.BROKER_ENCRYPTION_KEY;
export const brokerEncryptionKeyLegacy: string | undefined =
	env.data.BROKER_ENCRYPTION_KEY_LEGACY;
