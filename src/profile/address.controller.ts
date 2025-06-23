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

	@Get()
	@ApiOperation({ summary: 'Buscar todos os endereços' })
	@ApiResponse({
		status: 200,
		description: 'Lista de endereços',
		type: [AddressResponseDto],
	})
	findAll() {
		return this.addressService.findAll();
	}

	@Get('user/:userId')
	@ApiOperation({ summary: 'Buscar o endereço de um usuário específico' })
	@ApiResponse({
		status: 200,
		description: 'Endereço do usuário',
		type: AddressResponseDto,
	})
	findByUser(@Param('userId') userId: string) {
		console.log('Received userId:', userId);
		return this.addressService.findOne(userId);
	}

	@Post('user/:userId')
	@ApiOperation({ summary: 'Criar ou atualizar o endereço de um usuário' })
	@ApiResponse({
		status: 201,
		description: 'Endereço criado/atualizado com sucesso',
		type: AddressResponseDto,
	})
	create(
		@Param('userId') userId: string,
		@Body() createAddressDto: CreateAddressDto
	) {
		return this.addressService.create(userId, createAddressDto);
	}

	@Get('user/:userId/type/:type')
	@ApiOperation({ summary: 'Buscar endereços por tipo' })
	@ApiResponse({
		status: 200,
		description: 'Lista de endereços por tipo',
		type: [AddressResponseDto],
	})
	findByType(
		@Param('userId') userId: string,
		@Param('type') type: AddressType
	) {
		return this.addressService.findByType(userId, type);
	}

	@Patch('user/:userId')
	@ApiOperation({ summary: 'Atualizar o endereço de um usuário' })
	@ApiResponse({
		status: 200,
		description: 'Endereço atualizado',
		type: AddressResponseDto,
	})
	update(
		@Param('userId') userId: string,
		@Body() updateAddressDto: UpdateAddressDto
	) {
		return this.addressService.update(userId, updateAddressDto);
	}

	@Delete('user/:userId')
	@ApiOperation({ summary: 'Remover o endereço de um usuário' })
	@ApiResponse({ status: 200, description: 'Endereço removido com sucesso' })
	remove(@Param('userId') userId: string) {
		return this.addressService.remove(userId);
	}
}
