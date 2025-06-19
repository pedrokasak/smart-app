import { Module } from '@nestjs/common';
import { ProfileService } from './profile.service';
import { ProfileController } from './profile.controller';
import { AddressService } from './address.service';
import { AddressController } from './address.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { ProfileModel } from './schema/profile.model';
import { AddressModel } from './schema/address.model';
import { UserModel } from 'src/users/schema/user.model';
import { PermissionModel } from 'src/permissions/schema/permissions.model';

@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'Profile', schema: ProfileModel.schema },
			{ name: 'Address', schema: AddressModel.schema },
			{ name: 'User', schema: UserModel.schema },
			{ name: 'Permission', schema: PermissionModel.schema },
		]),
	],
	providers: [ProfileService, AddressService],
	controllers: [ProfileController, AddressController],
	exports: [ProfileService, AddressService],
})
export class ProfileModule {}
