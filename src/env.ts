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
});

// Parse the environment variables
const env = envSchema.safeParse(process.env);
if (!env.success) {
	if (!process.env.JEST_WORKER_ID && process.env.NODE_ENV !== 'test') {
		console.error('Invalid environment variables:', env.error.format());
		process.exit(1);
	}
}

const safeEnv = env.success
	? env.data
	: {
			DATABASE_URL: 'http://localhost:27017',
			JWT_SECRET: 'test-jwt-secret',
			EXPIRES_IN: '1d',
			EXPIRES_IN_REFRESH_TOKEN: '7d',
			URL_PRODUCTION: 'http://localhost:3000',
			URL_DEVELOPMENT: 'http://localhost:3000',
			TWELVE_DATA_API_KEY: 'test',
			BRAPI_DATA_API_KEY: 'test',
			STRIPE_PRIVATE_API_KEY: 'test',
			STRIPE_PUBLIC_API_KEY: 'test',
			STRIPE_WEBHOOK_SECRET: 'test',
			STRIPE_WEBHOOK_SECRET_PROD: 'test',
			PORT: '3000',
			ASAAS_API_KEY: 'test',
			ASAAS_URL_SANDBOX: 'http://localhost',
		};

export const jwtSecret: string = safeEnv.JWT_SECRET;
export const expireKeepAliveConected: string = safeEnv.EXPIRES_IN;
export const expireKeepAliveConectedRefreshToken: string =
	safeEnv.EXPIRES_IN_REFRESH_TOKEN;
export const urlProduction: string = safeEnv.URL_PRODUCTION;
export const urlDevelopment: string = safeEnv.URL_DEVELOPMENT;
export const twelveDataApiKey: string = safeEnv.TWELVE_DATA_API_KEY;
export const brapiApiKey: string = safeEnv.BRAPI_DATA_API_KEY;
export const stripePrivateApiKey: string = safeEnv.STRIPE_PRIVATE_API_KEY;
export const stripePublicApiKey: string = safeEnv.STRIPE_PUBLIC_API_KEY;
export const stripeWebhookSecret: string = safeEnv.STRIPE_WEBHOOK_SECRET;
export const stripeWebhookSecretProduction: string =
	safeEnv.STRIPE_WEBHOOK_SECRET_PROD;
export const port: string = safeEnv.PORT;
export const asaasApiKey: string = safeEnv.ASAAS_API_KEY;
export const asaasUrlSandbox: string = safeEnv.ASAAS_URL_SANDBOX;
