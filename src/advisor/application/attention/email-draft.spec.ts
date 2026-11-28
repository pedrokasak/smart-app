import { Alert } from '../../domain/attention.entities';
import {
	AlertPriority,
	AlertRule,
	AlertStatus,
	AssetClass,
} from '../../domain/enums';
import { renderEmailDraft } from './email-draft';

const alertOf = (
	rule: AlertRule,
	params: Alert['params'],
	over: Partial<Alert> = {}
): Alert => ({
	id: 'a1',
	orgId: 'o1',
	clientProfileId: 'c1',
	rule,
	source: null,
	key: 'k',
	band: 1,
	priority: AlertPriority.P2,
	messageKey: `advisor.alert.${rule.toLowerCase()}`,
	params,
	evidence: {},
	dataAsOf: '2025-06-16',
	provenance: null,
	lowConfidence: false,
	conditionKey: `${rule}:-:k`,
	status: AlertStatus.Open,
	createdAt: new Date('2025-06-17T00:00:00Z'),
	updatedAt: new Date('2025-06-17T00:00:00Z'),
	...over,
});

const CASES: Array<[AlertRule, Alert['params'], string[]]> = [
	[
		AlertRule.PositionDrop,
		{ symbol: 'PETR4', dropPct: 12.5 },
		['PETR4', '12,5%', '16/06/2025'],
	],
	[AlertRule.PortfolioDrawdown, { drawdownPct: 9.25 }, ['9,25%', '16/06/2025']],
	[
		AlertRule.Concentration,
		{ symbol: 'VALE3', weightPct: 40 },
		['VALE3', '40%'],
	],
	[
		AlertRule.TargetDrift,
		{ assetClass: AssetClass.FixedIncome, driftPp: -12 },
		['Renda fixa', '12 pontos percentuais', 'abaixo'],
	],
	[
		AlertRule.TargetDrift,
		{ assetClass: AssetClass.Stock, driftPp: 7.5 },
		['Ações', '7,5 pontos percentuais', 'acima'],
	],
	[AlertRule.LargeSells, { windowPct: 25.4 }, ['25,4%', '30 dias']],
	[AlertRule.NoContact, { days: 120 }, ['120 dias']],
	[AlertRule.Manual, {}, ['carteira']],
];

describe('renderEmailDraft', () => {
	it.each(CASES)(
		'%s states the fact from the params',
		(rule, params, parts) => {
			const draft = renderEmailDraft(alertOf(rule, params));
			expect(draft.subject.length).toBeGreaterThan(0);
			for (const part of parts) expect(draft.body).toContain(part);
		}
	);

	it.each(CASES)(
		'B4: %s never talks about buying, selling or switching',
		(rule, params) => {
			const draft = renderEmailDraft(alertOf(rule, params));
			const text = `${draft.subject}\n${draft.body}`.toLowerCase();
			for (const banned of ['compr', 'vend', 'troc']) {
				expect(text).not.toContain(banned);
			}
		}
	);

	it('never copies the manual title or note, which are internal', () => {
		const draft = renderEmailDraft(
			alertOf(
				AlertRule.Manual,
				{},
				{ title: 'Vender PETR4', note: 'nota interna' }
			)
		);
		const text = `${draft.subject}\n${draft.body}`;
		expect(text).not.toContain('PETR4');
		expect(text).not.toContain('nota interna');
	});

	it('does not break on missing params', () => {
		const draft = renderEmailDraft(alertOf(AlertRule.PositionDrop, {}));
		expect(draft.body).not.toContain('undefined');
		expect(draft.body).not.toContain('NaN');
	});
});
