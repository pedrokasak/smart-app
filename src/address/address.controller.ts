import {
	Controller,
	Get,
	Post,
	Body,
	Param,
	Delete,
	UseGuards,
	Put,
	Req,
} from '@nestjs/common';
import {
	assertSelfOrAdmin,
	isAdminRequest,
	requesterIdOf,
} from 'src/auth/ownership';
import {
	ApiTags,
	ApiOperation,
	ApiResponse,
	ApiBearerAuth,
	ApiParam,
} from '@nestjs/swagger';
import { AddressService } from './address.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { AddressResponseDto } from './dto/address-response.dto';
import { ZipCodeResponseDto } from './dto/zipcode-response.dto';
import { AddressType } from './schema/address.model';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import { ZipCodeValidationPipe } from 'src/address/pipes/zipcode-validation.pipe';

@ApiTags('addresses')
@Controller('addresses')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AddressController {
	constructor(private readonly addressService: AddressService) {}

	@Get()
	@ApiOperation({ summary: 'Listar os endereços do usuário autenticado' })
	@ApiResponse({
		status: 200,
		description: 'Lista de endereços retornada com sucesso',
		type: [AddressResponseDto],
	})
	async findAll(@Req() req: any) {
		return this.addressService.findByUserId(requesterIdOf(req));
	}

	@Get('user/:userId')
	@ApiOperation({ summary: 'Buscar endereços por ID do usuário' })
	@ApiResponse({
		status: 200,
		description: 'Endereços do usuário retornados com sucesso',
		type: [AddressResponseDto],
	})
	async findByUserId(@Param('userId') userId: string, @Req() req: any) {
		assertSelfOrAdmin(req, userId);
		return this.addressService.findByUserId(userId);
	}

	@Get('user/:userId/type/:type')
	@ApiOperation({ summary: 'Buscar endereço por ID do usuário e tipo' })
	@ApiResponse({
		status: 200,
		description: 'Endereço retornado com sucesso',
		type: AddressResponseDto,
	})
	async findByUserIdAndType(
		@Param('userId') userId: string,
		@Param('type') type: AddressType,
		@Req() req: any
	) {
		assertSelfOrAdmin(req, userId);
		return this.addressService.findByUserIdAndType(userId, type);
	}

	@Get(':id')
	@ApiOperation({ summary: 'Buscar endereço por ID' })
	@ApiResponse({
		status: 200,
		description: 'Endereço retornado com sucesso',
		type: AddressResponseDto,
	})
	async findOne(@Param('id') id: string, @Req() req: any) {
		return this.addressService.findOwned(
			id,
			requesterIdOf(req),
			isAdminRequest(req)
		);
	}

	@Post()
	@ApiOperation({ summary: 'Criar ou atualizar endereço' })
	@ApiResponse({
		status: 201,
		description: 'Endereço criado com sucesso',
		type: AddressResponseDto,
	})
	async create(@Body() createAddressDto: CreateAddressDto, @Req() req: any) {
		// O dono é sempre quem está logado; `userId` do corpo só vale para admin.
		const userId = isAdminRequest(req)
			? createAddressDto.userId || requesterIdOf(req)
			: requesterIdOf(req);
		return this.addressService.create({ ...createAddressDto, userId });
	}

	@Put(':id')
	@ApiOperation({ summary: 'Atualizar endereço por ID' })
	@ApiResponse({
		status: 200,
		description: 'Endereço atualizado com sucesso',
		type: AddressResponseDto,
	})
	async update(
		@Param('id') id: string,
		@Body() updateAddressDto: UpdateAddressDto,
		@Req() req: any
	) {
		await this.addressService.findOwned(
			id,
			requesterIdOf(req),
			isAdminRequest(req)
		);
		// Trocar o dono do endereço pelo corpo não é permitido.
		const changes = { ...updateAddressDto };
		delete changes.userId;
		return this.addressService.update(id, changes);
	}

	@Delete(':id')
	@ApiOperation({ summary: 'Remover endereço por ID' })
	@ApiResponse({
		status: 200,
		description: 'Endereço removido com sucesso',
		type: AddressResponseDto,
	})
	async remove(@Param('id') id: string, @Req() req: any) {
		await this.addressService.findOwned(
			id,
			requesterIdOf(req),
			isAdminRequest(req)
		);
		return this.addressService.remove(id);
	}

	@Get('zipcode/:zipCode')
	@ApiOperation({
		summary: 'Buscar endereço por CEP',
		description:
			'Retorna informações de endereço a partir de um CEP utilizando a API ViaCEP',
	})
	@ApiParam({
		name: 'zipCode',
		description: 'CEP no formato 00000-000 ou 00000000',
		example: '01001000',
		required: true,
	})
	@ApiResponse({
		status: 200,
		description: 'Informações do CEP retornadas com sucesso',
		type: ZipCodeResponseDto,
	})
	@ApiResponse({
		status: 400,
		description: 'Formato de CEP inválido ou CEP não encontrado',
	})
	@ApiResponse({
		status: 500,
		description: 'Erro ao consultar o serviço de CEP',
	})
	async findByZipCode(
		@Param('zipCode', ZipCodeValidationPipe) zipCode: string
	) {
		return this.addressService.findByZipCode(zipCode);
	}

	@Post('fill-from-zipcode/:zipCode')
	@ApiOperation({ summary: 'Preencher endereço a partir do CEP' })
	@ApiParam({
		name: 'zipCode',
		description: 'CEP no formato 00000-000 ou 00000000',
		example: '01001000',
	})
	@ApiResponse({
		status: 200,
		description: 'Endereço preenchido com sucesso',
		type: CreateAddressDto,
	})
	@ApiResponse({
		status: 400,
		description: 'Formato de CEP inválido ou CEP não encontrado',
	})
	@ApiResponse({
		status: 500,
		description: 'Erro ao consultar o serviço de CEP',
	})
	async fillAddressFromZipCode(
		@Param('zipCode') zipCode: string,
		@Body() createAddressDto: Partial<CreateAddressDto>
	) {
		return this.addressService.fillAddressFromZipCode(
			zipCode,
			createAddressDto
		);
	}
}
