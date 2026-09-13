import {
	ConflictException,
	ForbiddenException,
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

	/**
	 * Confere que o perfil pertence ao usuário do token (TRA-89).
	 *
	 * Existe porque `update` e `remove` são endereçados pelo id do PERFIL,
	 * não pelo id do usuário — o controller sozinho não consegue decidir
	 * a posse sem carregar o documento.
	 *
	 * Perfil inexistente e perfil alheio devolvem o mesmo erro: separar os
	 * dois entrega um oráculo de ids válidos.
	 */
	async assertProfileOwnership(
		profileId: string,
		requesterUserId: string,
		requesterIsAdmin = false
	): Promise<void> {
		if (requesterIsAdmin) return;

		if (!requesterUserId) {
			throw new ForbiddenException('Usuário não autenticado.');
		}
		if (!Types.ObjectId.isValid(profileId)) {
			throw new NotFoundException('Perfil não encontrado.');
		}

		const profile = await this.profileModel
			.findById(profileId)
			.select('user')
			.lean();

		if (!profile || String((profile as any).user) !== String(requesterUserId)) {
			throw new NotFoundException('Perfil não encontrado.');
		}
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

	private isProfileComplete(profile: CreateProfileDto): boolean {
		return !!(profile.phone && profile.address && profile.birthDate);
	}
}
