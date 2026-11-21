import { AdvisorModule } from 'src/advisor/advisor.module';
import { AppModule } from 'src/app.module';
import { AdvisorBffModule } from './advisor-bff.module';
import { OrganizationsController } from './organizations.controller';

describe('AdvisorBffModule wiring', () => {
	it('is imported by AppModule', () => {
		const imports: unknown[] = Reflect.getMetadata('imports', AppModule);
		expect(imports).toContain(AdvisorBffModule);
	});

	it('imports AdvisorModule and registers the organizations controller', () => {
		const imports: unknown[] = Reflect.getMetadata('imports', AdvisorBffModule);
		const controllers: unknown[] = Reflect.getMetadata(
			'controllers',
			AdvisorBffModule
		);
		expect(imports).toContain(AdvisorModule);
		expect(controllers).toContain(OrganizationsController);
	});

	it('is not imported back by AdvisorModule (no cycle)', () => {
		const imports: unknown[] = Reflect.getMetadata('imports', AdvisorModule);
		expect(imports).not.toContain(AdvisorBffModule);
	});
});
