import {
	deliveryToRecord,
	RiDelivery,
} from 'src/ri-intelligence/watch/domain/ri-delivery';

function delivery(over: Partial<RiDelivery> = {}): RiDelivery {
	return {
		cvmCode: '16101',
		company: 'EMPRESA TESTE S.A.',
		category: 'Fato Relevante',
		type: null,
		subject: 'Aquisição de participação',
		referenceDate: '2026-09-28',
		deliveredOn: '2026-09-28',
		protocol: '1571942',
		downloadUrl:
			'https://www.rad.cvm.gov.br/ENETWeb/frmDownloadDocumento.aspx?Tela=ext&numSequencia=1&numVersao=1&numProtocolo=1571942&descTipo=IPE&CodigoInstituicao=1',
		active: true,
		...over,
	};
}

describe('deliveryToRecord (TRA-260)', () => {
	it('maps an ENET delivery to the same record shape the IPE produces', () => {
		const record = deliveryToRecord(delivery(), 'GFSA3');

		expect(record).toMatchObject({
			ticker: 'GFSA3',
			company: 'EMPRESA TESTE S.A.',
			title: 'Fato Relevante - Aquisição de participação',
			documentType: 'material_fact',
			// Data da entrega a meia-noite UTC, igual ao IPE (`Data_Entrega`).
			publishedAt: '2026-09-28T00:00:00.000Z',
			period: '09T26',
			source: { type: 'url', value: delivery().downloadUrl },
			contentStatus: 'metadata_only',
			deliveryProtocol: '1571942',
			cvmCategory: 'Fato Relevante',
			cvmType: null,
		});
		expect(record.id).toBe(
			'GFSA3:material_fact:2026-09-28T00:00:00.000Z:1571942:enet'
		);
	});

	it('leaves empty parts out of the title', () => {
		const record = deliveryToRecord(
			delivery({
				category: 'Dados Econômico-Financeiros',
				type: 'Demonstrações Financeiras Intermediárias',
				subject: '-',
			}),
			'GFSA3'
		);

		expect(record.title).toBe(
			'Dados Econômico-Financeiros - Demonstrações Financeiras Intermediárias'
		);
	});
});
