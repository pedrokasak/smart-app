import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PixCheckoutService } from './application/pix-checkout.service';
import { CreatePixCheckoutDto } from './dto/create-pix-checkout.dto';

/**
 * Checkout por PIX (TRA-195). Autenticado pelo `JwtAuthGuard` global. Não
 * exige plano: é justamente o caminho de quem ainda não tem plano pago.
 */
@ApiTags('payments')
@ApiBearerAuth('access-token')
@Controller('payments/pix')
export class PixController {
	constructor(private readonly checkout: PixCheckoutService) {}

	/** O web só mostra a opção PIX quando o servidor pode de fato cobrar. */
	@Get('availability')
	@ApiOperation({ summary: 'Se o checkout PIX está ligado' })
	availability() {
		return { enabled: this.checkout.isAvailable() };
	}

	@Post('checkout')
	@ApiOperation({ summary: 'Emite cobrança PIX e devolve o QR code' })
	createCheckout(@Req() req: any, @Body() dto: CreatePixCheckoutDto) {
		return this.checkout.createCheckout(String(req.user.userId), dto);
	}

	@Get('charges/:chargeId')
	@ApiOperation({ summary: 'Estado da cobrança PIX (polling do web)' })
	getCharge(@Req() req: any, @Param('chargeId') chargeId: string) {
		return this.checkout.getCharge(String(req.user.userId), chargeId);
	}
}
