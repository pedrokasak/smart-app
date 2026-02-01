import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateProfileDto } from './dto/create-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Profile } from './schema/profile.model';

@Injectable()
export class ProfileService {
	constructor(
		@InjectModel('Profile') private readonly profileModel: Model<Profile>
	) {}

	async create(
		userId: string,
		createProfileDto: CreateProfileDto
	): Promise<Profile> {
		return this.profileModel.create({
			user: userId,
			...createProfileDto,
			isProfileComplete: this.isProfileComplete(createProfileDto),
		});
	}

	async findAll() {
		return await this.profileModel.find().exec();
	}

	async findOne(userId: string): Promise<Profile> {
		const profile = await this.profileModel.findOne({ user: userId }).exec();
		if (!profile) {
			throw new NotFoundException(`Profile for user ${userId} not found`);
		}

		return this.profileModel.findOne({ user: userId }).exec();
	}

	async update(id: string, updateProfileDto: UpdateProfileDto) {
		const dto = { ...updateProfileDto };

		const userId = updateProfileDto.userId;
		const profile = await this.profileModel.findById(id);
		if (!profile) {
			throw new NotFoundException(`Profile with ID ${id} not found`);
		}

		delete (dto as any).address;
		return this.profileModel
			.findOneAndUpdate({ user: userId }, updateProfileDto, { new: true })
			.exec();
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
	private isProfileComplete(profile: CreateProfileDto): boolean {
		return !!(profile.phone && profile.address && profile.birthDate);
	}
}
