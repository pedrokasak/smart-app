import {
	cvmDeliveryProtocol,
	protocolFromCvmLink,
} from 'src/ri-intelligence/domain/cvm-protocol';

const IPE_LINK =
	'https://www.rad.cvm.gov.br/ENET/frmDownloadDocumento.aspx?Tela=ext&numSequencia=1096648&numVersao=1&numProtocolo=1571942&descTipo=IPE&CodigoInstituicao=1';
const ENET_LINK =
	'https://www.rad.cvm.gov.br/ENETWeb/frmDownloadDocumento.aspx?Tela=ext&numSequencia=1096648&numVersao=1&numProtocolo=1571942&descTipo=IPE&CodigoInstituicao=1';

describe('cvm protocol (TRA-260)', () => {
	it('reads numProtocolo from both CVM download links alike', () => {
		expect(protocolFromCvmLink(IPE_LINK)).toBe('1571942');
		expect(protocolFromCvmLink(ENET_LINK)).toBe('1571942');
		expect(
			protocolFromCvmLink('https://ri.empresa.com/release.pdf')
		).toBeNull();
		expect(protocolFromCvmLink(undefined)).toBeNull();
	});

	it('prefers the record field, then the link', () => {
		expect(
			cvmDeliveryProtocol({
				deliveryProtocol: '001571942',
				source: { type: 'url', value: 'https://x/doc.pdf' },
			})
		).toBe('001571942');
		expect(
			cvmDeliveryProtocol({
				deliveryProtocol: null,
				source: { type: 'url', value: IPE_LINK },
			})
		).toBe('1571942');
		expect(
			cvmDeliveryProtocol({
				source: { type: 'url', value: 'https://ri.empresa.com/release.pdf' },
			})
		).toBeNull();
		expect(cvmDeliveryProtocol(null)).toBeNull();
	});
});
