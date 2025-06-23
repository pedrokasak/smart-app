import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Address, AddressType } from './schema/address.model';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { User } from 'src/users/schema/user.model';

@Injectable()
export class AddressService {
	constructor(
		@InjectModel('Address') private readonly addressModel: Model<Address>,
		@InjectModel('User') private readonly userModel: Model<User>
	) {}

	async create(
		userId: string,
		createAddressDto: CreateAddressDto
	): Promise<Address> {
		const user = await this.userModel.findById(userId);
		if (!user) {
			throw new NotFoundException(`User with ID ${userId} not found`);
		}

		// Check if user already has an address
		const existingAddress = await this.addressModel.findOne({ userId });
		if (existingAddress) {
			// Update existing address
			const updatedAddress = await this.addressModel.findByIdAndUpdate(
				existingAddress._id,
				createAddressDto,
				{ new: true }
			);
			return updatedAddress;
		}

		// Create new address and link it to user
		const newAddress = new this.addressModel({
			...createAddressDto,
			userId: user._id.toString(),
		});
		await newAddress.save();

		return newAddress;
	}

	async findAll(): Promise<Address[]> {
		return await this.addressModel.find().sort({
			createdAt: -1,
		});
	}

	async findOne(userId: string): Promise<Address> {
		const address = await this.addressModel.findOne({ userId });
		if (!address) {
			throw new NotFoundException(
				`Endereço para usuário com ID ${userId} não encontrado`
			);
		}
		return address;
	}

	async findByType(userId: string, type: AddressType): Promise<Address[]> {
		return await this.addressModel.find({ userId, type }).sort({
			createdAt: -1,
		});
	}

	async update(
		userId: string,
		updateAddressDto: UpdateAddressDto
	): Promise<Address> {
		const address = await this.findOne(userId);
		const { ...updateData } = updateAddressDto;

		Object.assign(address, updateData);
		return await address.save();
	}

	async remove(userId: string): Promise<void> {
		const address = await this.addressModel.findOne({ userId });
		if (!address) {
			throw new NotFoundException(
				`Address for user with ID ${userId} not found`
			);
		}

		await this.addressModel.findByIdAndDelete(address._id);
	}

	// Método para validar CEP (pode ser integrado com API externa)
	async validateZipCode(zipCode: string): Promise<boolean> {
		const zipCodeRegex = /^\d{5}-?\d{3}$/;
		return zipCodeRegex.test(zipCode);
	}

	// Método para buscar endereços por CEP (pode usar API ViaCEP)
	async searchByZipCode(): Promise<any> {
		// Aqui você pode integrar com API como ViaCEP
		// Por enquanto, retorna null
		return null;
	}
}
