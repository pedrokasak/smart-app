import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateProfileDto } from './dto/create-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { User } from 'src/users/schema/user.model';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Profile, ProfileModel } from './schema/profile.model';
import { Permission } from 'src/permissions/schema/permissions.model';
import { ProfileErrorService } from 'src/utils/errors-handler';
import Cpf from 'src/profile/entity/cpf';

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
			new Cpf(cpf);
			if (findCpf) {
				ProfileErrorService.handleCpfAlreadyExists(cpf);
			}
		}

		const profile = new ProfileModel({
			cpf,
			user: userId,
			permissions,
		});

		await profile.save();

		return { message: 'Profile created successfully', data: profile };
	}

	async findAll() {
		return await this.profileModel.find();
	}

	async findOne(userId: string) {
		const profile = await this.profileModel.findOne({ user: userId });
		if (!profile) {
			throw new NotFoundException(`Profile for user ${userId} not found`);
		}

		return {
			profile,
		};
	}

	async update(id: string, updateProfileDto: UpdateProfileDto) {
		const dto = { ...updateProfileDto };

		try {
			new Cpf(dto.cpf);
		} catch (error) {
			ProfileErrorService.handleInvalidCpf(dto.cpf);
		}

		const profile = await this.profileModel.findById(id);
		if (!profile) {
			throw new NotFoundException(`Profile with ID ${id} not found`);
		}

		delete (dto as any).address;
		return this.profileModel.findByIdAndUpdate(id, dto, {
			new: true,
		});
	}

	async remove(profileId: string) {
		const deleted = await this.profileModel.findByIdAndDelete(profileId);
		if (!deleted) {
			throw new NotFoundException(`Profile with ID ${profileId} not found`);
		}
		return { message: `Profile deleted successfully`, id: profileId };
	}

	async removeAll(): Promise<void> {
		await this.profileModel.deleteMany();
	}
}
