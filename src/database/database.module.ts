import { Module } from '@nestjs/common';
import { IndexMaintenanceService } from './index-maintenance.service';

@Module({ providers: [IndexMaintenanceService] })
export class DatabaseModule {}
