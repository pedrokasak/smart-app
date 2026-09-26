import {
	InternalServerErrorException,
	NotFoundException,
	ServiceUnavailableException,
} from '@nestjs/common';
import mongoose from 'mongoose';
import {
	AccountErasureService,
	ERASABLE_COLLECTIONS,
} from './account-erasure.service';

function fakeModels(names: string[]) {
	const models: Record<string, { deleteMany: jest.Mock }> = {};
	for (const name of names) {
		models[name] = {
			deleteMany: jest.fn().mockResolvedValue({ deletedCount: 2 }),
		};
	}
	return models;
}

describe('AccountErasureService (TRA-213)', () => {
	const userId = '507f1f77bcf86cd799439011';
	const allNames = ERASABLE_COLLECTIONS.map((c) => c.model);

	function build(
		models: Record<string, any>,
		cancel: jest.Mock = jest.fn().mockResolvedValue({})
	) {
		const service = new AccountErasureService(
			{ models } as any,
			{ cancelUserSubscription: cancel } as any
		);
		return { service, cancel };
	}

	it('apaga cada coleção pelo campo de dono certo', async () => {
		const models = fakeModels(allNames);
		const { service } = build(models);

		const report = await service.eraseDependents(userId);

		for (const { model, ownerField } of ERASABLE_COLLECTIONS) {
			expect(models[model].deleteMany).toHaveBeenCalledWith({
				[ownerField]: userId,
			});
		}
		expect(report.deleted.BrokerConnection).toBe(2);
		expect(report.skipped).toEqual([]);
	});

	it('inclui credenciais de corretora e dado pessoal na lista', () => {
		expect(allNames).toEqual(
			expect.arrayContaining([
				'BrokerConnection',
				'Profile',
				'Address',
				'ChatMessage',
				'PushSubscription',
			])
		);
	});

	it('não apaga registro fiscal (decisão do TRA-127)', () => {
		for (const fiscal of [
			'Trade',
			'Portfolio',
			'PortfolioHistory',
			'Asset',
			'PixCharge',
			'UserSubscription',
		]) {
			expect(allNames).not.toContain(fiscal);
		}
	});

	it('agenda o fim da assinatura sem renovação antes de apagar', async () => {
		const models = fakeModels(allNames);
		const { service, cancel } = build(models);

		const report = await service.eraseDependents(userId);

		expect(cancel).toHaveBeenCalledWith(userId, true);
		expect(report.subscription).toBe('cancel_scheduled');
	});

	it('sem assinatura ativa, segue a exclusão', async () => {
		const models = fakeModels(allNames);
		const { service } = build(
			models,
			jest.fn().mockRejectedValue(new NotFoundException())
		);

		const report = await service.eraseDependents(userId);

		expect(report.subscription).toBe('none');
		expect(models.Profile.deleteMany).toHaveBeenCalled();
	});

	it('falha no Stripe recusa a exclusão sem apagar nada', async () => {
		const models = fakeModels(allNames);
		const { service } = build(
			models,
			jest.fn().mockRejectedValue(new InternalServerErrorException('stripe'))
		);

		await expect(service.eraseDependents(userId)).rejects.toThrow(
			ServiceUnavailableException
		);
		for (const name of allNames) {
			expect(models[name].deleteMany).not.toHaveBeenCalled();
		}
	});

	it('usa o model estático quando o Nest não registrou o nome', async () => {
		const models = fakeModels(allNames.filter((n) => n !== 'BrokerConnection'));
		const staticModel = {
			deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
		};
		const original = mongoose.models.BrokerConnection;
		(mongoose.models as any).BrokerConnection = staticModel;
		try {
			const { service } = build(models);
			await service.eraseDependents(userId);
			expect(staticModel.deleteMany).toHaveBeenCalledWith({ userId });
		} finally {
			if (original) (mongoose.models as any).BrokerConnection = original;
			else delete (mongoose.models as any).BrokerConnection;
		}
	});
});
