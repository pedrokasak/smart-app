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
const ADVISOR_ERASURE = { revoked: 1, consents: 2, invites: 1, profiles: 1 };

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
		const advisor = {
			eraseUser: jest.fn().mockResolvedValue(ADVISOR_ERASURE),
		};
		const service = new AccountErasureService(
			{ models } as any,
			{ cancelUserSubscription: cancel } as any,
			advisor as any
		);
		return { service, cancel, advisor };
	}

	it('apaga cada coleção pelo campo de dono certo', async () => {
		const models = fakeModels(allNames);
		const { service } = build(models);

		const report = await service.eraseDependents(userId, undefined);

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

			const report = await service.eraseDependents(userId, undefined);

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

			await service.eraseDependents(userId, undefined);

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

			await service.eraseDependents(userId, undefined);

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

			const report = await service.eraseDependents(userId, undefined);

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

			await service.eraseDependents(userId, undefined);

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

			await service.eraseDependents(userId, undefined);

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

		const report = await service.eraseDependents(userId, undefined);

		expect(cancel).toHaveBeenCalledWith(userId, true);
		expect(report.subscription).toBe('cancel_scheduled');
	});

	it('sem assinatura ativa, segue a exclusão', async () => {
		const models = fakeModels(allNames);
		const { service } = build(
			models,
			jest.fn().mockRejectedValue(new NotFoundException())
		);

		const report = await service.eraseDependents(userId, undefined);

		expect(report.subscription).toBe('none');
		expect(models.Profile.deleteMany).toHaveBeenCalled();
	});

	it('falha no Stripe recusa a exclusão sem apagar nem anonimizar nada', async () => {
		const models = fakeModels(allNames);
		const { service } = build(
			models,
			jest.fn().mockRejectedValue(new InternalServerErrorException('stripe'))
		);

		await expect(service.eraseDependents(userId, undefined)).rejects.toThrow(
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

		await expect(service.eraseDependents(userId, undefined)).rejects.toThrow(
			'mongo caiu'
		);
		expect(models.Portfolio.deleteMany).not.toHaveBeenCalled();

		await expect(
			service.eraseDependents(userId, undefined)
		).resolves.toMatchObject({
			skipped: [],
		});
		expect(models.Portfolio.deleteMany).toHaveBeenCalledTimes(1);
	});

	it('registra como ignorada a coleção sem model, em vez de falhar', async () => {
		const models = fakeModels(allNames.filter((n) => n !== 'PixCharge'));
		const { service } = build(models);

		const report = await service.eraseDependents(userId, undefined);

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
			await service.eraseDependents(userId, undefined);
			expect(staticModel.deleteMany).toHaveBeenCalledWith({ userId });
		} finally {
			if (original) (mongoose.models as any).BrokerConnection = original;
			else delete (mongoose.models as any).BrokerConnection;
		}
	});

	describe('vínculos com assessores (Trackerr Advisor)', () => {
		const email = 'joao@exemplo.com';

		it('encerra os acessos e apaga os dados do advisor antes de qualquer outra remoção', async () => {
			const models = fakeModels(allNames);
			const { service, advisor } = build(models);

			const report = await service.eraseDependents(userId, email);

			expect(advisor.eraseUser).toHaveBeenCalledWith(userId, email);
			const advisorOrder = advisor.eraseUser.mock.invocationCallOrder[0];
			for (const name of allNames) {
				for (const call of [
					...models[name].deleteMany.mock.invocationCallOrder,
					...models[name].updateMany.mock.invocationCallOrder,
				]) {
					expect(advisorOrder).toBeLessThan(call);
				}
			}
			expect(report.advisor).toEqual(ADVISOR_ERASURE);
		});

		it('falha ao encerrar um acesso recusa a exclusão sem apagar nada', async () => {
			const models = fakeModels(allNames);
			const { service, advisor } = build(models);
			advisor.eraseUser.mockRejectedValue(new Error('store down'));

			await expect(service.eraseDependents(userId, email)).rejects.toThrow(
				'store down'
			);
			for (const name of allNames) {
				expect(models[name].deleteMany).not.toHaveBeenCalled();
				expect(models[name].updateMany).not.toHaveBeenCalled();
			}
		});

		it('sem e-mail conhecido, ainda encerra os acessos pelo id', async () => {
			const models = fakeModels(allNames);
			const { service, advisor } = build(models);

			await service.eraseDependents(userId, undefined);

			expect(advisor.eraseUser).toHaveBeenCalledWith(userId, undefined);
		});

		it('falha no Stripe não encerra acesso nenhum', async () => {
			const models = fakeModels(allNames);
			const { service, advisor } = build(
				models,
				jest.fn().mockRejectedValue(new InternalServerErrorException('stripe'))
			);

			await expect(service.eraseDependents(userId, email)).rejects.toThrow(
				ServiceUnavailableException
			);
			expect(advisor.eraseUser).not.toHaveBeenCalled();
		});
	});
});
