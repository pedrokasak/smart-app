import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { FiiFilingFeedPort } from 'src/ri-intelligence/watch/application/ports/fii-filing-feed.port';
import { FiiFiling } from 'src/ri-intelligence/watch/domain/fii-filing';
import { parseFundosNetFilings } from './fundosnet-filing.parser';

interface FundosNetListResponse {
	data?: unknown;
}

const brasiliaDate = new Intl.DateTimeFormat('pt-BR', {
	timeZone: 'America/Sao_Paulo',
	day: '2-digit',
	month: '2-digit',
	year: 'numeric',
});

/**
 * FundosNet da B3 (TRA-266): o sistema oficial onde os administradores de
 * FII entregam os documentos, que os mostra no dia da entrega.
 *
 * Como a consulta do ENET, nao e uma API documentada: e o endpoint que a
 * propria pagina publica (`/fnet/publico/abrirGerenciadorDocumentosCVM`)
 * consome. So responde JSON com `X-Requested-With: XMLHttpRequest`. Uma
 * consulta por fundo e por rodada, com User-Agent que identifica o Trackerr.
 */
@Injectable()
export class FundosNetFilingFeedAdapter implements FiiFilingFeedPort {
	static readonly ENDPOINT =
		'https://fnet.bmfbovespa.com.br/fnet/publico/pesquisarGerenciadorDocumentosDados';
	/** Documentos por consulta: um fundo entrega poucos por semana. */
	static readonly PAGE_SIZE = 100;
	private static readonly TIMEOUT_MS = 30_000;
	private static readonly MAX_BYTES = 5 * 1024 * 1024;

	constructor(private readonly httpService: HttpService) {}

	async listFundFilings(
		cnpj: string,
		from: Date,
		to: Date
	): Promise<FiiFiling[]> {
		const response = await firstValueFrom(
			this.httpService.get<FundosNetListResponse>(
				FundosNetFilingFeedAdapter.ENDPOINT,
				{
					params: {
						d: 1,
						s: 0,
						l: FundosNetFilingFeedAdapter.PAGE_SIZE,
						'o[0][dataEntrega]': 'desc',
						cnpjFundo: cnpj,
						// Todas as categorias: a relevancia e decidida depois, pela
						// classificacao oficial de cada documento.
						idCategoriaDocumento: 0,
						idTipoDocumento: 0,
						idEspecieDocumento: 0,
						dataInicial: brasiliaDate.format(from),
						dataFinal: brasiliaDate.format(to),
					},
					headers: {
						Accept: 'application/json',
						'X-Requested-With': 'XMLHttpRequest',
						'User-Agent': 'Trackerr-RI-Watch/1.0',
					},
					timeout: FundosNetFilingFeedAdapter.TIMEOUT_MS,
					maxContentLength: FundosNetFilingFeedAdapter.MAX_BYTES,
				}
			)
		);

		const rows = response?.data?.data;
		if (!Array.isArray(rows)) {
			throw new Error('fundosnet_unexpected_response');
		}
		return parseFundosNetFilings(rows);
	}
}
