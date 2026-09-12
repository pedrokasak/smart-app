import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Portfolio } from 'src/portfolio/schema/portfolio.model';
import { AllocationBreachProducer } from 'src/portfolio/target-allocation/application/allocation-breach.producer';
import { TargetAllocationService } from 'src/portfolio/target-allocation/target-allocation.service';
import { PortfolioScoreProducer } from './portfolio-score.producer';

/**
 * Reavaliacao periodica da carteira (TRA-136, fase 4).
 *
 * E o agendador que o TODO do `AllocationBreachProducer` prometia. Ate
 * agora a alocacao so era avaliada quando o usuario salvava a meta — ou
 * seja, o alerta dependia de o usuario ir ate a tela que o alerta existe
 * para evitar. Uma varredura diaria transforma as duas regras em algo que
 * observa a carteira sozinho.
 *
 * A varredura ser diaria e o que torna o motor de limiares obrigatorio, e
 * nao opcional: sem borda, histerese e cooldown, este cron mandaria o mesmo
 * e-mail 365 vezes por ano para uma carteira que ficou fora da meta e
 * assim continuou. Com eles, uma condicao de pe rende um aviso a cada
 * `cooldownHours` (72h por padrao).
 *
 * Nunca lanca por usuario: os dois produtores ja engolem a propria falha,
 * e a varredura captura o resto. Um dia sem avaliacao e melhor que um cron
 * morto.
 */
@Injectable()
export class PortfolioEvaluationScheduler {
	private readonly logger = new Logger(PortfolioEvaluationScheduler.name);

	constructor(
		@InjectModel('Portfolio')
		private readonly portfolioModel: Model<Portfolio>,
		private readonly targetAllocation: TargetAllocationService,
		private readonly breachProducer: AllocationBreachProducer,
		private readonly scoreProducer: PortfolioScoreProducer
	) {}

	@Cron(CronExpression.EVERY_DAY_AT_7AM, {
		name: 'portfolio-evaluation',
		timeZone: 'America/Sao_Paulo',
	})
	async runDaily(): Promise<void> {
		try {
			const evaluated = await this.sweep();
			this.logger.log(`Avaliacao de carteira: ${evaluated} usuario(s)`);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.logger.error(`Avaliacao de carteira falhou: ${message}`);
		}
	}

	/** Extraido para teste. Devolve quantos usuarios foram avaliados. */
	async sweep(): Promise<number> {
		const rawIds: unknown[] = await this.portfolioModel
			.distinct('userId')
			.exec();
		const userIds = rawIds.map((id) => String(id ?? ''));

		let evaluated = 0;
		for (const userId of userIds) {
			if (!userId) continue;

			// Sequencial de proposito: a ~5 mil usuarios isto e um passe de
			// leitura por usuario uma vez ao dia. Paralelizar aqui so
			// transferiria a pressao para o Mongo sem ganho — o trabalho
			// falivel (canal, IA) ja e assincrono, na fila.
			const target = await this.targetAllocation.findByUser(userId);
			await this.breachProducer.evaluateForUser(userId, target);
			await this.scoreProducer.evaluateForUser(userId);
			evaluated += 1;
		}

		return evaluated;
	}
}
