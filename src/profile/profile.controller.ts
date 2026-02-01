import {
	Controller,
	Get,
	Body,
	Patch,
	Param,
	Delete,
	UseGuards,
	Req,
	Post,
} from '@nestjs/common';
import { ProfileService } from './profile.service';
import { CreateProfileDto } from './dto/create-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import { ApiOkResponse, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ProfileResponseDto } from 'src/profile/dto/profile-response.dto';
import { ProfileMapper } from 'src/profile/mappers/profile.mapper';

@Controller('profile')
@ApiTags('profile')
export class ProfileController {
	constructor(private readonly profileService: ProfileService) {}

	@Post(':id')
	@UseGuards(JwtAuthGuard)
	@ApiOkResponse({ type: CreateProfileDto, description: 'Success' })
	@ApiResponse({ status: 403, description: 'Forbidden.' })
	@ApiResponse({ status: 401, description: 'Unauthorized.' })
	@ApiResponse({ status: 200, description: 'Ok.' })
	create(
		@Param('id') userId: string,
		@Body() createProfileDto: CreateProfileDto
	) {
		return this.profileService.create(userId, createProfileDto);
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
	async findOne(@Req() req: any): Promise<ProfileResponseDto> {
		const profile = await this.profileService.findOne(req.user.id);
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
