import { Module } from '@nestjs/common';
import { AdvisorModule } from 'src/advisor/advisor.module';
import { AdvisorBffExceptionFilter } from './advisor-bff-exception.filter';
import { AdvisorPortalGuard } from './advisor-portal.guard';
import { OrganizationsController } from './organizations.controller';

/**
 * BFF do portal do assessor (`/advisor/v1`). Só traduz HTTP: toda regra vem
 * dos serviços exportados por `AdvisorModule`, que nunca importa este módulo.
 */
@Module({
	imports: [AdvisorModule],
	controllers: [OrganizationsController],
	providers: [AdvisorPortalGuard, AdvisorBffExceptionFilter],
})
export class AdvisorBffModule {}
