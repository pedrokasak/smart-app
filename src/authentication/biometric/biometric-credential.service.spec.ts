import { UnauthorizedException } from '@nestjs/common';
import { SECURITY_EVENT } from 'src/audit/domain/security-events';
import { UserModel } from 'src/users/schema/user.model';
import {
	BiometricCredentialRepository,
	StoredBiometricCredential,
} from './biometric-credential.repository';
import {
	BIOMETRIC_CREDENTIAL_TTL_MS,
	BiometricCredentialService,
} from './biometric-credential.service';

class InMemoryRepository implements BiometricCredentialRepository {
	readonly items: StoredBiometricCredential[] = [];

	async replaceForDevice(credential: StoredBiometricCredential) {
		await this.deleteForDevice(credential.userId, credential.deviceId);
		this.items.push({ ...credential });
	}

	async findByHash(credentialHash: string) {
		return (
			this.items.find((item) => item.credentialHash === credentialHash) ?? null
		);
	}

	async markUsed(credentialHash: string, lastUsedAt: Date, expiresAt: Date) {
		const item = this.items.find(
			(candidate) => candidate.credentialHash === credentialHash
		);
		if (item) Object.assign(item, { lastUsedAt, expiresAt });
	}

	async deleteForDevice(userId: string, deviceId: string) {
		const index = this.items.findIndex(
			(item) => item.userId === userId && item.deviceId === deviceId
		);
		if (index < 0) return false;
		this.items.splice(index, 1);
		return true;
	}

	async deleteAllOfUser(userId: string) {
		for (let i = this.items.length - 1; i >= 0; i -= 1) {
			if (this.items[i].userId === userId) this.items.splice(i, 1);
		}
	}
}

const phone = {
	deviceId: 'phone-0001',
	deviceName: 'Pixel',
	platform: 'android' as const,
};
const user = { id: 'user-1' };

describe('BiometricCredentialService', () => {
	let repository: InMemoryRepository;
	let issueSessionTokens: jest.Mock;
	let emit: jest.Mock;
	let now: Date;
	let service: BiometricCredentialService;

	beforeEach(() => {
		repository = new InMemoryRepository();
		issueSessionTokens = jest.fn(async () => ({ accessToken: 'access' }));
		emit = jest.fn();
		now = new Date('2026-11-03T12:00:00.000Z');
		service = new BiometricCredentialService(
			repository,
			{ issueSessionTokens } as never,
			() => now,
			{ emit } as never
		);
		jest.spyOn(UserModel, 'findById').mockReturnValue({
			select: () => ({ exec: async () => user }),
		} as never);
	});

	afterEach(() => jest.restoreAllMocks());

	it('guarda só o digest da credencial', async () => {
		const credential = await service.enroll('user-1', phone);

		expect(credential).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(repository.items[0].credentialHash).not.toContain(credential);
		expect(emit).toHaveBeenCalledWith(
			expect.objectContaining({ type: SECURITY_EVENT.BiometricEnrolled })
		);
	});

	it('abre uma sessão nova, sem manter conectado', async () => {
		const credential = await service.enroll('user-1', phone);

		await expect(service.signin(credential, phone)).resolves.toEqual({
			accessToken: 'access',
		});

		expect(issueSessionTokens).toHaveBeenCalledWith(user, {
			keepConnected: false,
			device: phone,
		});
	});

	it('recusa credencial desconhecida', async () => {
		await expect(service.signin('inexistente', phone)).rejects.toThrow(
			UnauthorizedException
		);
		expect(issueSessionTokens).not.toHaveBeenCalled();
	});

	it('recusa credencial copiada para outro aparelho', async () => {
		const credential = await service.enroll('user-1', phone);

		await expect(
			service.signin(credential, { ...phone, deviceId: 'phone-0002' })
		).rejects.toThrow(UnauthorizedException);
		expect(issueSessionTokens).not.toHaveBeenCalled();
	});

	it('recusa credencial vencida e renova o prazo a cada uso', async () => {
		const credential = await service.enroll('user-1', phone);

		now = new Date(now.getTime() + BIOMETRIC_CREDENTIAL_TTL_MS - 1000);
		await service.signin(credential, phone);
		expect(repository.items[0].expiresAt.getTime()).toBe(
			now.getTime() + BIOMETRIC_CREDENTIAL_TTL_MS
		);

		now = new Date(now.getTime() + BIOMETRIC_CREDENTIAL_TTL_MS);
		await expect(service.signin(credential, phone)).rejects.toThrow(
			UnauthorizedException
		);
	});

	it('recusa a credencial de uma conta que não existe mais', async () => {
		const credential = await service.enroll('user-1', phone);
		jest.spyOn(UserModel, 'findById').mockReturnValue({
			select: () => ({ exec: async () => null }),
		} as never);

		await expect(service.signin(credential, phone)).rejects.toThrow(
			UnauthorizedException
		);
	});

	it('cadastrar de novo invalida a credencial anterior do aparelho', async () => {
		const first = await service.enroll('user-1', phone);
		await service.enroll('user-1', phone);

		await expect(service.signin(first, phone)).rejects.toThrow(
			UnauthorizedException
		);
		expect(repository.items).toHaveLength(1);
	});

	it('revoga só o aparelho pedido e só da própria conta', async () => {
		const credential = await service.enroll('user-1', phone);

		await service.revoke('user-2', phone.deviceId);
		expect(repository.items).toHaveLength(1);
		expect(emit).not.toHaveBeenCalledWith(
			expect.objectContaining({ type: SECURITY_EVENT.BiometricRevoked })
		);

		await service.revoke('user-1', phone.deviceId);
		await expect(service.signin(credential, phone)).rejects.toThrow(
			UnauthorizedException
		);
	});
});
