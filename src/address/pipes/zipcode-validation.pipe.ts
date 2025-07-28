// src/address/pipes/zipcode-validation.pipe.ts
import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';

@Injectable()
export class ZipCodeValidationPipe implements PipeTransform {
	transform(value: string): string {
		// Valida o formato do CEP
		if (!/^\d{5}-?\d{3}$/.test(value)) {
			throw new BadRequestException(
				'Formato de CEP inválido. Use o formato 00000-000 ou 00000000'
			);
		}

		// Remove caracteres não numéricos e retorna o CEP limpo
		return value.replace(/\D/g, '');
	}
}
