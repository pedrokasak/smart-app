import { riDocumentTextKey } from 'src/ri-intelligence/domain/ri-document-text-key';

const IPE_LINK =
	'https://www.rad.cvm.gov.br/ENET/frmDownloadDocumento.aspx?Tela=ext&descTipo=IPE&CodigoInstituicao=1&numProtocolo=1571942&numSequencia=1096648&numVersao=1';
const ENET_LINK =
	'https://www.rad.cvm.gov.br/ENETWeb/frmDownloadDocumento.aspx?Tela=ext&numSequencia=1096648&numVersao=1&numProtocolo=1571942&descTipo=IPE&CodigoInstituicao=1';

describe('riDocumentTextKey (TRA-253)', () => {
	// O texto que o vigia baixou pelo ENET serve a tela e ao chat, que chegam
	// pelo link do IPE.
	it('gives the same key to the IPE and ENET links of the same CVM file', () => {
		expect(riDocumentTextKey(IPE_LINK)).toBe('cvm:1571942:1096648:1');
		expect(riDocumentTextKey(ENET_LINK)).toBe('cvm:1571942:1096648:1');
	});

	it('tells apart two versions of the same delivery', () => {
		expect(
			riDocumentTextKey(IPE_LINK.replace('numVersao=1', 'numVersao=2'))
		).toBe('cvm:1571942:1096648:2');
	});

	// Parametro fora do formato conhecido pode ser outro arquivo: sem atalho.
	it.each([
		IPE_LINK.replace('CodigoInstituicao=1', 'CodigoInstituicao=2'),
		IPE_LINK.replace('descTipo=IPE', 'descTipo=DFP'),
		IPE_LINK.replace('numVersao=1', 'numVersao=1a'),
		IPE_LINK.replace('Tela=ext', 'Tela=int'),
		`${IPE_LINK}&formato=zip`,
		`${IPE_LINK}&numProtocolo=9999999`,
		IPE_LINK.replace('www.rad.cvm.gov.br', 'rad.cvm.gov.br.evil.com'),
		'https://ri.empresa.com/release.pdf?numProtocolo=1571942&numSequencia=1096648&numVersao=1',
	])('keys anything else by the link itself: %s', (link) => {
		expect(riDocumentTextKey(link)).toMatch(/^url:[0-9a-f]{64}$/);
	});

	it('has no key without a usable link', () => {
		expect(riDocumentTextKey('')).toBeNull();
		expect(riDocumentTextKey('nao e link')).toBeNull();
		expect(riDocumentTextKey(undefined)).toBeNull();
	});
});
