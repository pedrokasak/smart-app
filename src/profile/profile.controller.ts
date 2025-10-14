import {
	Controller,
	Get,
	Post,
	Body,
	Patch,
	Param,
	Delete,
	UseGuards,
} from '@nestjs/common';
import { ProfileService } from './profile.service';
import { CreateProfileDto } from './dto/create-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import { ApiOkResponse, ApiResponse, ApiTags } from '@nestjs/swagger';

@Controller('profile')
export class ProfileController {
	constructor(private readonly profileService: ProfileService) {}

	@Post('create')
	@UseGuards(JwtAuthGuard)
	@ApiTags('profile')
	create(@Body() createProfileDto: CreateProfileDto) {
		return this.profileService.create(createProfileDto);
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
	findOne(@Param('id') id: string) {
		return this.profileService.findOne(id);
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
