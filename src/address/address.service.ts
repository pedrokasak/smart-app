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
import { firstValueFrom } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { HttpService } from '@nestjs/axios';

@Injectable()
export class AddressService {
	constructor(
		@InjectModel(AddressModel.name) private addressModel: Model<Address>,
		private readonly httpService: HttpService
	) {}

	async create(createAddressDto: CreateAddressDto): Promise<Address> {
		const { userId, type } = createAddressDto;

		const existingAddress = await this.addressModel.findOne({
			userId: new Types.ObjectId(userId),
			type,
		});

		if (existingAddress) {
			Object.assign(existingAddress, createAddressDto);
			return existingAddress.save();
		}

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
		if (!this.validateZipCode(zipCode)) {
			throw new BadRequestException('Formato de CEP inválido');
		}

		try {
			const response = await firstValueFrom(
				this.httpService.get(`https://viacep.com.br/ws/${zipCode}/json/`).pipe(
					map((res) => res.data),
					catchError(() => {
						throw new InternalServerErrorException(
							'Erro ao consultar o serviço de CEP'
						);
					})
				)
			);

			if (response.erro) {
				throw new BadRequestException('CEP não encontrado');
			}

			return {
				zipCode: response.cep,
				street: response.logradouro,
				complement: response.complemento,
				neighborhood: response.bairro,
				city: response.localidade,
				state: response.uf,
			};
		} catch (error) {
			if (
				error instanceof BadRequestException ||
				error instanceof InternalServerErrorException
			) {
				throw error;
			}
			throw new InternalServerErrorException(
				'Erro ao consultar o serviço de CEP'
			);
		}
	}

	validateZipCode(zipCode: string): boolean {
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
		const zipCodeData = await this.findByZipCode(zipCode);

		const filledAddress: CreateAddressDto = {
			...(createAddressDto as CreateAddressDto),
			street: zipCodeData.street,
			neighborhood: zipCodeData.neighborhood,
			city: zipCodeData.city,
			state: zipCodeData.state,
			zipCode: zipCodeData.zipCode,
			complement: createAddressDto.complement || zipCodeData.complement,
		};

		return filledAddress;
	}
}
