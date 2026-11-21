import { AdminAnalyticsService } from './admin-analytics.service';
import { AdminAdvisorPortalController } from './admin-advisor-portal.controller';
import { AdminPromotionsController } from './admin-promotions.controller';
import { AdminPromotionsService } from './application/admin-promotions.service';
import { Module } from '@nestjs/common';
import { AdvisorModule } from 'src/advisor/advisor.module';
import { MongooseModule } from '@nestjs/mongoose';
import { SubscriptionModule } from 'src/subscription/subscription.module';
import {
	SubscriptionModel,
	UserSubscriptionModel,
} from 'src/subscription/schema';
import { UserModel } from 'src/users/schema/user.model';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminRoleService } from './application/admin-role.service';
import { ManualGrantAuditModel } from './schema/manual-grant-audit.model';
import { RoleChangeAuditModel } from './schema/role-change-audit.model';
import { EmailModule } from 'src/notifications/email/email.module';

@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'User', schema: UserModel.schema },
			{ name: 'Subscription', schema: SubscriptionModel.schema },
			{ name: 'UserSubscription', schema: UserSubscriptionModel.schema },
			{ name: 'ManualGrantAudit', schema: ManualGrantAuditModel.schema },
			{ name: 'RoleChangeAudit', schema: RoleChangeAuditModel.schema },
		]),
		SubscriptionModule,
		EmailModule,
		// `PortalAccessService` para a liberação do portal do assessor (P3a).
		AdvisorModule,
	],
	controllers: [
		AdminController,
		AdminPromotionsController,
		AdminAdvisorPortalController,
	],
	providers: [
		AdminService,
		AdminRoleService,
		AdminAnalyticsService,
		AdminPromotionsService,
	],
	exports: [AdminService],
})
export class AdminModule {}
