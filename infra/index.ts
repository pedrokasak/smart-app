import * as pulumi from '@pulumi/pulumi';
import * as awsx from '@pulumi/awsx';
import * as aws from '@pulumi/aws';
import * as docker from '@pulumi/docker-build';

const config = new pulumi.Config();
const databaseUrl = config.requireSecret('databaseUrl');
const mongoInitdbRootUsername = config.requireSecret(
	'MONGO_INITDB_ROOT_USERNAME'
);
const mongoInitdbRootPassword = config.requireSecret(
	'MONGO_INITDB_ROOT_PASSWORD'
);
const jwtSecret = config.requireSecret('JWT_SECRET');
const expiresIn = config.requireSecret('EXPIRES_IN');
const expiresInRefreshToken = config.requireSecret('EXPIRES_IN_REFRESH_TOKEN');
const urlProduction = config.requireSecret('URL_PRODUCTION');
const urlDevelopment = config.requireSecret('URL_DEVELOPMENT');
const twelveDataApiKey = config.requireSecret('TWELVE_DATA_API_KEY');
const brapiDataApiKey = config.requireSecret('BRAPI_DATA_API_KEY');
const stripePrivateApiKey = config.requireSecret('STRIPE_PRIVATE_API_KEY');
const stripePublicApiKey = config.requireSecret('STRIPE_PUBLIC_API_KEY');
const stripeWebhookSecret = config.requireSecret('STRIPE_WEBHOOK_SECRET');
const stripeWebhookSecretProd = config.requireSecret(
	'STRIPE_WEBHOOK_SECRET_PROD'
);
const asaasApiKey = config.requireSecret('ASAAS_API_KEY');
const asaasUrlSandbox = config.requireSecret('ASAAS_URL_SANDBOX');

const serverECRRepository = new awsx.ecr.Repository('trakker-server-ecr', {
	forceDelete: true,
});

const ecrTokenServer = aws.ecr.getAuthorizationTokenOutput({
	registryId: serverECRRepository.repository.registryId,
});

export const serverDockerImage = new docker.Image('trakker-server-image', {
	tags: [
		pulumi.interpolate`${serverECRRepository.repository.repositoryUrl}:latest`,
	],
	context: {
		location: '../',
	},
	push: true,
	platforms: ['linux/amd64'],
	registries: [
		{
			address: serverECRRepository.repository.repositoryUrl,
			username: ecrTokenServer.userName,
			password: ecrTokenServer.password,
		},
	],
});

const cluster = new awsx.classic.ecs.Cluster('trakker-cluster');

new awsx.classic.ecs.FargateService('trakker-service', {
	cluster,
	desiredCount: 0,
	waitForSteadyState: false,
	taskDefinitionArgs: {
		container: {
			image: serverDockerImage.ref,
			cpu: 256,
			memory: 512,
			essential: true,
			environment: [
				{ name: 'DATABASE_URL', value: databaseUrl },
				{ name: 'MONGO_INITDB_ROOT_USERNAME', value: mongoInitdbRootUsername },
				{ name: 'MONGO_INITDB_ROOT_PASSWORD', value: mongoInitdbRootPassword },
				{ name: 'JWT_SECRET', value: jwtSecret },
				{ name: 'EXPIRES_IN', value: expiresIn },
				{ name: 'EXPIRES_IN_REFRESH_TOKEN', value: expiresInRefreshToken },
				{ name: 'URL_PRODUCTION', value: urlProduction },
				{ name: 'URL_DEVELOPMENT', value: urlDevelopment },
				{ name: 'TWELVE_DATA_API_KEY', value: twelveDataApiKey },
				{ name: 'BRAPI_DATA_API_KEY', value: brapiDataApiKey },
				{ name: 'STRIPE_PRIVATE_API_KEY', value: stripePrivateApiKey },
				{ name: 'STRIPE_PUBLIC_API_KEY', value: stripePublicApiKey },
				{ name: 'STRIPE_WEBHOOK_SECRET', value: stripeWebhookSecret },
				{ name: 'STRIPE_WEBHOOK_SECRET_PROD', value: stripeWebhookSecretProd },
				{ name: 'ASAAS_API_KEY', value: asaasApiKey },
				{ name: 'ASAAS_URL_SANDBOX', value: asaasUrlSandbox },
			],
			portMappings: [{ containerPort: 3000, hostPort: 3000, protocol: 'tcp' }],
		},
	},
});
