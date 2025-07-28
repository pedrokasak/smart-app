import { HttpService } from '@nestjs/axios';
import {
	BadRequestException,
	InternalServerErrorException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { AxiosResponse } from 'axios';
import { of } from 'rxjs';
import { AddressService } from './address.service';
import { AddressModel } from './schema/address.model';

describe('AddressService', () => {
	let service: AddressService;
	let httpService: HttpService;

	const mockAddressModel = {
		findOne: jest.fn(),
		find: jest.fn(),
		findById: jest.fn(),
		findByIdAndUpdate: jest.fn(),
		findByIdAndDelete: jest.fn(),
		save: jest.fn(),
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				AddressService,
				{
					provide: getModelToken(AddressModel.name),
					useValue: mockAddressModel,
				},
				{
					provide: HttpService,
					useValue: {
						get: jest.fn(),
					},
				},
			],
		}).compile();

		service = module.get<AddressService>(AddressService);
		httpService = module.get<HttpService>(HttpService);
	});

	it('should be defined', () => {
		expect(service).toBeDefined();
	});

	describe('findByZipCode', () => {
		it('should return address data for valid zipcode', async () => {
			// Mock da resposta da API com todas as propriedades do AxiosResponse
			const mockResponse: AxiosResponse = {
				data: {
					cep: '01001-000',
					logradouro: 'Praça da Sé',
					complemento: 'lado ímpar',
					bairro: 'Sé',
					localidade: 'São Paulo',
					uf: 'SP',
				},
				status: 200,
				statusText: 'OK',
				headers: {} as any,
				config: {
					url: 'https://viacep.com.br/ws/01001000/json/',
					method: 'get',
					headers: {} as any,
				} as any,
			};

			jest.spyOn(httpService, 'get').mockImplementation(() => {
				return of(mockResponse);
			});

			const result = await service.findByZipCode('01001000');

			expect(result).toEqual({
				zipCode: '01001-000',
				street: 'Praça da Sé',
				complement: 'lado ímpar',
				neighborhood: 'Sé',
				city: 'São Paulo',
				state: 'SP',
			});
		});

		it('should throw BadRequestException for invalid zipcode format', async () => {
			await expect(service.findByZipCode('123')).rejects.toThrow(
				BadRequestException
			);
		});

		it('should throw BadRequestException when API returns error', async () => {
			// Mock da resposta da API com erro
			const mockErrorResponse: AxiosResponse = {
				data: {
					erro: true,
				},
				status: 200,
				statusText: 'OK',
				headers: {} as any,
				config: {
					url: 'https://viacep.com.br/ws/99999999/json/',
					method: 'get',
					headers: {} as any,
				} as any,
			};

			jest.spyOn(httpService, 'get').mockImplementation(() => {
				return of(mockErrorResponse);
			});

			await expect(service.findByZipCode('99999999')).rejects.toThrow(
				new BadRequestException('CEP não encontrado')
			);
		});

		it('should throw InternalServerErrorException when HTTP request fails', async () => {
			jest.spyOn(httpService, 'get').mockImplementation(() => {
				throw new Error('Network error');
			});

			await expect(service.findByZipCode('01001000')).rejects.toThrow(
				new InternalServerErrorException('Erro ao consultar o serviço de CEP')
			);
		});

		describe('validateZipCode', () => {
			it('should return true for valid zipcode formats', () => {
				expect(service.validateZipCode('01001000')).toBe(true);
				expect(service.validateZipCode('01001-000')).toBe(true);
			});

			it('should return false for invalid zipcode formats', () => {
				expect(service.validateZipCode('123')).toBe(false);
				expect(service.validateZipCode('12345-67')).toBe(false);
				expect(service.validateZipCode('1234567890')).toBe(false);
				expect(service.validateZipCode('abcde-fgh')).toBe(false);
			});
		});
	});

	describe('fillAddressFromZipCode', () => {
		it('should fill address data from zipcode', async () => {
			// Mock da resposta da API
			const mockResponse: AxiosResponse = {
				data: {
					cep: '01001-000',
					logradouro: 'Praça da Sé',
					complemento: 'lado ímpar',
					bairro: 'Sé',
					localidade: 'São Paulo',
					uf: 'SP',
				},
				status: 200,
				statusText: 'OK',
				headers: {} as any,
				config: {
					url: 'https://viacep.com.br/ws/01001000/json/',
					method: 'get',
					headers: {} as any,
				} as any,
			};

			jest.spyOn(httpService, 'get').mockImplementation(() => {
				return of(mockResponse);
			});

			const partialAddress = {
				userId: '507f1f77bcf86cd799439011',
				number: '123',
				type: 'HOME' as any,
			};

			const result = await service.fillAddressFromZipCode(
				'01001000',
				partialAddress
			);

			expect(result).toEqual({
				userId: '507f1f77bcf86cd799439011',
				number: '123',
				type: 'HOME',
				street: 'Praça da Sé',
				neighborhood: 'Sé',
				city: 'São Paulo',
				state: 'SP',
				zipCode: '01001-000',
				complement: 'lado ímpar',
			});
		});

		it('should preserve provided complement over API complement', async () => {
			// Mock da resposta da API
			const mockResponse: AxiosResponse = {
				data: {
					cep: '01001-000',
					logradouro: 'Praça da Sé',
					complemento: 'lado ímpar',
					bairro: 'Sé',
					localidade: 'São Paulo',
					uf: 'SP',
				},
				status: 200,
				statusText: 'OK',
				headers: {} as any,
				config: {
					url: 'https://viacep.com.br/ws/01001000/json/',
					method: 'get',
					headers: {} as any,
				} as any,
			};

			jest.spyOn(httpService, 'get').mockImplementation(() => {
				return of(mockResponse);
			});

			const partialAddress = {
				userId: '507f1f77bcf86cd799439011',
				number: '123',
				complement: 'Apto 45',
				type: 'HOME' as any,
			};

			const result = await service.fillAddressFromZipCode(
				'01001000',
				partialAddress
			);

			expect(result.complement).toBe('Apto 45');
		});
	});
});
