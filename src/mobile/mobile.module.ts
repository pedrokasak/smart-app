import { Module } from '@nestjs/common';
import { mobileMinAppVersion } from 'src/env';
import { DividendIncomeModule } from 'src/dividend-income/dividend-income.module';
import { PortfolioModule } from 'src/portfolio/portfolio.module';
import {
	AppVersionGuard,
	MOBILE_MIN_APP_VERSION,
} from './app-version/app-version.guard';
import { MobileDividendsService } from './application/mobile-dividends.service';
import { MobileHomeService } from './application/mobile-home.service';
import { MobileWalletService } from './application/mobile-wallet.service';
import { MobileConfigController, MobileController } from './mobile.controller';

/**
 * BFF do app mobile, dentro do server (ADR-001). Roda no mesmo processo porque
 * um serviço a mais não se paga nesta infraestrutura; pode virar serviço próprio
 * sem reescrita, porque só depende dos serviços exportados pelos outros módulos.
 */
@Module({
	imports: [PortfolioModule, DividendIncomeModule],
	controllers: [MobileConfigController, MobileController],
	providers: [
		MobileHomeService,
		MobileWalletService,
		MobileDividendsService,
		AppVersionGuard,
		{ provide: MOBILE_MIN_APP_VERSION, useValue: mobileMinAppVersion },
	],
})
export class MobileModule {}
