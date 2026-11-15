import { AppModule } from 'src/app.module';
import { AdvisorModule } from './advisor.module';
import {
	ADVISOR_CLIENT_PROFILE_STORE,
	ADVISOR_MEMBERSHIP_STORE,
	ADVISOR_ORG_STORE,
	ADVISOR_RELATIONSHIP_STORE,
} from './application/advisor.tokens';

/**
 * Sem subir um segundo grafo: `app.module.di.spec.ts` ja resolve o AppModule
 * inteiro (incluindo este modulo). Aqui so se trava a ligacao estatica.
 */
describe('AdvisorModule wiring', () => {
	it('is imported by AppModule', () => {
		const imports: unknown[] = Reflect.getMetadata('imports', AppModule);
		expect(imports).toContain(AdvisorModule);
	});

	it('provides the four store tokens', () => {
		const providers: Array<{ provide?: unknown }> = Reflect.getMetadata(
			'providers',
			AdvisorModule
		);
		const provided = providers.map((p) => p.provide);
		for (const token of [
			ADVISOR_ORG_STORE,
			ADVISOR_MEMBERSHIP_STORE,
			ADVISOR_RELATIONSHIP_STORE,
			ADVISOR_CLIENT_PROFILE_STORE,
		]) {
			expect(provided).toContain(token);
		}
	});
});
