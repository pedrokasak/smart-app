import { Module } from '@nestjs/common';
import { BrokerSyncController } from './broker-sync.controller';
import { BrokerSyncService } from './broker-sync.service';
import { PortfolioModule } from 'src/portfolio/portfolio.module';
import { AssetsModule } from 'src/assets/assets.module';

@Module({
	imports: [PortfolioModule, AssetsModule],
	controllers: [BrokerSyncController],
	providers: [BrokerSyncService],
})
export class BrokerSyncModule {}
