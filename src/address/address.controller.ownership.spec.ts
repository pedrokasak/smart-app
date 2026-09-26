import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { AddressController } from './address.controller';
import { AddressService } from './address.service';
import { Role } from 'src/auth/enums/role.enum';

const ALICE = new Types.ObjectId().toString();
const BOB = new Types.ObjectId().toString();
const as = (userId: string, role?: Role) => ({ user: { userId, role } });

function buildController(addresses: Array<{ _id: string; userId: string }>) {
	const model = {
		findById: jest.fn((id: string) => ({
			exec: async () => addresses.find((a) => a._id === id) ?? null,
		})),
	};
	const service = new AddressService(model as any, {} as any);
	jest.spyOn(service, 'findByUserId').mockResolvedValue([] as any);
	jest.spyOn(service, 'findByUserIdAndType').mockResolvedValue({} as any);
	jest.spyOn(service, 'create').mockImplementation(async (dto) => dto as any);
	jest
		.spyOn(service, 'update')
		.mockImplementation(async (_id, dto) => dto as any);
	jest.spyOn(service, 'remove').mockResolvedValue({} as any);
	return { controller: new AddressController(service), service };
}

describe('AddressController — posse (TRA-211)', () => {
	const bobAddress = { _id: new Types.ObjectId().toString(), userId: BOB };

	it('GET /addresses lista só os endereços de quem está logado', async () => {
		const { controller, service } = buildController([]);

		await controller.findAll(as(ALICE));

		expect(service.findByUserId).toHaveBeenCalledWith(ALICE);
	});

	it('não lê endereços de outro usuário pela rota user/:userId', async () => {
		const { controller } = buildController([]);

		await expect(controller.findByUserId(BOB, as(ALICE))).rejects.toThrow(
			ForbiddenException
		);
		await expect(
			controller.findByUserIdAndType(BOB, 'home' as any, as(ALICE))
		).rejects.toThrow(ForbiddenException);
	});

	it('admin pode consultar endereços de outro usuário', async () => {
		const { controller, service } = buildController([]);

		await controller.findByUserId(BOB, as(ALICE, Role.Admin));

		expect(service.findByUserId).toHaveBeenCalledWith(BOB);
	});

	it.each(['findOne', 'update', 'remove'] as const)(
		'%s em endereço de outro usuário responde 404 sem alterar nada',
		async (method) => {
			const { controller, service } = buildController([bobAddress]);
			const call =
				method === 'update'
					? controller.update(bobAddress._id, { street: 'x' } as any, as(ALICE))
					: controller[method](bobAddress._id, as(ALICE));

			await expect(call).rejects.toThrow(NotFoundException);
			expect(service.update).not.toHaveBeenCalled();
			expect(service.remove).not.toHaveBeenCalled();
		}
	);

	it('dono consegue alterar e o userId do corpo é descartado', async () => {
		const { controller, service } = buildController([bobAddress]);

		await controller.update(
			bobAddress._id,
			{ street: 'Rua Nova', userId: ALICE } as any,
			as(BOB)
		);

		expect(service.update).toHaveBeenCalledWith(bobAddress._id, {
			street: 'Rua Nova',
		});
	});

	it('POST ignora o userId do corpo para quem não é admin', async () => {
		const { controller, service } = buildController([]);

		await controller.create({ userId: BOB, street: 'x' } as any, as(ALICE));

		expect(service.create).toHaveBeenCalledWith(
			expect.objectContaining({ userId: ALICE })
		);
	});

	it('requisição sem usuário é negada', async () => {
		const { controller } = buildController([]);

		await expect(controller.findAll({})).rejects.toThrow(ForbiddenException);
	});
});
