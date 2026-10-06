import { Module } from '@nestjs/common';
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
	],
	controllers: [AdminController],
	providers: [AdminService, AdminRoleService],
	exports: [AdminService],
})
export class AdminModule {}
