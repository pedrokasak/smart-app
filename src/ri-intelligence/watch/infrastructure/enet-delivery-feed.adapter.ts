import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { RiDeliveryFeedPort } from 'src/ri-intelligence/watch/application/ports/ri-delivery-feed.port';
import { RiDelivery } from 'src/ri-intelligence/watch/domain/ri-delivery';
import { parseEnetDeliveries } from './enet-delivery.parser';

interface EnetListResponse {
	d?: {
		temErro?: boolean;
		expirouSessao?: boolean;
		msgErro?: string;
		dados?: unknown;
	};
}

const brasiliaDate = new Intl.DateTimeFormat('pt-BR', {
	timeZone: 'America/Sao_Paulo',
	day: '2-digit',
	month: '2-digit',
	year: 'numeric',
});

/**
 * Consulta externa do ENET/RAD da CVM (TRA-260): o sistema oficial onde as
 * companhias entregam os documentos, que os mostra no dia da entrega. O
 * dataset IPE e semanal; esta e a fonte que torna o alerta possivel.
 *
 * Nao e uma API documentada: e o endpoint que a propria pagina publica
 * (`/ENETWeb/frmConsultaExternaCVM.aspx`) consome. Por isso, de proposito:
 *
 * - UMA consulta por rodada, com todas as companhias do periodo (~360
 *   entregas e ~500 KB num dia util), em vez de uma por ticker.
 * - User-Agent que identifica o Trackerr.
 * - A pagina tem captcha que a CVM liga e desliga (`hdnHabilitaCaptcha`).
 *   Com ele desligado, a consulta publica vai sem token — e assim que esta
 *   consulta vai, sempre. Se a CVM ligar o captcha e recusar, este adapter
 *   FALHA e o vigia segue com o IPE semanal. Nunca se tenta resolver captcha.
 */
@Injectable()
export class EnetDeliveryFeedAdapter implements RiDeliveryFeedPort {
	static readonly ENDPOINT =
		'https://www.rad.cvm.gov.br/ENETWeb/frmConsultaExternaCVM.aspx/ListarDocumentos';
	private static readonly REFERER =
		'https://www.rad.cvm.gov.br/ENETWeb/frmConsultaExternaCVM.aspx';
	private static readonly TIMEOUT_MS = 30_000;
	private static readonly MAX_BYTES = 20 * 1024 * 1024;

	constructor(private readonly httpService: HttpService) {}

	async listDeliveries(from: Date, to: Date): Promise<RiDelivery[]> {
		const response = await firstValueFrom(
			this.httpService.post<EnetListResponse>(
				EnetDeliveryFeedAdapter.ENDPOINT,
				{
					dataDe: brasiliaDate.format(from),
					dataAte: brasiliaDate.format(to),
					empresa: '',
					setorAtividade: '-1',
					categoriaEmissor: '-1',
					situacaoEmissor: '-1',
					tipoParticipante: '-1',
					dataReferencia: '',
					// Todas as categorias do IPE (fato relevante, comunicado,
					// dados economico-financeiros...). A relevancia e decidida
					// depois, pela classificacao oficial de cada entrega.
					categoria: 'IPE_-1_-1_-1',
					// "Periodo" por intervalo de datas (0 = dia, 1 = semana).
					periodo: '2',
					horaIni: '',
					horaFim: '',
					palavraChave: '',
					ultimaDtRef: 'false',
					tipoEmpresa: '0',
					token: '',
					versaoCaptcha: '',
				},
				{
					headers: {
						'Content-Type': 'application/json; charset=utf-8',
						'X-Requested-With': 'XMLHttpRequest',
						Referer: EnetDeliveryFeedAdapter.REFERER,
						'User-Agent': 'Trackerr-RI-Watch/1.0',
					},
					timeout: EnetDeliveryFeedAdapter.TIMEOUT_MS,
					maxContentLength: EnetDeliveryFeedAdapter.MAX_BYTES,
				}
			)
		);

		const payload = response?.data?.d;
		if (!payload || typeof payload !== 'object') {
			throw new Error('enet_unexpected_response');
		}
		if (payload.temErro || payload.expirouSessao) {
			const reason = String(payload.msgErro || 'sem mensagem').slice(0, 200);
			throw new Error(`enet_rejected: ${reason}`);
		}
		if (typeof payload.dados !== 'string') {
			throw new Error('enet_unexpected_response');
		}

		return parseEnetDeliveries(payload.dados).filter(
			(delivery) => delivery.active
		);
	}
}
