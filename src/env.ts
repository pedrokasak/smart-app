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
