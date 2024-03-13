import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './database/prisma.service';

describe('AppController', () => {
	let appController: AppController;
	const prisma = new PrismaService();

	beforeEach(async () => {
		const app: TestingModule = await Test.createTestingModule({
			controllers: [AppController],
			providers: [AppService],
		}).compile();

		appController = app.get<AppController>(AppController);
	});

	describe('root', () => {
		const response = prisma.signIn.findMany();
		it('should return login', () => {
			expect(appController.getUser()).toBe(response);
		});
	});
});
