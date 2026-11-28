import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import mongoose from 'mongoose';
import {
	ADVISOR_ALERT_MODEL,
	ADVISOR_CLIENT_CONTACT_MODEL,
	ADVISOR_CLIENT_SNAPSHOT_MODEL,
	ADVISOR_WEALTH_DAILY_MODEL,
} from 'src/advisor/infrastructure/advisor-attention.models';
import {
	ADVISOR_CLIENT_INVITE_MODEL,
	ADVISOR_CONSENT_MODEL,
} from 'src/advisor/infrastructure/advisor-consent.models';
import { ADVISOR_PORTAL_GRANT_MODEL } from 'src/advisor/infrastructure/advisor-portal-grant.models';
import {
	ADVISOR_CLIENT_ASSIGNMENT_MODEL,
	ADVISOR_MEMBER_INVITE_MODEL,
} from 'src/advisor/infrastructure/advisor-team.models';
import {
	ADVISOR_CLIENT_PROFILE_MODEL,
	ADVISOR_MEMBERSHIP_MODEL,
} from 'src/advisor/infrastructure/advisor.models';
import {
	ERASABLE_COLLECTIONS,
	MODULE_ERASED_COLLECTIONS,
	PORTFOLIO_OWNED_COLLECTION,
	RETAINED_COLLECTIONS,
} from './account-erasure.policy';

/**
 * Contrato da exclusão de conta (TRA-127). Model novo com referência ao
 * `User` que ninguém classificou vira dado órfão depois da exclusão: este
 * teste falha até ele entrar em ERASABLE_COLLECTIONS ou RETAINED_COLLECTIONS.
 */
function schemaFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((entry) => {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) return schemaFiles(full);
		return /\.(model|schema)\.ts$/.test(entry) ? [full] : [];
	});
}

function referencesUser(schema: mongoose.Schema): boolean {
	return Object.values(schema.paths).some(
		(path: any) => path.options?.ref === 'User'
	);
}

describe('Política de exclusão de conta (TRA-127)', () => {
	const classified = new Set([
		...ERASABLE_COLLECTIONS.map((c) => c.model),
		...RETAINED_COLLECTIONS.map((c) => c.model),
		...MODULE_ERASED_COLLECTIONS.map((c) => c.model),
		'User',
	]);

	it('nenhuma coleção está em mais de uma classe', () => {
		const names = [
			...ERASABLE_COLLECTIONS.map((c) => c.model),
			...RETAINED_COLLECTIONS.map((c) => c.model),
			...MODULE_ERASED_COLLECTIONS.map((c) => c.model),
			PORTFOLIO_OWNED_COLLECTION.model,
		];
		expect(new Set(names).size).toBe(names.length);
	});

	it('todo model estático que referencia User está classificado', () => {
		for (const file of schemaFiles(join(__dirname, '..'))) {
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			require(file);
		}

		const withOwner = Object.entries(mongoose.models)
			.filter(([, model]) => referencesUser(model.schema))
			.map(([name]) => name);
		const unclassified = withOwner.filter((name) => !classified.has(name));

		expect(withOwner.length).toBeGreaterThan(4);
		expect(unclassified).toEqual([]);
	});

	it('os models da política que têm schema estático existem', () => {
		const known = Object.keys(mongoose.models);
		for (const name of ['Trade', 'Asset', 'RoleChangeAudit']) {
			expect(known).toContain(name);
		}
	});

	// Os schemas do advisor não têm `ref: 'User'` (o módulo não conhece o
	// model de outro): a varredura acima não os vê, então ficam travados aqui.
	it('as coleções do advisor com dado do titular estão classificadas', () => {
		for (const model of [
			ADVISOR_CONSENT_MODEL,
			ADVISOR_CLIENT_INVITE_MODEL,
			ADVISOR_CLIENT_PROFILE_MODEL,
			ADVISOR_MEMBERSHIP_MODEL,
			ADVISOR_CLIENT_ASSIGNMENT_MODEL,
			ADVISOR_MEMBER_INVITE_MODEL,
			ADVISOR_PORTAL_GRANT_MODEL,
			ADVISOR_CLIENT_SNAPSHOT_MODEL,
			ADVISOR_WEALTH_DAILY_MODEL,
			ADVISOR_ALERT_MODEL,
			ADVISOR_CLIENT_CONTACT_MODEL,
		]) {
			expect(classified.has(model)).toBe(true);
		}
		expect(
			MODULE_ERASED_COLLECTIONS.map(({ model, ownerField }) => [
				model,
				ownerField,
			])
		).toEqual([
			[ADVISOR_CONSENT_MODEL, 'userId'],
			[ADVISOR_CLIENT_INVITE_MODEL, 'email'],
			[ADVISOR_CLIENT_PROFILE_MODEL, 'ownerUserId'],
			[ADVISOR_MEMBERSHIP_MODEL, 'userId'],
			[ADVISOR_CLIENT_ASSIGNMENT_MODEL, 'userId'],
			[ADVISOR_MEMBER_INVITE_MODEL, 'email'],
			[ADVISOR_PORTAL_GRANT_MODEL, 'userId'],
			[ADVISOR_CLIENT_SNAPSHOT_MODEL, 'clientProfileId'],
			[ADVISOR_WEALTH_DAILY_MODEL, 'clientProfileId'],
			[ADVISOR_ALERT_MODEL, 'clientProfileId'],
			[ADVISOR_CLIENT_CONTACT_MODEL, 'clientProfileId'],
		]);
	});
});
