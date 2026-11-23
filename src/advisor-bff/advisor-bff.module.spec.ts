import { AdvisorModule } from 'src/advisor/advisor.module';
import { AppModule } from 'src/app.module';
import { AdvisorBffModule } from './advisor-bff.module';
import { AlertSettingsController } from './alert-settings.controller';
import { AlertsController } from './alerts.controller';
import { ClientsController } from './clients.controller';
import { DashboardController } from './dashboard.controller';
import { InvitesController } from './invites.controller';
import { OrganizationsController } from './organizations.controller';

describe('AdvisorBffModule wiring', () => {
	it('is imported by AppModule', () => {
		const imports: unknown[] = Reflect.getMetadata('imports', AppModule);
		expect(imports).toContain(AdvisorBffModule);
	});

	it('imports AdvisorModule and registers the organizations, clients and invites controllers', () => {
		const imports: unknown[] = Reflect.getMetadata('imports', AdvisorBffModule);
		const controllers: unknown[] = Reflect.getMetadata(
			'controllers',
			AdvisorBffModule
		);
		expect(imports).toContain(AdvisorModule);
		expect(controllers).toContain(OrganizationsController);
		expect(controllers).toContain(ClientsController);
		expect(controllers).toContain(InvitesController);
	});

	it('registers the dashboard, alerts and alert settings controllers', () => {
		const controllers: unknown[] = Reflect.getMetadata(
			'controllers',
			AdvisorBffModule
		);
		expect(controllers).toEqual(
			expect.arrayContaining([
				DashboardController,
				AlertsController,
				AlertSettingsController,
			])
		);
	});

	it('is not imported back by AdvisorModule (no cycle)', () => {
		const imports: unknown[] = Reflect.getMetadata('imports', AdvisorModule);
		expect(imports).not.toContain(AdvisorBffModule);
	});
});
