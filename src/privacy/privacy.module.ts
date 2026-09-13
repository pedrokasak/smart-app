import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PrivacyController } from './privacy.controller';
import { PrivacyService } from './privacy.service';
import { UsersModule } from 'src/users/users.module';
import { ProfileModule } from 'src/profile/profile.module';
import { AddressModule } from 'src/address/address.module';
import { PortfolioModule } from 'src/portfolio/portfolio.module';
import { SubscriptionModule } from 'src/subscription/subscription.module';
import { TokenBlacklistModule } from 'src/token-blacklist/token-blacklist.module';
import { tradeSchema } from 'src/fiscal/schema/trade.model';

/**
 * Módulo isolado para os direitos LGPD básicos (TRA-122): exportação dos
 * dados do titular e exclusão da própria conta.
 *
 * Fica fora de `users`/`profile`/`portfolio` de propósito — em vez de inchar
 * esses módulos com uma preocupação transversal (agregação de dados de
 * várias coleções), este módulo só consome os serviços já expostos por eles
 * (baixo acoplamento, CLAUDE.md §6.1). A única leitura direta de model é
 * `Trade`, porque `FiscalModule` não expõe um método de listagem por
 * usuário — registrar o schema aqui evita alterar um módulo estável só para
 * satisfazer esta feature nova.
 */
@Module({
	imports: [
		MongooseModule.forFeature([{ name: 'Trade', schema: tradeSchema }]),
		UsersModule,
		ProfileModule,
		AddressModule,
		PortfolioModule,
		SubscriptionModule,
		TokenBlacklistModule.forRoot(),
	],
	controllers: [PrivacyController],
	providers: [PrivacyService],
})
export class PrivacyModule {}
