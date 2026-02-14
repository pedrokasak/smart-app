import {
	ConflictException,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import { CreateProfileDto } from './dto/create-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
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
		const existingProfile = await this.profileModel.findOne({ user: userId });
		if (existingProfile) {
			throw new ConflictException(
				`Profile already exists for user ${userId}. Use PATCH to update it.`
			);
		}

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
		// Valida se userId é um ObjectId válido
		if (!Types.ObjectId.isValid(userId)) {
			throw new NotFoundException(`Invalid user ID format: ${typeof userId}`);
		}

		const profile = await this.profileModel
			.findOne({ user: userId })
			.populate('user')
			.exec();

		if (!profile) {
			throw new NotFoundException(`Profile for user ${userId} not found`);
		}

		return profile;
	}

	async update(id: string, updateProfileDto: UpdateProfileDto) {
		if (!Types.ObjectId.isValid(id)) {
			throw new NotFoundException(`Invalid profile ID format: ${id}`);
		}

		const profile = await this.profileModel.findById(id);
		if (!profile) {
			throw new NotFoundException(`Profile with ID ${id} not found`);
		}

		const { ...dto } = updateProfileDto;

		const updated = await this.profileModel
			.findByIdAndUpdate(id, dto, { new: true })
			.populate('user')
			.exec();

		if (!updated) {
			throw new NotFoundException(`Profile with ID ${id} not found`);
		}
		return updated;
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
