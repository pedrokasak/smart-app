import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { trackerrIaHeaders } from 'src/ai/infrastructure/trackerr-ia-request';
import {
	ChatTool,
	chatToolByName,
	chatToolParameters,
} from 'src/ai/orchestration/tool-routing/chat-tool-catalog';
import {
	ChatPlannedCall,
	ChatToolPlan,
	ChatToolPlannerPort,
} from 'src/ai/orchestration/tool-routing/chat-tool-planner.port';

interface TrackerrIaPlanResponse {
	calls?: unknown;
	provider?: unknown;
	input_tokens?: unknown;
	output_tokens?: unknown;
	reason?: unknown;
}

const TICKER = /^[A-Z0-9]{4,6}(\.SA)?$/;

function count(value: unknown): number {
	const n = Number(value);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Lê a escolha do trackerr-ia sem confiar nela: ferramenta fora do catálogo
 * sai, ticker com cara de qualquer coisa sai, e cada ferramenta leva no
 * máximo os tickers que aceita.
 */
function readCalls(raw: unknown, maxCalls: number): ChatPlannedCall[] {
	if (!Array.isArray(raw)) return [];
	const calls: ChatPlannedCall[] = [];
	for (const entry of raw as { name?: unknown; arguments?: unknown }[]) {
		const tool = chatToolByName(String(entry?.name ?? ''));
		if (!tool) continue;
		const args = (entry?.arguments ?? {}) as { tickers?: unknown };
		const tickers = Array.isArray(args.tickers)
			? args.tickers
					.map((ticker) =>
						String(ticker ?? '')
							.trim()
							.toUpperCase()
					)
					.filter((ticker) => TICKER.test(ticker))
			: [];
		calls.push({
			intent: tool.name,
			tickers: [...new Set(tickers)].slice(0, tool.maxTickers),
		});
		if (calls.length >= maxCalls) break;
	}
	return calls;
}

/** Cliente do roteador do chat no trackerr-ia (TRA-241). */
@Injectable()
export class TrackerrIaChatToolPlannerAdapter implements ChatToolPlannerPort {
	private readonly trackerIaUrl =
		process.env.TRAKKER_IA_URL || 'http://localhost:8000';

	// Uma chamada de modelo, com o usuário esperando. Passou disso, o chat
	// responde pelo regex.
	static readonly TIMEOUT_MS = 8_000;

	constructor(private readonly httpService: HttpService) {}

	async plan(input: {
		question: string;
		tools: readonly ChatTool[];
		maxCalls: number;
	}): Promise<ChatToolPlan> {
		const response = await firstValueFrom(
			this.httpService.post<TrackerrIaPlanResponse>(
				`${this.trackerIaUrl}/api/chat/plan`,
				{
					question: input.question.slice(0, 1000),
					tools: input.tools.map((tool) => ({
						name: tool.name,
						description: tool.description,
						parameters: chatToolParameters(tool),
					})),
					max_calls: input.maxCalls,
				},
				{
					headers: trackerrIaHeaders(),
					timeout: TrackerrIaChatToolPlannerAdapter.TIMEOUT_MS,
				}
			)
		);
		const data = response?.data;
		if (!data || !Array.isArray(data.calls)) {
			throw new Error('chat_plan_unexpected_response');
		}
		return {
			calls: readCalls(data.calls, input.maxCalls),
			provider: typeof data.provider === 'string' ? data.provider : null,
			inputTokens: count(data.input_tokens),
			outputTokens: count(data.output_tokens),
			reason: typeof data.reason === 'string' ? data.reason : null,
		};
	}
}
