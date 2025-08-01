import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AddressController } from './address.controller';
import { AddressService } from './address.service';
import { AddressModel } from './schema/address.model';

@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: AddressModel.name, schema: AddressModel.schema },
		]),
	],
	controllers: [AddressController],
	providers: [AddressService],
	exports: [AddressService],
})
export class AddressModule {}
