import z from 'zod';

const envSchema = z.object({
	DATABASE_URL: z.string().url(),
	JWT_SECRET: z.string(),
	EXPIRES_IN: z.string(),
	EXPIRES_IN_REFRESH_TOKEN: z.string(),
});

// Parse the environment variables
const env = envSchema.safeParse(process.env);
if (!env.success) {
	console.error('Invalid environment variables:', env.error.format());
	process.exit(1);
}

export const jwtSecret: string = env.data.JWT_SECRET;
export const expireKeepAliveConected: string = env.data.EXPIRES_IN;
