import { Controller, Get, Inject, Request, UseGuards } from '@nestjs/common';
import {
	ApiBearerAuth,
	ApiHeader,
	ApiOkResponse,
	ApiResponse,
	ApiTags,
} from '@nestjs/swagger';
import { Public } from 'src/utils/constants';
import {
	AppVersionGuard,
	MOBILE_MIN_APP_VERSION,
} from './app-version/app-version.guard';
import { MobileDividendsService } from './application/mobile-dividends.service';
import { MobileHomeService } from './application/mobile-home.service';
import { MobileWalletService } from './application/mobile-wallet.service';
import {
	MobileConfigResponseDto,
	MobileHomeResponseDto,
} from './dto/mobile-home-response.dto';
import {
	MobileDividendsResponseDto,
	MobileWalletResponseDto,
} from './dto/mobile-wallet-response.dto';

/** Pública e sem exigir versão: o app confere a versão antes do login. */
@Controller('mobile/v1/config')
@ApiTags('mobile')
export class MobileConfigController {
	constructor(
		@Inject(MOBILE_MIN_APP_VERSION) private readonly minVersion: string
	) {}

	@Public()
	@Get()
	@ApiOkResponse({ type: MobileConfigResponseDto })
	getConfig(): MobileConfigResponseDto {
		return { minVersion: this.minVersion };
	}
}

/** Rota nova entra aqui e já exige a versão mínima. */
@Controller('mobile/v1')
@ApiTags('mobile')
@UseGuards(AppVersionGuard)
@ApiBearerAuth('access-token')
@ApiHeader({ name: 'X-App-Version', required: true, example: '1.0.0' })
@ApiResponse({ status: 426, description: 'Versão do app velha demais' })
export class MobileController {
	constructor(
		private readonly home: MobileHomeService,
		private readonly wallet: MobileWalletService,
		private readonly dividends: MobileDividendsService
	) {}

	@Get('home')
	@ApiOkResponse({ type: MobileHomeResponseDto })
	getHome(@Request() req): Promise<MobileHomeResponseDto> {
		return this.home.getHome(req.user.userId);
	}

	@Get('wallet')
	@ApiOkResponse({ type: MobileWalletResponseDto })
	getWallet(@Request() req): Promise<MobileWalletResponseDto> {
		return this.wallet.getWallet(req.user.userId);
	}

	@Get('dividends')
	@ApiOkResponse({ type: MobileDividendsResponseDto })
	getDividends(@Request() req): Promise<MobileDividendsResponseDto> {
		return this.dividends.getDividends(req.user.userId);
	}
}
