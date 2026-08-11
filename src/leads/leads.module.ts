import { Module } from '@nestjs/common';
import { EmailModule } from 'src/notifications/email/email.module';
import { LeadsController } from './leads.controller';
import { PurchaseIntentService } from './leads.service';

@Module({
	imports: [EmailModule],
	controllers: [LeadsController],
	providers: [PurchaseIntentService],
})
export class LeadsModule {}
