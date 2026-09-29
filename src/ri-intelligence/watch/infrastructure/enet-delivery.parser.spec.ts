import { parseEnetDeliveries } from 'src/ri-intelligence/watch/infrastructure/enet-delivery.parser';
import { enetDados, enetRow } from './enet-delivery.fixture';

describe('parseEnetDeliveries (TRA-260)', () => {
	it('parses a delivery from the ENET consultation format', () => {
		const [delivery] = parseEnetDeliveries(enetDados(enetRow()));

		expect(delivery).toEqual({
			cvmCode: '16101',
			company: 'EMPRESA TESTE S.A.',
			category: 'Fato Relevante',
			type: null,
			subject: 'Aquisição de participação',
			referenceDate: '2026-09-28',
			deliveredOn: '2026-09-28',
			protocol: '1571942',
			downloadUrl:
				'https://www.rad.cvm.gov.br/ENETWeb/frmDownloadDocumento.aspx?Tela=ext&numSequencia=1096648&numVersao=1&numProtocolo=1571942&descTipo=IPE&CodigoInstituicao=1',
			active: true,
		});
	});

	it('reads the type when present and the reference date apart from delivery', () => {
		const [delivery] = parseEnetDeliveries(
			enetDados(
				enetRow({
					category: 'Dados Econômico-Financeiros',
					type: 'Demonstrações Financeiras Intermediárias',
					subject: 'Informações financeiras intermediárias em 30/06/2026',
					reference: '30/06/2026',
					delivered: '28/09/2026 10:27',
				})
			)
		);

		expect(delivery.type).toBe('Demonstrações Financeiras Intermediárias');
		expect(delivery.referenceDate).toBe('2026-06-30');
		expect(delivery.deliveredOn).toBe('2026-09-28');
	});

	it('marks cancelled deliveries as inactive', () => {
		const [delivery] = parseEnetDeliveries(
			enetDados(enetRow({ status: 'Cancelado' }))
		);

		expect(delivery.active).toBe(false);
	});

	it('skips rows without a download action or with too few fields', () => {
		const deliveries = parseEnetDeliveries(
			enetDados(
				enetRow({ withDownload: false }),
				'lixo$&sem$&campos',
				enetRow({ protocol: '1571943' })
			)
		);

		expect(deliveries.map((d) => d.protocol)).toEqual(['1571943']);
	});

	it('returns nothing for an empty result', () => {
		expect(parseEnetDeliveries('')).toEqual([]);
	});
});
