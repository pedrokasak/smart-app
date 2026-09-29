import { RiDocumentRecord } from 'src/ri-intelligence/domain/ri-document.types';
import {
	isPermanentContentFailure,
	isWatchRelevant,
	watchDocumentKey,
} from 'src/ri-intelligence/watch/domain/ri-watch';

function record(over: Partial<RiDocumentRecord> = {}): RiDocumentRecord {
	return {
		id: 'PETR4:material_fact:2026-09-28T00:00:00.000Z:abc:cvm',
		ticker: 'PETR4',
		company: 'Petrobras',
		title: 'Fato Relevante - Aquisição',
		documentType: 'material_fact',
		period: null,
		publishedAt: '2026-09-28T00:00:00.000Z',
		source: { type: 'url', value: 'https://www.rad.cvm.gov.br/enet/doc-1' },
		classification: { method: 'deterministic_rules', confidence: 'high' },
		contentStatus: 'metadata_only',
		...over,
	};
}

describe('ri-watch domain (TRA-240)', () => {
	it('derives a stable key from the document link', () => {
		expect(watchDocumentKey(record())).toBe(watchDocumentKey(record()));
		expect(watchDocumentKey(record())).toMatch(/^[a-f0-9]{24}$/);
		expect(
			watchDocumentKey(
				record({ source: { type: 'url', value: 'https://rad/doc-2' } })
			)
		).not.toBe(watchDocumentKey(record()));
	});

	it('has no key without a link', () => {
		expect(
			watchDocumentKey(record({ source: { type: 'url', value: '  ' } }))
		).toBeNull();
	});

	it.each([
		'earnings_release',
		'material_fact',
		'dividend_notice',
		'shareholder_notice',
		'financial_statement',
		'investor_presentation',
	] as const)('watches %s', (documentType) => {
		expect(isWatchRelevant(record({ documentType }))).toBe(true);
	});

	it.each(['other_ri_document', 'unknown', 'reference_form'] as const)(
		'ignores %s',
		(documentType) => {
			expect(isWatchRelevant(record({ documentType }))).toBe(false);
		}
	);

	it('ignores documents that are not a downloadable link', () => {
		expect(
			isWatchRelevant(record({ source: { type: 'file', value: 'x.pdf' } }))
		).toBe(false);
	});

	it('treats only unrecoverable extraction failures as permanent', () => {
		expect(isPermanentContentFailure('empty_after_extract')).toBe(true);
		expect(isPermanentContentFailure('not_pdf')).toBe(true);
		expect(isPermanentContentFailure('fetch_failed')).toBe(false);
		expect(isPermanentContentFailure(undefined)).toBe(false);
	});
});
