import * as pulumi from '@pulumi/pulumi';
import * as awsx from '@pulumi/awsx';
import * as aws from '@pulumi/aws';
import * as docker from '@pulumi/docker-build';

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
	desiredCount: 1,
	waitForSteadyState: false,
	taskDefinitionArgs: {
		container: {
			image: serverDockerImage.ref,
			cpu: 256,
			memory: 512,
		},
	},
});
