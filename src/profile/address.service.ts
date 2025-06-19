import { Injectable, NotFoundException } from '@nestjs/common';
import { AddressModel, Address, AddressType } from './schema/address.model';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

@Injectable()
export class AddressService {
	async create(
		profileId: string,
		createAddressDto: CreateAddressDto
	): Promise<Address> {
		const { isDefault, ...addressData } = createAddressDto;

		if (isDefault) {
			await AddressModel.updateMany(
				{ profileId, isDefault: true },
				{ isDefault: false }
			);
		}

		const address = new AddressModel({
			...addressData,
			profileId,
			isDefault: isDefault || false,
		});

		return await address.save();
	}

	async findAll(): Promise<Address[]> {
		return await AddressModel.find().sort({
			isDefault: -1,
			createdAt: -1,
		});
	}

	async findAllByProfileId(profileId: string): Promise<Address[]> {
		return await AddressModel.find({ profileId }).sort({
			isDefault: -1,
			createdAt: -1,
		});
	}

	async findOne(id: string): Promise<Address> {
		const address = await AddressModel.findById(id);
		if (!address) {
			throw new NotFoundException(`Endereço com ID ${id} não encontrado`);
		}
		return address;
	}

	async findDefaultByProfile(profileId: string): Promise<Address | null> {
		return await AddressModel.findOne({ profileId, isDefault: true });
	}

	async findByType(profileId: string, type: AddressType): Promise<Address[]> {
		return await AddressModel.find({ profileId, type }).sort({
			isDefault: -1,
			createdAt: -1,
		});
	}

	async update(
		id: string,
		updateAddressDto: UpdateAddressDto
	): Promise<Address> {
		const address = await this.findOne(id);
		const { isDefault, ...updateData } = updateAddressDto;

		// Se este endereço será o padrão, remover o padrão dos outros
		if (isDefault) {
			await AddressModel.updateMany(
				{ profileId: address.profileId, isDefault: true, _id: { $ne: id } },
				{ isDefault: false }
			);
		}

		Object.assign(address, updateData);
		return await address.save();
	}

	async setAsDefault(id: string): Promise<Address> {
		const address = await this.findOne(id);

		// Remover o padrão dos outros endereços do mesmo perfil
		await AddressModel.updateMany(
			{ profileId: address.profileId, isDefault: true, _id: { $ne: id } },
			{ isDefault: false }
		);

		// Definir este como padrão
		address.isDefault = true;
		return await address.save();
	}

	async remove(id: string): Promise<void> {
		const address = await this.findOne(id);

		// Se for o endereço padrão, definir outro como padrão
		if (address.isDefault) {
			const otherAddress = await AddressModel.findOne({
				profileId: address.profileId,
				_id: { $ne: id },
			});

			if (otherAddress) {
				otherAddress.isDefault = true;
				await otherAddress.save();
			}
		}

		await AddressModel.findByIdAndDelete(id);
	}

	async removeAllByProfile(profileId: string): Promise<void> {
		await AddressModel.deleteMany({ profileId });
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
