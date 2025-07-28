import {
	Injectable,
	BadRequestException,
	InternalServerErrorException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Address, AddressModel, AddressType } from './schema/address.model';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { ZipCodeResponseDto } from './dto/zipcode-response.dto';
import axios from 'axios';

@Injectable()
export class AddressService {
	constructor(
		@InjectModel(AddressModel.name) private addressModel: Model<Address>
	) {}

	async create(createAddressDto: CreateAddressDto): Promise<Address> {
		const { userId, type } = createAddressDto;

		// Verifica se já existe um endereço do mesmo tipo para o usuário
		const existingAddress = await this.addressModel.findOne({
			userId: new Types.ObjectId(userId),
			type,
		});

		if (existingAddress) {
			// Atualiza o endereço existente
			Object.assign(existingAddress, createAddressDto);
			return existingAddress.save();
		}

		// Cria um novo endereço
		const newAddress = new this.addressModel({
			...createAddressDto,
			userId: new Types.ObjectId(userId),
		});

		return newAddress.save();
	}

	async findAll(): Promise<Address[]> {
		return this.addressModel.find().exec();
	}

	async findByUserId(userId: string): Promise<Address[]> {
		return this.addressModel
			.find({ userId: new Types.ObjectId(userId) })
			.exec();
	}

	async findByUserIdAndType(
		userId: string,
		type: AddressType
	): Promise<Address> {
		return this.addressModel
			.findOne({
				userId: new Types.ObjectId(userId),
				type,
			})
			.exec();
	}

	async findOne(id: string): Promise<Address> {
		return this.addressModel.findById(id).exec();
	}

	async update(
		id: string,
		updateAddressDto: UpdateAddressDto
	): Promise<Address> {
		return this.addressModel
			.findByIdAndUpdate(id, updateAddressDto, { new: true })
			.exec();
	}

	async remove(id: string): Promise<Address> {
		return this.addressModel.findByIdAndDelete(id).exec();
	}

	async findByZipCode(zipCode: string): Promise<ZipCodeResponseDto> {
		// Valida o formato do CEP antes de fazer a requisição
		if (!this.validateZipCode(zipCode)) {
			throw new BadRequestException(
				'Formato de CEP inválido. Use o formato 00000-000 ou 00000000'
			);
		}

		// Remove caracteres não numéricos do CEP
		const cleanZipCode = zipCode.replace(/\D/g, '');

		try {
			// Faz a requisição para a API ViaCEP
			const response = await axios.get(
				`https://viacep.com.br/ws/${cleanZipCode}/json/`
			);
			const data = response.data;

			// Verifica se a API retornou um erro
			if (data.erro) {
				throw new BadRequestException('CEP não encontrado');
			}

			// Retorna os dados formatados como ZipCodeResponseDto
			const result: ZipCodeResponseDto = {
				zipCode: data.cep,
				street: data.logradouro,
				complement: data.complemento,
				neighborhood: data.bairro,
				city: data.localidade,
				state: data.uf,
			};

			return result;
		} catch (error) {
			// Verifica se é um erro já tratado
			if (error instanceof BadRequestException) {
				throw error;
			}

			// Trata erros de conexão ou da API
			console.error('Erro ao buscar CEP:', error.message);
			throw new InternalServerErrorException(
				'Erro ao consultar o serviço de CEP'
			);
		}
	}

	validateZipCode(zipCode: string): boolean {
		// Valida se o CEP está no formato 00000-000 ou 00000000
		return /^\d{5}-?\d{3}$/.test(zipCode);
	}

	/**
	 * Preenche automaticamente um objeto CreateAddressDto com os dados do CEP
	 * @param zipCode CEP no formato 00000-000 ou 00000000
	 * @param createAddressDto Objeto parcialmente preenchido com dados do endereço
	 * @returns CreateAddressDto com os dados do endereço preenchidos a partir do CEP
	 */
	async fillAddressFromZipCode(
		zipCode: string,
		createAddressDto: Partial<CreateAddressDto>
	): Promise<CreateAddressDto> {
		// Busca os dados do CEP
		const zipCodeData = await this.findByZipCode(zipCode);

		// Cria um novo objeto com os dados do CEP e os dados fornecidos
		const filledAddress: CreateAddressDto = {
			...(createAddressDto as CreateAddressDto),
			street: zipCodeData.street,
			neighborhood: zipCodeData.neighborhood,
			city: zipCodeData.city,
			state: zipCodeData.state,
			zipCode: zipCodeData.zipCode,
			// Mantém o complemento fornecido ou usa o do CEP se não foi fornecido
			complement: createAddressDto.complement || zipCodeData.complement,
		};

		return filledAddress;
	}
}
