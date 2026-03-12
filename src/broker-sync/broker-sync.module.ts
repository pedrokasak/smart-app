import { Module } from '@nestjs/common';
import { BrokerSyncController } from './broker-sync.controller';
import { BrokerSyncService } from './broker-sync.service';
import { PortfolioModule } from 'src/portfolio/portfolio.module';
import { AssetsModule } from 'src/assets/assets.module';
import { FiscalModule } from 'src/fiscal/fiscal.module';
import { SubscriptionModule } from 'src/subscription/subscription.module';

@Module({
	imports: [PortfolioModule, AssetsModule, FiscalModule, SubscriptionModule],
	controllers: [BrokerSyncController],
	providers: [BrokerSyncService],
})
export class BrokerSyncModule {}
