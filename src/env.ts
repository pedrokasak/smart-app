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
