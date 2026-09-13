import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * Trava do grafo de injecao de dependencia (TRA-154).
 *
 * Os testes unitarios montam cada modulo com dependencias mockadas, entao
 * nenhum deles percebe quando um modulo pede um provider que o modulo
 * importado nao exporta. Esse erro so aparece quando o `AppModule` inteiro
 * sobe — e nenhum teste subia o `AppModule`.
 *
 * Foi o que tirou producao do ar no deploy do v1.6.0: `QuoteFreshnessScheduler`
 * injetava `THRESHOLD_SYSTEM_POLICY`, que o `ThresholdsModule` provia mas nao
 * exportava. CI verde, container em crash-loop com
 * "Nest can't resolve dependencies of the QuoteFreshnessScheduler".
 *
 * `preview: true` resolve o grafo completo SEM instanciar nenhum provider:
 * nao abre conexao com Mongo nem Redis, nao dispara `onModuleInit`, nao
 * chama API externa. Pega exatamente a classe de erro que derrubou o deploy,
 * sem infraestrutura nenhuma.
 */
describe('AppModule — grafo de injecao de dependencia', () => {
	it('resolve todas as dependencias de todos os providers', async () => {
		const app = await NestFactory.createApplicationContext(AppModule, {
			preview: true,
			abortOnError: false,
			logger: false,
		});

		await app.close();
	}, 60_000);
});
