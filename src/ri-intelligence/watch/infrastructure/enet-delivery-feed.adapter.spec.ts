import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { EnetDeliveryFeedAdapter } from 'src/ri-intelligence/watch/infrastructure/enet-delivery-feed.adapter';
import { enetDados, enetRow } from './enet-delivery.fixture';

function response(d: unknown) {
	return of({ data: { d } });
}

describe('EnetDeliveryFeedAdapter (TRA-260)', () => {
	let httpService: { post: jest.Mock };
	let adapter: EnetDeliveryFeedAdapter;

	const FROM = new Date('2026-09-27T02:00:00.000Z'); // 26/09 23h em Brasilia
	const TO = new Date('2026-09-28T12:00:00.000Z');

	beforeEach(() => {
		httpService = { post: jest.fn() };
		adapter = new EnetDeliveryFeedAdapter(
			httpService as unknown as HttpService
		);
	});

	it('asks the ENET for every company in the window, dated in Brasilia', async () => {
		httpService.post.mockReturnValue(
			response({ temErro: false, expirouSessao: false, dados: enetDados() })
		);

		await adapter.listDeliveries(FROM, TO);

		const [url, body, config] = httpService.post.mock.calls[0];
		expect(url).toBe(
			'https://www.rad.cvm.gov.br/ENETWeb/frmConsultaExternaCVM.aspx/ListarDocumentos'
		);
		expect(body).toMatchObject({
			dataDe: '26/09/2026',
			dataAte: '28/09/2026',
			empresa: '',
			categoria: 'IPE_-1_-1_-1',
			periodo: '2',
			// Consulta sem captcha, como a pagina publica faz quando a CVM o
			// mantem desligado. Nunca preenchido pelo Trackerr.
			token: '',
			versaoCaptcha: '',
		});
		expect(config.headers['Content-Type']).toContain('application/json');
		expect(config.headers['User-Agent']).toMatch(/Trackerr/);
		expect(config.timeout).toBeGreaterThan(0);
	});

	it('returns only active deliveries', async () => {
		httpService.post.mockReturnValue(
			response({
				temErro: false,
				expirouSessao: false,
				dados: enetDados(
					enetRow({ protocol: '1' }),
					enetRow({ protocol: '2', status: 'Cancelado' })
				),
			})
		);

		const deliveries = await adapter.listDeliveries(FROM, TO);

		expect(deliveries.map((d) => d.protocol)).toEqual(['1']);
	});

	// Se a CVM ligar o captcha, a consulta sem token passa a ser recusada. O
	// vigia NAO tenta contornar: a fonte falha e a rodada segue com o IPE.
	it('fails when the ENET refuses the query (captcha, session, error)', async () => {
		httpService.post.mockReturnValue(
			response({
				temErro: true,
				expirouSessao: false,
				msgErro: 'Captcha inválido',
				dados: '',
			})
		);

		await expect(adapter.listDeliveries(FROM, TO)).rejects.toThrow(
			/enet_rejected.*Captcha/
		);
	});

	it('fails on a response it does not recognize', async () => {
		httpService.post.mockReturnValue(of({ data: '<html>manutenção</html>' }));

		await expect(adapter.listDeliveries(FROM, TO)).rejects.toThrow(
			'enet_unexpected_response'
		);
	});

	it('propagates network failures', async () => {
		httpService.post.mockReturnValue(throwError(() => new Error('timeout')));

		await expect(adapter.listDeliveries(FROM, TO)).rejects.toThrow('timeout');
	});
});
