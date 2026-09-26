import {
	Controller,
	Get,
	Body,
	Patch,
	Param,
	Delete,
	UseGuards,
	Post,
	BadRequestException,
	Request,
	UploadedFile,
	UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { join } from 'path';
import { writeFile } from 'fs/promises';
import { mkdirSync } from 'fs';
import * as crypto from 'crypto';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Role } from 'src/auth/enums/role.enum';
import {
	detectImageKind,
	extensionForImageKind,
} from 'src/profile/security/avatar-file.validator';
import { UserModel } from 'src/users/schema/user.model';
import { ProfileService } from './profile.service';
import { CreateProfileDto } from './dto/create-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import {
	ApiBearerAuth,
	ApiOkResponse,
	ApiResponse,
	ApiTags,
} from '@nestjs/swagger';
import { ProfileResponseDto } from 'src/profile/dto/profile-response.dto';
import { ProfileMapper } from 'src/profile/mappers/profile.mapper';

import { OwnershipChecked } from 'src/auth/decorators/ownership.decorator';
import {
	assertSelfOrAdmin,
	isAdminRequest,
	requesterIdOf,
} from 'src/auth/ownership';
/**
 * Perfil só é acessível pelo próprio dono — admin é a única exceção
 * (TRA-89). Antes disso todas as rotas `:id` aceitavam qualquer JWT válido,
 * o que expunha (e permitia alterar e apagar) o perfil de qualquer usuário.
 *
 * Cuidado ao mexer: `:id` é o id do USUÁRIO em `GET /profile/:id` e o id do
 * PERFIL em `PATCH`/`DELETE`. Por isso são duas checagens diferentes, e não
 * uma só reaproveitada.
 */

@Controller('profile')
@ApiTags('profile')
@ApiBearerAuth('access-token')
export class ProfileController {
	constructor(private readonly profileService: ProfileService) {}

	/** Upload de foto de perfil */
	@Post('avatar')
	@UseGuards(JwtAuthGuard)
	@UseInterceptors(
		// Vai pra memória, não direto pro disco: só depois de conferir os magic
		// bytes o arquivo é gravado, e com a extensão derivada do conteúdo real
		// em vez do nome enviado pelo cliente (TRA-89).
		FileInterceptor('file', {
			storage: memoryStorage(),
			limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
		})
	)
	async uploadAvatar(@UploadedFile() file: any, @Request() req: any) {
		if (!file) throw new BadRequestException('Arquivo não enviado.');

		const buffer = Buffer.from(file.buffer || '');
		const kind = detectImageKind(buffer);
		if (kind === 'unknown') {
			throw new BadRequestException(
				'Apenas imagens JPG, PNG ou WebP são permitidas.'
			);
		}

		const fileName = `${crypto.randomUUID()}${extensionForImageKind(kind)}`;
		const destination = join(process.cwd(), 'uploads', 'avatars');
		mkdirSync(destination, { recursive: true });
		await writeFile(join(destination, fileName), buffer);

		const userId = req.user?.userId || req.user?.sub;
		const avatarUrl = `/uploads/avatars/${fileName}`;
		await UserModel.findByIdAndUpdate(userId, { avatar: avatarUrl });
		return { avatarUrl };
	}

	@OwnershipChecked('assertSelfOrAdmin no userId da rota')
	@Post('create/:id')
	@UseGuards(JwtAuthGuard)
	@ApiOkResponse({ type: CreateProfileDto, description: 'Success' })
	@ApiResponse({ status: 403, description: 'Forbidden.' })
	@ApiResponse({ status: 401, description: 'Unauthorized.' })
	@ApiResponse({ status: 200, description: 'Ok.' })
	create(
		@Param('id') userId: string,
		@Body() createProfileDto: CreateProfileDto,
		@Request() req: any
	) {
		assertSelfOrAdmin(req, userId);
		if (!createProfileDto.userId) {
			throw new BadRequestException('userId é obrigatório');
		}
		return this.profileService.create(userId, createProfileDto);
	}

	@Get('me')
	@UseGuards(JwtAuthGuard)
	@ApiOkResponse({
		type: ProfileResponseDto,
		description: 'Perfil do usuário autenticado',
	})
	@ApiResponse({ status: 401, description: 'Unauthorized.' })
	async getMyProfile(@Request() req: any): Promise<ProfileResponseDto> {
		const userId = req.user?.userId || req.user?.sub;
		const profile = await this.profileService.findOne(userId);
		return ProfileMapper.toResponseDto(profile);
	}

	@Get()
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.Admin)
	@ApiResponse({ status: 403, description: 'Forbidden.' })
	@ApiResponse({ status: 401, description: 'Unauthorized.' })
	@ApiResponse({ status: 200, description: 'Ok.' })
	@ApiOkResponse({ type: [CreateProfileDto], description: 'Success' })
	findAll() {
		return this.profileService.findAll();
	}

	@OwnershipChecked('assertProfileOwnership')
	@Get(':id')
	@UseGuards(JwtAuthGuard)
	@ApiOkResponse({ type: CreateProfileDto, description: 'Success' })
	@ApiResponse({ status: 403, description: 'Forbidden.' })
	@ApiResponse({ status: 401, description: 'Unauthorized.' })
	@ApiResponse({ status: 200, description: 'Ok.' })
	async findOne(
		@Param('id') id: string,
		@Request() req: any
	): Promise<ProfileResponseDto> {
		assertSelfOrAdmin(req, id);
		const profile = await this.profileService.findOne(id);
		return ProfileMapper.toResponseDto(profile);
	}

	@OwnershipChecked('assertProfileOwnership')
	@Patch(':id')
	@UseGuards(JwtAuthGuard)
	@ApiOkResponse({ type: CreateProfileDto, description: 'Success' })
	@ApiResponse({ status: 403, description: 'Forbidden.' })
	@ApiResponse({ status: 401, description: 'Unauthorized.' })
	@ApiResponse({ status: 200, description: 'Ok.' })
	async update(
		@Param('id') id: string,
		@Body() updateProfileDto: UpdateProfileDto,
		@Request() req: any
	) {
		// Aqui `:id` é o id do PERFIL, não o do usuário — a posse só dá pra
		// decidir carregando o documento.
		await this.profileService.assertProfileOwnership(
			id,
			requesterIdOf(req),
			isAdminRequest(req)
		);
		return this.profileService.update(id, updateProfileDto);
	}

	@OwnershipChecked('assertProfileOwnership')
	@Delete('remove/:id')
	@UseGuards(JwtAuthGuard)
	@ApiOkResponse({ type: CreateProfileDto, description: 'Success' })
	@ApiResponse({ status: 404, description: 'Not Found.' })
	@ApiResponse({ status: 403, description: 'Forbidden.' })
	@ApiResponse({ status: 401, description: 'Unauthorized.' })
	@ApiResponse({ status: 200, description: 'Ok.' })
	async remove(@Param('id') id: string, @Request() req: any) {
		await this.profileService.assertProfileOwnership(
			id,
			requesterIdOf(req),
			isAdminRequest(req)
		);
		return this.profileService.remove(id);
	}
}
