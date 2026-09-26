import { Connection } from 'mongoose';
import { IndexMaintenanceService } from './index-maintenance.service';

function fakeConnection(models: Record<string, () => Promise<void>>) {
	const calls: string[] = [];
	const connection = {
		modelNames: () => Object.keys(models),
		model: (name: string) => ({
			collection: { collectionName: name.toLowerCase() },
			createIndexes: async () => {
				calls.push(`start:${name}`);
				await models[name]();
				calls.push(`end:${name}`);
			},
		}),
	} as unknown as Connection;
	return { connection, calls };
}

const emptyConnection = {
	modelNames: () => [],
	model: () => undefined,
} as unknown as Connection;

describe('IndexMaintenanceService', () => {
	const originalEnv = { ...process.env };

	afterEach(() => {
		process.env = { ...originalEnv };
		jest.useRealTimers();
	});

	it('cria os índices um model por vez, nunca em paralelo', async () => {
		const { connection, calls } = fakeConnection({
			User: () => new Promise((r) => setTimeout(r, 5)),
			PixCharge: async () => undefined,
		});

		const result = await new IndexMaintenanceService(
			connection
		).ensureIndexes();

		expect(calls).toEqual([
			'start:User',
			'end:User',
			'start:PixCharge',
			'end:PixCharge',
		]);
		expect(result).toEqual({ built: ['User', 'PixCharge'], failed: [] });
	});

	it('falha em um model não impede os seguintes', async () => {
		const { connection } = fakeConnection({
			User: async () => {
				throw new Error('duplicate key');
			},
			PixCharge: async () => undefined,
		});

		const result = await new IndexMaintenanceService(
			connection
		).ensureIndexes();

		expect(result).toEqual({ built: ['PixCharge'], failed: ['User'] });
	});

	it('em produção agenda a criação para depois do boot', () => {
		jest.useFakeTimers();
		process.env.NODE_ENV = 'production';
		delete process.env.MONGO_AUTO_INDEX;
		process.env.MONGO_INDEX_BUILD_DELAY_MS = '1000';
		const { connection } = fakeConnection({});
		const service = new IndexMaintenanceService(connection, emptyConnection);
		const ensure = jest.spyOn(service, 'ensureIndexes').mockResolvedValue({
			built: [],
			failed: [],
		});

		service.onApplicationBootstrap();
		expect(ensure).not.toHaveBeenCalled();

		jest.advanceTimersByTime(1000);
		expect(ensure).toHaveBeenCalledTimes(1);
	});

	it('com autoIndex ligado não agenda nada', () => {
		jest.useFakeTimers();
		process.env.NODE_ENV = 'development';
		delete process.env.MONGO_AUTO_INDEX;
		const { connection } = fakeConnection({});
		const service = new IndexMaintenanceService(connection, emptyConnection);
		const ensure = jest.spyOn(service, 'ensureIndexes');

		service.onApplicationBootstrap();
		jest.runAllTimers();

		expect(ensure).not.toHaveBeenCalled();
	});

	it('cobre também os models estáticos da conexão global, sem repetir coleção', async () => {
		const nest = fakeConnection({ User: async () => undefined });
		const global = fakeConnection({
			User: async () => undefined,
			BrokerConnection: async () => undefined,
		});

		const result = await new IndexMaintenanceService(
			nest.connection,
			global.connection
		).ensureIndexes();

		expect(result.built).toEqual(['User', 'BrokerConnection']);
		expect(global.calls).toEqual([
			'start:BrokerConnection',
			'end:BrokerConnection',
		]);
	});
});
