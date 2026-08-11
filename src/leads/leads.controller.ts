import { Body, Controller, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from 'src/utils/constants';
import { PurchaseIntentDto } from './dto/purchase-intent.dto';
import { PurchaseIntentService } from './leads.service';

@Controller('leads')
@ApiTags('leads')
export class LeadsController {
	constructor(private readonly purchaseIntentService: PurchaseIntentService) {}

	@Public()
	@Post('purchase-intent')
	@ApiOkResponse({ schema: { example: { success: true } } })
	async capturePurchaseIntent(@Body() dto: PurchaseIntentDto) {
		return this.purchaseIntentService.captureIntent(dto);
	}
}
