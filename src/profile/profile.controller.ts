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
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import * as crypto from 'crypto';
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

@Controller('profile')
@ApiTags('profile')
@ApiBearerAuth('access-token')
export class ProfileController {
	constructor(private readonly profileService: ProfileService) {}

	/** Upload de foto de perfil */
	@Post('avatar')
	@UseGuards(JwtAuthGuard)
	@UseInterceptors(
		FileInterceptor('file', {
			storage: diskStorage({
				destination: join(process.cwd(), 'uploads', 'avatars'),
				filename: (_req, file, cb) => {
					const uniqueName = `${crypto.randomUUID()}${extname(file.originalname)}`;
					cb(null, uniqueName);
				},
			}),
			fileFilter: (_req, file, cb) => {
				if (!file.mimetype.match(/\/(jpg|jpeg|png|webp)$/)) {
					return cb(
						new BadRequestException(
							'Apenas imagens JPG, PNG ou WebP são permitidas.'
						),
						false
					);
				}
				cb(null, true);
			},
			limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
		})
	)
	async uploadAvatar(@UploadedFile() file: any, @Request() req: any) {
		if (!file) throw new BadRequestException('Arquivo não enviado.');
		const userId = req.user?.userId || req.user?.sub;
		const avatarUrl = `/uploads/avatars/${file.filename}`;
		await UserModel.findByIdAndUpdate(userId, { avatar: avatarUrl });
		return { avatarUrl };
	}

	@UseGuards(JwtAuthGuard)
	@ApiOkResponse({ type: CreateProfileDto, description: 'Success' })
	@ApiResponse({ status: 403, description: 'Forbidden.' })
	@ApiResponse({ status: 401, description: 'Unauthorized.' })
	@ApiResponse({ status: 200, description: 'Ok.' })
	create(
		@Param('id') userId: string,
		@Body() createProfileDto: CreateProfileDto
	) {
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
	@UseGuards(JwtAuthGuard)
	@ApiResponse({ status: 403, description: 'Forbidden.' })
	@ApiResponse({ status: 401, description: 'Unauthorized.' })
	@ApiResponse({ status: 200, description: 'Ok.' })
	@ApiOkResponse({ type: [CreateProfileDto], description: 'Success' })
	findAll() {
		return this.profileService.findAll();
	}

	@Get(':id')
	@UseGuards(JwtAuthGuard)
	@ApiOkResponse({ type: CreateProfileDto, description: 'Success' })
	@ApiResponse({ status: 403, description: 'Forbidden.' })
	@ApiResponse({ status: 401, description: 'Unauthorized.' })
	@ApiResponse({ status: 200, description: 'Ok.' })
	async findOne(@Param('id') id: string): Promise<ProfileResponseDto> {
		const profile = await this.profileService.findOne(id);
		return ProfileMapper.toResponseDto(profile);
	}

	@Patch(':id')
	@UseGuards(JwtAuthGuard)
	@ApiOkResponse({ type: CreateProfileDto, description: 'Success' })
	@ApiResponse({ status: 403, description: 'Forbidden.' })
	@ApiResponse({ status: 401, description: 'Unauthorized.' })
	@ApiResponse({ status: 200, description: 'Ok.' })
	update(@Param('id') id: string, @Body() updateProfileDto: UpdateProfileDto) {
		return this.profileService.update(id, updateProfileDto);
	}

	@Delete('remove/:id')
	@UseGuards(JwtAuthGuard)
	@ApiOkResponse({ type: CreateProfileDto, description: 'Success' })
	@ApiResponse({ status: 404, description: 'Not Found.' })
	@ApiResponse({ status: 403, description: 'Forbidden.' })
	@ApiResponse({ status: 401, description: 'Unauthorized.' })
	@ApiResponse({ status: 200, description: 'Ok.' })
	remove(@Param('id') id: string) {
		return this.profileService.remove(id);
	}

	@Delete('remove/all')
	@UseGuards(JwtAuthGuard)
	@ApiOkResponse({ type: CreateProfileDto, description: 'Success' })
	@ApiResponse({ status: 404, description: 'Not Found.' })
	@ApiResponse({ status: 403, description: 'Forbidden.' })
	@ApiResponse({ status: 401, description: 'Unauthorized.' })
	@ApiResponse({ status: 200, description: 'Ok.' })
	removeAll() {
		return this.profileService.removeAll();
	}
}
