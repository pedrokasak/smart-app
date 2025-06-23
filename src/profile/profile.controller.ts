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

@Controller('profile')
export class ProfileController {
	constructor(private readonly profileService: ProfileService) {}

	@Post('create')
	@UseGuards(JwtAuthGuard)
	create(@Body() createProfileDto: CreateProfileDto) {
		return this.profileService.create(createProfileDto);
	}

	@Get()
	@UseGuards(JwtAuthGuard)
	findAll() {
		return this.profileService.findAll();
	}

	@Get(':id')
	@UseGuards(JwtAuthGuard)
	findOne(@Param('id') id: string) {
		return this.profileService.findOne(id);
	}

	@Patch(':id')
	@UseGuards(JwtAuthGuard)
	update(@Param('id') id: string, @Body() updateProfileDto: UpdateProfileDto) {
		return this.profileService.update(+id, updateProfileDto);
	}

	@Delete('remove/:id')
	@UseGuards(JwtAuthGuard)
	remove(@Param('id') id: string) {
		return this.profileService.remove(id);
	}

	@Delete('remove/all')
	@UseGuards(JwtAuthGuard)
	removeAll() {
		return this.removeAll();
	}
}
