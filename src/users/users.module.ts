import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { MongooseModule } from '@nestjs/mongoose';
import { UserModel } from './schema/user.model';
import { EmailModule } from 'src/notifications/email/email.module';
import { PasswordSecurityService } from 'src/authentication/security/password-security.service';

@Module({
	imports: [
		MongooseModule.forFeature([{ name: 'User', schema: UserModel.schema }]),
		EmailModule,
	],
	providers: [UsersService, PasswordSecurityService],
	exports: [UsersService, MongooseModule],
})
export class UsersModule {}
