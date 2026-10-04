import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { trackerrIaHeaders } from 'src/ai/infrastructure/trackerr-ia-request';
import {
	AiEvalItem,
	AiEvalRunnerPort,
	AiEvalRunReport,
} from 'src/ai/evaluation/application/ai-eval-runner.port';

/** Cliente da avaliação offline no trackerr-ia (TRA-242). */
@Injectable()
export class TrackerrIaAiEvalAdapter implements AiEvalRunnerPort {
	private readonly trackerIaUrl =
		process.env.TRAKKER_IA_URL || 'http://localhost:8000';

	// Uma chamada de juiz por amostra, em sequência: alguns minutos. Roda no
	// job semanal, longe de qualquer usuário esperando.
	static readonly TIMEOUT_MS = 15 * 60 * 1000;

	constructor(private readonly httpService: HttpService) {}

	async run(input: {
		items: AiEvalItem[];
		windowDays: number;
		maxRagSamples: number;
	}): Promise<AiEvalRunReport> {
		const response = await firstValueFrom(
			this.httpService.post<AiEvalRunReport>(
				`${this.trackerIaUrl}/api/evals/run`,
				{
					items: input.items,
					window_days: input.windowDays,
					max_rag_samples: input.maxRagSamples,
				},
				{
					headers: trackerrIaHeaders(),
					timeout: TrackerrIaAiEvalAdapter.TIMEOUT_MS,
				}
			)
		);
		const report = response?.data;
		if (
			!report ||
			typeof report.rubric_version !== 'string' ||
			typeof report.by_route !== 'object'
		) {
			throw new Error('ai_eval_unexpected_response');
		}
		return report;
	}
}
