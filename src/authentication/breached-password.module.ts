import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BreachedPasswordPolicy } from 'src/authentication/application/breached-password.policy';
import { BREACHED_PASSWORD_CHECKER } from 'src/authentication/application/ports/breached-password-checker.port';
import { HibpBreachedPasswordAdapter } from 'src/authentication/infrastructure/hibp-breached-password.adapter';
import { DisabledBreachedPasswordAdapter } from 'src/authentication/infrastructure/disabled-breached-password.adapter';

/**
 * Modulo proprio, e nao mais um provider dentro do `AuthenticationModule`
 * (TRK-012).
 *
 * A politica e usada em dois lugares que estao em lados opostos de uma
 * dependencia ja existente: `UsersService.create` (cadastro) e
 * `AuthenticationService` (troca e redefinicao de senha). O
 * `AuthenticationModule` ja importa o `UsersModule`; pendurar a politica la
 * e importa-la de volta no `UsersModule` fecharia um ciclo, e a saida
 * costuma ser `forwardRef`, que e uma divida que ninguem paga depois.
 *
 * Como modulo folha — depende so do `HttpModule` — os dois podem importa-lo
 * sem ciclo nenhum.
 *
 * A escolha do adaptador acontece uma vez, no boot, igual ao `PushModule`:
 * ligado entra o HIBP, desligado entra o null object. Nenhum ponto do codigo
 * pergunta depois "sera que a checagem esta ligada?".
 */
function isHibpEnabled(): boolean {
	// Padrao LIGADO: um controle de seguranca que so funciona quando alguem
	// lembra de ligar nao e um controle. So o literal 'false' desliga.
	if (String(process.env.HIBP_ENABLED ?? '').toLowerCase() === 'false') {
		return false;
	}
	// Teste nao fala com a internet. Sem esta linha, cada teste que cria
	// usuario passaria a depender do HIBP estar de pe.
	return process.env.NODE_ENV !== 'test';
}

@Module({
	imports: [HttpModule],
	providers: [
		BreachedPasswordPolicy,
		{
			provide: BREACHED_PASSWORD_CHECKER,
			useClass: isHibpEnabled()
				? HibpBreachedPasswordAdapter
				: DisabledBreachedPasswordAdapter,
		},
	],
	exports: [BreachedPasswordPolicy],
})
export class BreachedPasswordModule {}
