import { HttpService } from '@nestjs/axios';
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { AiAnalysisResponseDto } from './dto/ai-analysis-response.dto';

@Injectable()
export class AiService {
	private readonly trackerIaUrl =
		process.env.TRAKKER_IA_URL || 'http://localhost:8000';

	constructor(private readonly httpService: HttpService) {}

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
						headers: { 'Content-Type': 'application/json' },
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
						headers: { 'Content-Type': 'application/json' },
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

	async chat(payload: any): Promise<any> {
		try {
			const response = await firstValueFrom(
				this.httpService.post<any>(`${this.trackerIaUrl}/api/chat`, payload, {
					headers: { 'Content-Type': 'application/json' },
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
