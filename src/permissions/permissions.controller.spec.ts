import { Test, TestingModule } from '@nestjs/testing';
import { PermissionsController } from './permissions.controller';
import { PermissionsService } from './permissions.service';
import { PermissionModel } from './schema/permissions.model';

describe('PermissionsController', () => {
	let controller: PermissionsController;

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [PermissionsController],
			providers: [PermissionsService],
		}).compile();

		controller = module.get<PermissionsController>(PermissionsController);
	});

	it('should be get permissions', () => {
		const response = PermissionModel.find().exec();
		expect(controller).toBe(response);
	});
});
