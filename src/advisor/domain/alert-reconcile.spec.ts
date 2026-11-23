import { reconcileAlerts } from './alert-reconcile';
import { Alert, AlertCandidate, conditionKeyOf } from './attention.entities';
import {
	AlertPriority,
	AlertRule,
	AlertStatus,
	PortfolioProvenance,
	SnapshotSource,
} from './enums';

const TODAY = '2026-11-23';

const candidate = (over: Partial<AlertCandidate> = {}): AlertCandidate => ({
	rule: AlertRule.PositionDrop,
	source: SnapshotSource.AdvisorLedger,
	key: 'PETR4',
	band: 1,
	priority: AlertPriority.P2,
	messageKey: 'advisor.alert.positionDrop',
	params: { symbol: 'PETR4' },
	evidence: { dropPct: 12 },
	dataAsOf: TODAY,
	provenance: PortfolioProvenance.Verified,
	lowConfidence: false,
	...over,
});

const alert = (over: Partial<Alert> = {}): Alert => {
	const base = candidate(over);
	return {
		...base,
		id: 'a1',
		orgId: 'org',
		clientProfileId: 'client',
		conditionKey: conditionKeyOf(base),
		status: AlertStatus.Open,
		createdAt: new Date('2026-11-01T00:00:00Z'),
		updatedAt: new Date('2026-11-01T00:00:00Z'),
		...over,
	};
};

describe('reconcileAlerts', () => {
	it('abre candidato sem registro da condição', () => {
		const c = candidate();
		const r = reconcileAlerts({ candidates: [c], existing: [], today: TODAY });
		expect(r).toEqual({ open: [c], update: [], resolve: [] });
	});

	it('banda maior em alerta ativo: sobe banda, prioridade e evidência', () => {
		const c = candidate({
			band: 2,
			priority: AlertPriority.P1,
			evidence: { dropPct: 25 },
			dataAsOf: '2026-11-23',
			lowConfidence: false,
		});
		const r = reconcileAlerts({
			candidates: [c],
			existing: [alert({ dataAsOf: '2026-11-20' })],
			today: TODAY,
		});
		expect(r.open).toEqual([]);
		expect(r.resolve).toEqual([]);
		expect(r.update).toHaveLength(1);
		expect(r.update[0].id).toBe('a1');
		expect(r.update[0].patch).toEqual({
			band: 2,
			priority: AlertPriority.P1,
			evidence: { dropPct: 25 },
			dataAsOf: '2026-11-23',
			lowConfidence: false,
			status: AlertStatus.Open,
			snoozedUntil: undefined,
		});
		expect('snoozedUntil' in r.update[0].patch).toBe(true);
	});

	it('banda igual ou menor em alerta ativo: só evidência e data', () => {
		const existing = alert({ band: 2, priority: AlertPriority.P1 });
		const c = candidate({
			band: 1,
			priority: AlertPriority.P2,
			evidence: { dropPct: 11 },
			lowConfidence: true,
		});
		const r = reconcileAlerts({
			candidates: [c],
			existing: [existing],
			today: TODAY,
		});
		expect(r.open).toEqual([]);
		expect(r.update).toEqual([
			{
				id: 'a1',
				patch: {
					evidence: { dropPct: 11 },
					dataAsOf: TODAY,
					lowConfidence: true,
				},
			},
		]);
	});

	it('adiado vencido volta a OPEN', () => {
		const r = reconcileAlerts({
			candidates: [candidate()],
			existing: [
				alert({ status: AlertStatus.Snoozed, snoozedUntil: '2026-11-23' }),
			],
			today: TODAY,
		});
		expect(r.update[0].patch.status).toBe(AlertStatus.Open);
		expect(r.update[0].patch.band).toBeUndefined();
		expect(r.open).toEqual([]);
	});

	it('adiado ainda dentro do prazo continua adiado', () => {
		const r = reconcileAlerts({
			candidates: [candidate()],
			existing: [
				alert({ status: AlertStatus.Snoozed, snoozedUntil: '2026-11-24' }),
			],
			today: TODAY,
		});
		expect(r.update[0].patch.status).toBeUndefined();
	});

	it.each([AlertStatus.Handled, AlertStatus.Dismissed])(
		'último %s na mesma banda: nada acontece',
		(status) => {
			const r = reconcileAlerts({
				candidates: [candidate({ band: 1 })],
				existing: [alert({ status, band: 1, closedAt: new Date() })],
				today: TODAY,
			});
			expect(r).toEqual({ open: [], update: [], resolve: [] });
		}
	);

	it('último fechado em banda maior: candidato de banda menor não abre', () => {
		const r = reconcileAlerts({
			candidates: [candidate({ band: 1 })],
			existing: [alert({ status: AlertStatus.Handled, band: 2 })],
			today: TODAY,
		});
		expect(r).toEqual({ open: [], update: [], resolve: [] });
	});

	it('banda maior que a do último fechado abre', () => {
		const c = candidate({ band: 2 });
		const r = reconcileAlerts({
			candidates: [c],
			existing: [alert({ status: AlertStatus.Dismissed, band: 1 })],
			today: TODAY,
		});
		expect(r.open).toEqual([c]);
	});

	it('usa o fechado mais recente por closedAt, não o de maior banda antigo', () => {
		const c = candidate({ band: 2 });
		const r = reconcileAlerts({
			candidates: [c],
			existing: [
				alert({
					id: 'old',
					status: AlertStatus.Handled,
					band: 2,
					closedAt: new Date('2026-06-01T00:00:00Z'),
				}),
				alert({
					id: 'new',
					status: AlertStatus.Handled,
					band: 1,
					closedAt: new Date('2026-10-01T00:00:00Z'),
				}),
			],
			today: TODAY,
		});
		expect(r.open).toEqual([c]);
	});

	it('RESOLVED não bloqueia a reabertura', () => {
		const c = candidate({ band: 1 });
		const r = reconcileAlerts({
			candidates: [c],
			existing: [alert({ status: AlertStatus.Resolved, band: 2 })],
			today: TODAY,
		});
		expect(r.open).toEqual([c]);
	});

	it('ativo sem candidato vai para resolve', () => {
		const r = reconcileAlerts({
			candidates: [],
			existing: [
				alert({ id: 'x' }),
				alert({
					id: 'y',
					key: 'VALE3',
					status: AlertStatus.Snoozed,
					snoozedUntil: '2026-12-01',
				}),
			],
			today: TODAY,
		});
		expect(r.resolve.sort()).toEqual(['x', 'y']);
	});

	it('alerta fechado sem candidato não vai para resolve', () => {
		const r = reconcileAlerts({
			candidates: [],
			existing: [alert({ status: AlertStatus.Handled })],
			today: TODAY,
		});
		expect(r.resolve).toEqual([]);
	});

	it('MANUAL nunca entra em resolve nem em update', () => {
		const manual = alert({
			id: 'm',
			rule: AlertRule.Manual,
			source: null,
			key: 'm',
		});
		const r = reconcileAlerts({
			candidates: [],
			existing: [manual],
			today: TODAY,
		});
		expect(r).toEqual({ open: [], update: [], resolve: [] });
	});

	it('Review Focus 2: SNOOZED banda 1 + candidato banda 2 reabre sem duplicar', () => {
		const r = reconcileAlerts({
			candidates: [candidate({ band: 2, priority: AlertPriority.P0 })],
			existing: [
				alert({
					status: AlertStatus.Snoozed,
					snoozedUntil: '2026-12-20',
					band: 1,
				}),
			],
			today: TODAY,
		});
		expect(r.open).toEqual([]);
		expect(r.resolve).toEqual([]);
		expect(r.update).toHaveLength(1);
		expect(r.update[0].patch.status).toBe(AlertStatus.Open);
		expect(r.update[0].patch.priority).toBe(AlertPriority.P0);
		expect(r.update[0].patch.band).toBe(2);
	});

	it('mais de um ativo na mesma condição: atualiza o mais novo e resolve os outros', () => {
		const r = reconcileAlerts({
			candidates: [candidate({ evidence: { dropPct: 13 } })],
			existing: [
				alert({ id: 'old', createdAt: new Date('2026-10-01T00:00:00Z') }),
				alert({ id: 'new', createdAt: new Date('2026-11-10T00:00:00Z') }),
			],
			today: TODAY,
		});
		expect(r.update.map((u) => u.id)).toEqual(['new']);
		expect(r.resolve).toEqual(['old']);
		expect(r.open).toEqual([]);
	});
});
