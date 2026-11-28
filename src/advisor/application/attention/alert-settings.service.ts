import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AUDIT_TRAIL } from 'src/audit/application/audit-trail.port';
import type { AuditTrail } from 'src/audit/application/audit-trail.port';
import { actorRefOf } from 'src/audit/infrastructure/actor-ref';
import {
	AlertSettings,
	DEFAULT_ALERT_SETTINGS,
	validateAlertSettings,
} from '../../domain/alert-settings';
import { ADVISOR_ALERT_SETTINGS_STORE } from '../advisor.tokens';
import { AuthorizationService } from '../authorization.service';
import type { AccessContext } from '../authorization.service';
import type { AlertSettingsStorePort } from '../ports/alert-settings.store.port';
import { InvalidAlertSettingsError } from './attention-errors';

export const ALERT_SETTINGS_UPDATED_EVENT = 'advisor.alert_settings.updated';

export interface AlertSettingsView {
	settings: AlertSettings;
	/** `null` enquanto o motor não rodou nem houve `PUT` na organização. */
	engineEnabledAt: Date | null;
}

const copyDefaults = (): AlertSettings =>
	JSON.parse(JSON.stringify(DEFAULT_ALERT_SETTINGS)) as AlertSettings;

/** Limites das regras por organização (B5, B8). */
@Injectable()
export class AlertSettingsService {
	constructor(
		private readonly authz: AuthorizationService,
		@Inject(ADVISOR_ALERT_SETTINGS_STORE)
		private readonly store: AlertSettingsStorePort,
		@Inject(AUDIT_TRAIL) private readonly audit: AuditTrail
	) {}

	/** Qualquer membro; os padrões quando nada foi gravado. */
	async get(ctx: AccessContext): Promise<AlertSettingsView> {
		await this.authz.ensureOrgMember(ctx);
		const stored = await this.store.find(ctx.orgId);
		if (!stored) return { settings: copyDefaults(), engineEnabledAt: null };
		return {
			settings: stored.settings,
			engineEnabledAt: stored.engineEnabledAt,
		};
	}

	/**
	 * Só ORG_ADMIN. Grava o conjunto inteiro (campo omitido volta ao padrão).
	 * Audita antes de gravar: se a auditoria falha, nada muda.
	 */
	async put(
		ctx: AccessContext,
		input: Partial<AlertSettings>
	): Promise<AlertSettingsView> {
		await this.authz.ensureOrgAdmin(ctx);
		const checked = validateAlertSettings(input);
		if (checked.ok === false) {
			throw new InvalidAlertSettingsError(checked.field);
		}
		await this.audit.record({
			eventId: randomUUID(),
			type: ALERT_SETTINGS_UPDATED_EVENT,
			version: 1,
			subject: ctx.orgId,
			actorRef: actorRefOf(ctx.userId),
			occurredAt: new Date(),
			payload: { orgId: ctx.orgId },
		});
		const saved = await this.store.upsertSettings(
			ctx.orgId,
			checked.value,
			ctx.userId
		);
		return { settings: saved.settings, engineEnabledAt: saved.engineEnabledAt };
	}
}
