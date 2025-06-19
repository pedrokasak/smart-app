import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateProfileDto } from './dto/create-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { User } from 'src/users/schema/user.model';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Profile, ProfileModel } from './schema/profile.model';
import { Permission } from 'src/permissions/schema/permissions.model';
import { ProfileErrorService } from 'src/utils/errors-handler';

@Injectable()
export class ProfileService {
	constructor(
		@InjectModel('Profile') private readonly profileModel: Model<Profile>,
		@InjectModel('User') private readonly userModel: Model<User>,
		@InjectModel('Permission')
		private readonly permissionModel: Model<Permission>
	) {}
	async create(createProfileDto: CreateProfileDto) {
		const { cpf, userId, permissions } = createProfileDto;

		const findUser = await this.userModel
			.find({
				id: userId,
			})
			.exec();

		if (!findUser)
			throw new NotFoundException(`User with ID ${userId} not found`);

		if (permissions) {
			const findPermissions = await this.permissionModel
				.find({
					_id: { $in: permissions },
				})
				.exec();
			if (findPermissions.length !== permissions.length) {
				throw new NotFoundException('Some permissions were not found');
			}
		}
		if (cpf) {
			const findCpf = await this.profileModel.findOne({ cpf });
			if (findCpf) {
				ProfileErrorService.handleCpfAlreadyExists(cpf);
			}
		}
		// if (!findPermission)
		// 	throw new NotFoundException(`User with ID ${findPermission} not found`);

		const profile = new ProfileModel({
			cpf,
			user: userId,
			permissions,
		});

		await profile.save();

		return { message: 'Profile created successfully', data: profile };
	}

	findAll() {
		return this.profileModel.find().populate('addresses');
	}

	findOne(id: string) {
		return this.profileModel.findById(id).populate('addresses');
	}

	update(id: number, updateProfileDto: UpdateProfileDto) {
		// Remove o campo address se vier no DTO por engano
		const dto = { ...updateProfileDto };
		delete (dto as any).address;
		return this.profileModel.findByIdAndUpdate(id, dto, {
			new: true,
		});
	}

	remove(id: number) {
		return this.profileModel.findByIdAndDelete(id);
	}
}
