import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { AuditAdminController } from './admin/audit-admin.controller';
import { AuditSealerService } from './application/audit-sealer.service';
import { AUDIT_TRAIL } from './application/audit-trail.port';
import { AuditTrailService } from './application/audit-trail.service';
import { AuditVerifyService } from './application/audit-verify.service';
import { AUDIT_CLOCK, AUDIT_INSTANCE_ID } from './application/audit.tokens';
import { AUDIT_EVENT_STORE } from './application/ports/audit-event-store.port';
import {
	AuditChainModel,
	AuditEventModel,
} from './infrastructure/audit.models';
import { MongoAuditEventStore } from './infrastructure/mongo-audit-event.store';

/**
 * Trilha de auditoria encadeada (ADR-004, seção 9.3; ADR-005, fase A4).
 *
 * Global de propósito, como o barramento de eventos: quem produz evento
 * injeta `AUDIT_TRAIL` sem que exista um grafo de imports até aqui.
 *
 * Fica de fora desta fase: árvore de Merkle por hora e âncora externa (F5).
 */
@Global()
@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'AuditEvent', schema: AuditEventModel.schema },
			{ name: 'AuditChain', schema: AuditChainModel.schema },
		]),
	],
	controllers: [AuditAdminController],
	providers: [
		{ provide: AUDIT_CLOCK, useValue: () => new Date() },
		// Identifica esta instância na concessão do selador.
		{ provide: AUDIT_INSTANCE_ID, useFactory: () => `seal_${randomUUID()}` },
		MongoAuditEventStore,
		{ provide: AUDIT_EVENT_STORE, useExisting: MongoAuditEventStore },
		AuditTrailService,
		{ provide: AUDIT_TRAIL, useExisting: AuditTrailService },
		AuditSealerService,
		AuditVerifyService,
	],
	exports: [AUDIT_TRAIL],
})
export class AuditModule {}
