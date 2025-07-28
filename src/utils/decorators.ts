import {
	registerDecorator,
	ValidationArguments,
	ValidationOptions,
} from 'class-validator';
import Cpf from '../profile/entity/cpf';

export function Match(property: string, validationOptions?: ValidationOptions) {
	return (object: any, propertyName: string) => {
		registerDecorator({
			name: 'Match',
			target: object.constructor,
			propertyName: propertyName,
			options: validationOptions,
			constraints: [property],
			validator: {
				validate(value: any, args: ValidationArguments) {
					const [relatedPropertyName] = args.constraints;
					const relatedValue = (args.object as any)[relatedPropertyName];
					return value === relatedValue;
				},
				defaultMessage(args: ValidationArguments) {
					const [relatedPropertyName] = args.constraints;
					return `${args.property} must match ${relatedPropertyName}`;
				},
			},
		});
	};
}

export function IsCpf(validationOptions?: ValidationOptions) {
	return (object: any, propertyName: string) => {
		registerDecorator({
			name: 'IsCpf',
			target: object.constructor,
			propertyName: propertyName,
			options: validationOptions,
			validator: {
				validate(value: any) {
					try {
						new Cpf(value);
						return true;
					} catch (error) {
						return false;
					}
				},
				defaultMessage() {
					return 'CPF is invalid';
				},
			},
		});
	};
}
