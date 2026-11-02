import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthenticateDto } from './authenticate.dto';

const signin = (device?: object) =>
	plainToInstance(AuthenticateDto, {
		email: 'a@b.com',
		password: 'Password123@',
		keepConnected: false,
		...(device ? { device } : {}),
	});

const device = {
	deviceId: 'phone-0001',
	deviceName: 'iPhone de Ana',
	platform: 'ios',
};

const errorsOf = (dto: AuthenticateDto) =>
	validate(dto, { whitelist: true, forbidNonWhitelisted: true });

describe('device no login', () => {
	it('é opcional: o web segue enviando o mesmo corpo', async () => {
		expect(await errorsOf(signin())).toHaveLength(0);
	});

	it('aceita um aparelho válido', async () => {
		expect(await errorsOf(signin(device))).toHaveLength(0);
	});

	it.each([
		['plataforma web', { ...device, platform: 'web' }],
		['id curto', { ...device, deviceId: 'abc' }],
		['id com caractere inválido', { ...device, deviceId: 'phone 0001$' }],
		['nome vazio', { ...device, deviceName: '' }],
		['nome longo', { ...device, deviceName: 'x'.repeat(81) }],
		['campo extra', { ...device, extra: 'x' }],
		['lista vazia', []],
		['lista com aparelho válido', [device]],
	])('recusa %s', async (_label, invalid) => {
		expect(await errorsOf(signin(invalid))).not.toHaveLength(0);
	});
});
