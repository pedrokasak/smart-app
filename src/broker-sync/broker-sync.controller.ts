import {
	Body,
	Controller,
	Delete,
	Get,
	Param,
	Post,
	Req,
	UseGuards,
} from '@nestjs/common';
import { BrokerSyncService } from './broker-sync.service';
import { BrokerConnectDto } from './dto/broker-connect.dto';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';

@Controller('broker-sync')
@UseGuards(JwtAuthGuard)
export class BrokerSyncController {
	constructor(private readonly brokerSyncService: BrokerSyncService) {}

	@Get('connections')
	async getConnections(@Req() req: any) {
		return this.brokerSyncService.getConnections(req.user.userId);
	}

	@Post('connect')
	async connect(@Req() req: any, @Body() dto: BrokerConnectDto) {
		return this.brokerSyncService.connect(req.user.userId, dto);
	}

	@Post('sync/:provider')
	async sync(@Req() req: any, @Param('provider') provider: string) {
		return this.brokerSyncService.syncConnection(req.user.userId, provider);
	}

	@Delete('disconnect/:provider')
	async disconnect(@Req() req: any, @Param('provider') provider: string) {
		return this.brokerSyncService.disconnect(req.user.userId, provider);
	}
}
