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
import { AddressService } from './address.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { AddressResponseDto } from './dto/address-response.dto';
import { JwtAuthGuard } from '../authentication/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AddressType } from './schema/address.model';

@Controller('addresses')
@ApiTags('addresses')
@UseGuards(JwtAuthGuard)
export class AddressController {
	constructor(private readonly addressService: AddressService) {}

	@Post(':profileId')
	@ApiOperation({ summary: 'Criar um novo endereço para um perfil' })
	@ApiResponse({
		status: 201,
		description: 'Endereço criado com sucesso',
		type: AddressResponseDto,
	})
	create(
		@Param('profileId') profileId: string,
		@Body() createAddressDto: CreateAddressDto
	) {
		return this.addressService.create(profileId, createAddressDto);
	}

	@Get('profile/')
	@ApiOperation({ summary: 'Buscar todos os endereços de um perfil' })
	@ApiResponse({
		status: 200,
		description: 'Lista de endereços',
		type: [AddressResponseDto],
	})
	findAll() {
		return this.addressService.findAll();
	}

	@Get('profile/:profileId')
	@ApiOperation({ summary: 'Buscar todos os endereços de um perfil' })
	@ApiResponse({
		status: 200,
		description: 'Lista de endereços',
		type: [AddressResponseDto],
	})
	findAllByProfile(@Param('profileId') profileId: string) {
		return this.addressService.findAllByProfileId(profileId);
	}

	@Get('profile/:profileId/default')
	@ApiOperation({ summary: 'Buscar o endereço padrão de um perfil' })
	@ApiResponse({
		status: 200,
		description: 'Endereço padrão',
		type: AddressResponseDto,
	})
	findDefaultByProfile(@Param('profileId') profileId: string) {
		return this.addressService.findDefaultByProfile(profileId);
	}

	@Get('profile/:profileId/type/:type')
	@ApiOperation({ summary: 'Buscar endereços por tipo' })
	@ApiResponse({
		status: 200,
		description: 'Lista de endereços por tipo',
		type: [AddressResponseDto],
	})
	findByType(
		@Param('profileId') profileId: string,
		@Param('type') type: AddressType
	) {
		return this.addressService.findByType(profileId, type);
	}

	@Get(':id')
	@ApiOperation({ summary: 'Buscar um endereço específico' })
	@ApiResponse({
		status: 200,
		description: 'Endereço encontrado',
		type: AddressResponseDto,
	})
	findOne(@Param('id') id: string) {
		return this.addressService.findOne(id);
	}

	@Patch(':id')
	@ApiOperation({ summary: 'Atualizar um endereço' })
	@ApiResponse({
		status: 200,
		description: 'Endereço atualizado',
		type: AddressResponseDto,
	})
	update(@Param('id') id: string, @Body() updateAddressDto: UpdateAddressDto) {
		return this.addressService.update(id, updateAddressDto);
	}

	@Patch(':id/default')
	@ApiOperation({ summary: 'Definir um endereço como padrão' })
	@ApiResponse({
		status: 200,
		description: 'Endereço definido como padrão',
		type: AddressResponseDto,
	})
	setAsDefault(@Param('id') id: string) {
		return this.addressService.setAsDefault(id);
	}

	@Delete(':id')
	@ApiOperation({ summary: 'Remover um endereço' })
	@ApiResponse({ status: 200, description: 'Endereço removido com sucesso' })
	remove(@Param('id') id: string) {
		return this.addressService.remove(id);
	}

	@Delete('profile/:profileId/all')
	@ApiOperation({ summary: 'Remover todos os endereços de um perfil' })
	@ApiResponse({ status: 200, description: 'Todos os endereços removidos' })
	removeAllByProfile(@Param('profileId') profileId: string) {
		return this.addressService.removeAllByProfile(profileId);
	}
}
