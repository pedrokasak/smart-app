import { InternalServerErrorException } from '@nestjs/common';
import { OrgRole } from 'src/advisor/domain/enums';
import { accessContextOf } from './request-context';

describe('accessContextOf', () => {
	it('takes the user from the JWT and the org from the guard context', () => {
		const req = {
			user: { userId: 'u1' },
			orgContext: { orgId: 'orgA', role: OrgRole.Advisor },
		};
		expect(accessContextOf(req)).toEqual({ userId: 'u1', orgId: 'orgA' });
	});

	it('ignores an org sent by the client in the body or query', () => {
		const req = {
			user: { userId: 'u1' },
			body: { orgId: 'evil' },
			query: { orgId: 'evil' },
			orgContext: { orgId: 'orgA', role: OrgRole.Advisor },
		};
		expect(accessContextOf(req).orgId).toBe('orgA');
	});

	it('is a 500 wiring error when OrgContextGuard did not run', () => {
		expect(() => accessContextOf({ user: { userId: 'u1' } })).toThrow(
			InternalServerErrorException
		);
	});
});
