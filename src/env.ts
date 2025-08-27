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
});

// Parse the environment variables
const env = envSchema.safeParse(process.env);
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
