import { Module } from '@nestjs/common';
import { ProfileService } from './profile.service';
import { ProfileController } from './profile.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { ProfileModel } from './schema/profile.model';
import { UserModel } from 'src/users/schema/user.model';
import { PermissionModel } from 'src/permissions/schema/permissions.model';

@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'Profile', schema: ProfileModel.schema },
			{ name: 'User', schema: UserModel.schema },
			{ name: 'Permission', schema: PermissionModel.schema },
		]),
	],
	providers: [ProfileService],
	controllers: [ProfileController],
	exports: [ProfileService],
})
export class ProfileModule {}
