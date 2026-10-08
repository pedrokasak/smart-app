import {
	InternalServerErrorException,
	NotFoundException,
	ServiceUnavailableException,
} from '@nestjs/common';
import mongoose from 'mongoose';
import {
	ANONYMIZED_EMAIL,
	ERASABLE_COLLECTIONS,
	ERASED_USER_ID,
	PORTFOLIO_OWNED_COLLECTION,
	RETAINED_COLLECTIONS,
} from './account-erasure.policy';
import { AccountErasureService } from './account-erasure.service';

type FakeModel = {
	deleteMany: jest.Mock;
	updateMany: jest.Mock;
	distinct: jest.Mock;
};

const PORTFOLIO_IDS = ['p-1', 'p-2'];

function fakeModels(names: string[]) {
	const models: Record<string, FakeModel> = {};
	for (const name of names) {
		models[name] = {
			deleteMany: jest.fn().mockResolvedValue({ deletedCount: 2 }),
			updateMany: jest.fn().mockResolvedValue({ modifiedCount: 3 }),
			distinct: jest.fn().mockResolvedValue(PORTFOLIO_IDS),
		};
	}
	return models;
}

describe('AccountErasureService (TRA-213, TRA-127)', () => {
	const userId = '507f1f77bcf86cd799439011';
	const erasable = ERASABLE_COLLECTIONS.map((c) => c.model);
	const retained = RETAINED_COLLECTIONS.map((c) => c.model);
	const allNames = [...erasable, ...retained, PORTFOLIO_OWNED_COLLECTION.model];

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
		expect(erasable).toEqual(
			expect.arrayContaining([
				'BrokerConnection',
				'Profile',
				'Address',
				'ChatMessage',
				'PushSubscription',
			])
		);
	});

	describe('dado do titular sem obrigação de guarda (TRA-127)', () => {
		it('apaga carteira, trades, histórico e dividendos', () => {
			expect(erasable).toEqual(
				expect.arrayContaining([
					'Portfolio',
					'Trade',
					'PortfolioHistory',
					'UpcomingDividend',
				])
			);
		});

		it('apaga os ativos pelas carteiras do usuário, que não têm dono próprio', async () => {
			const models = fakeModels(allNames);
			const { service } = build(models);

			const report = await service.eraseDependents(userId);

			expect(models.Portfolio.distinct).toHaveBeenCalledWith('_id', {
				userId,
			});
			expect(models.Asset.deleteMany).toHaveBeenCalledWith({
				portfolioId: { $in: PORTFOLIO_IDS },
			});
			expect(report.deleted.Asset).toBe(2);
		});

		it('apaga os ativos antes das carteiras, para uma repetição achar os ids', async () => {
			const models = fakeModels(allNames);
			const { service } = build(models);

			await service.eraseDependents(userId);

			const assetsOrder = models.Asset.deleteMany.mock.invocationCallOrder[0];
			const portfolioOrder =
				models.Portfolio.deleteMany.mock.invocationCallOrder[0];
			expect(assetsOrder).toBeLessThan(portfolioOrder);
			expect(erasable[erasable.length - 1]).toBe('Portfolio');
		});

		it('usuário sem carteira não apaga ativo de ninguém', async () => {
			const models = fakeModels(allNames);
			models.Portfolio.distinct.mockResolvedValue([]);
			const { service } = build(models);

			await service.eraseDependents(userId);

			expect(models.Asset.deleteMany).toHaveBeenCalledWith({
				portfolioId: { $in: [] },
			});
		});
	});

	describe('registro que o Trackerr precisa guardar (TRA-127)', () => {
		it('cobrança, assinatura e auditoria não são apagadas', () => {
			for (const kept of retained) {
				expect(erasable).not.toContain(kept);
			}
			expect(retained).toEqual(
				expect.arrayContaining([
					'UserSubscription',
					'PixCharge',
					'ManualGrantAudit',
					'RoleChangeAudit',
				])
			);
		});

		it('desliga o registro do usuário trocando o dono pelo id reservado', async () => {
			const models = fakeModels(allNames);
			const { service } = build(models);

			const report = await service.eraseDependents(userId);

			for (const { model, ownerField } of RETAINED_COLLECTIONS) {
				expect(models[model].deleteMany).not.toHaveBeenCalled();
				expect(models[model].updateMany).toHaveBeenCalledWith(
					{ [ownerField]: userId },
					expect.objectContaining({
						$set: expect.objectContaining({ [ownerField]: ERASED_USER_ID }),
					})
				);
			}
			expect(report.anonymized.PixCharge).toBe(3);
		});

		it('remove a ligação com os clientes no Stripe e no Asaas e o QR do PIX', async () => {
			const models = fakeModels(allNames);
			const { service } = build(models);

			await service.eraseDependents(userId);

			expect(
				models.UserSubscription.updateMany.mock.calls[0][1].$unset
			).toEqual({ stripeCustomerId: '' });
			expect(models.PixCharge.updateMany.mock.calls[0][1].$unset).toEqual({
				asaasCustomerId: '',
				qrCodePayload: '',
				qrCodeImage: '',
			});
		});

		it('troca o e-mail das trilhas de auditoria, sem tocar em quem executou', async () => {
			const models = fakeModels(allNames);
			const { service } = build(models);

			await service.eraseDependents(userId);

			for (const model of ['ManualGrantAudit', 'RoleChangeAudit']) {
				const update = models[model].updateMany.mock.calls[0][1];
				expect(update.$set.userEmail).toBe(ANONYMIZED_EMAIL);
				expect(update.$set).not.toHaveProperty('performedByEmail');
				expect(update.$set).not.toHaveProperty('performedBy');
			}
		});

		it('o id reservado não é um usuário real', () => {
			expect(ERASED_USER_ID.toHexString()).toBe('0'.repeat(24));
		});
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

	it('falha no Stripe recusa a exclusão sem apagar nem anonimizar nada', async () => {
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
			expect(models[name].updateMany).not.toHaveBeenCalled();
		}
	});

	it('repetir a exclusão depois de uma falha no meio é seguro', async () => {
		const models = fakeModels(allNames);
		models.Trade.deleteMany.mockRejectedValueOnce(new Error('mongo caiu'));
		const { service } = build(models);

		await expect(service.eraseDependents(userId)).rejects.toThrow('mongo caiu');
		expect(models.Portfolio.deleteMany).not.toHaveBeenCalled();

		await expect(service.eraseDependents(userId)).resolves.toMatchObject({
			skipped: [],
		});
		expect(models.Portfolio.deleteMany).toHaveBeenCalledTimes(1);
	});

	it('registra como ignorada a coleção sem model, em vez de falhar', async () => {
		const models = fakeModels(allNames.filter((n) => n !== 'PixCharge'));
		const { service } = build(models);

		const report = await service.eraseDependents(userId);

		expect(report.skipped).toEqual(['PixCharge']);
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
