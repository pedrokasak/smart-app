import { HttpService } from '@nestjs/axios';
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { AiAnalysisResponseDto } from './dto/ai-analysis-response.dto';
import { InsightsResponseDto } from './dto/insight.dto';
import { trackerrIaHeaders } from 'src/ai/infrastructure/trackerr-ia-request';
import { AiInsightProducer } from 'src/ai/events/ai-insight.producer';

@Injectable()
export class AiService {
	private readonly trackerIaUrl =
		process.env.TRAKKER_IA_URL || 'http://localhost:8000';

	constructor(
		private readonly httpService: HttpService,
		private readonly insightProducer: AiInsightProducer
	) {}

	/**
	 * Realiza análise híbrida de portfólio enviando os dados para o trakker-ia (FastAPI).
	 * O payload deve seguir o modelo UserProfile do trakker-ia.
	 */
	async analyzePortfolio(payload: any): Promise<AiAnalysisResponseDto> {
		try {
			const response = await firstValueFrom(
				this.httpService.post<AiAnalysisResponseDto>(
					`${this.trackerIaUrl}/api/hybrid-analysis`,
					payload,
					{
						headers: trackerrIaHeaders(),
						timeout: 60000, // 60s — análise pode ser lenta
					}
				)
			);
			return response.data;
		} catch (error) {
			const msg =
				error?.response?.data?.detail ||
				error?.message ||
				'Erro ao conectar ao serviço de IA';
			throw new InternalServerErrorException(msg);
		}
	}

	async simulate(payload: any): Promise<any> {
		try {
			const response = await firstValueFrom(
				this.httpService.post<any>(
					`${this.trackerIaUrl}/api/simulate`,
					payload,
					{
						headers: trackerrIaHeaders(),
					}
				)
			);
			return response.data;
		} catch (error) {
			const msg =
				error?.response?.data?.detail ||
				error?.message ||
				'Erro ao conectar ao serviço de simulação';
			throw new InternalServerErrorException(msg);
		}
	}

	/**
	 * Chama o novo endpoint `/api/insights` do trackerr-ia (TRA-56/133).
	 *
	 * O contrato de resposta agora carrega, alem do `title`/`body` legados,
	 * `evidence[]`, `confidence`, `action`, `rationale` e `sources[]` — o
	 * server apenas repassa. Legado continua sendo um subconjunto valido.
	 *
	 * Usa `TRAKKER_IA_URL` (mesma env ja consumida por hybrid-analysis /
	 * chat / simulate) e o header compartilhado `x-service-token` montado
	 * em `trackerrIaHeaders()`.
	 */
	async getInsights(
		userProfile: Record<string, unknown>,
		dataFreshnessDays?: number
	): Promise<InsightsResponseDto> {
		try {
			const response = await firstValueFrom(
				this.httpService.post<InsightsResponseDto>(
					`${this.trackerIaUrl}/api/insights`,
					{
						user_profile: userProfile,
						data_freshness_days: dataFreshnessDays,
					},
					{
						headers: trackerrIaHeaders(),
						timeout: 30000,
					}
				)
			);
			// TRA-136: o insight de alta confianca vira evento de dominio. O
			// produtor nunca lanca, entao a rota responde normalmente mesmo
			// com o barramento fora do ar.
			await this.insightProducer.publishHighPriority(
				String(userProfile?.user_id ?? ''),
				response.data?.insights
			);

			return response.data;
		} catch (error) {
			const msg =
				error?.response?.data?.detail ||
				error?.message ||
				'Erro ao conectar ao serviço de insights';
			throw new InternalServerErrorException(msg);
		}
	}

	async chat(payload: any): Promise<any> {
		try {
			const response = await firstValueFrom(
				this.httpService.post<any>(`${this.trackerIaUrl}/api/chat`, payload, {
					headers: trackerrIaHeaders(),
					timeout: 60000,
				})
			);
			return response.data;
		} catch (error) {
			const msg =
				error?.response?.data?.detail ||
				error?.message ||
				'Erro ao conectar ao serviço de chat IA';
			throw new InternalServerErrorException(msg);
		}
	}
}
