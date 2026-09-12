import { ResendEmailAdapter } from './resend-email.adapter';

/**
 * TRA-151. Em produção o `RESEND_FROM` apontava para
 * `no-reply@trakkerwallet.com.br` enquanto o único domínio verificado na conta
 * era `trackerr.com.br`. O Resend recusa envio de domínio não verificado, então
 * TODO e-mail falhava — inclusive o de recuperação de senha — e nada no boot
 * denunciava a divergência. Estes testes cobrem o aviso que faltava.
 */

const listMock = jest.fn();

jest.mock('resend', () => ({
	Resend: jest.fn().mockImplementation(() => ({
		domains: { list: listMock },
		emails: { send: jest.fn() },
	})),
}));

describe('ResendEmailAdapter — checagem do domínio do remetente', () => {
	const envBackup = { ...process.env };

	beforeEach(() => {
		jest.clearAllMocks();
		process.env.RESEND_API_KEY = 're_fake_key';
	});

	afterEach(() => {
		process.env = { ...envBackup };
	});

	function buildAdapter() {
		const adapter = new ResendEmailAdapter();
		const errorSpy = jest
			.spyOn((adapter as any).logger, 'error')
			.mockImplementation(() => undefined);
		const warnSpy = jest
			.spyOn((adapter as any).logger, 'warn')
			.mockImplementation(() => undefined);
		const logSpy = jest
			.spyOn((adapter as any).logger, 'log')
			.mockImplementation(() => undefined);
		return { adapter, errorSpy, warnSpy, logSpy };
	}

	it('loga ERROR quando o domínio do remetente não existe na conta', async () => {
		process.env.RESEND_FROM = 'no-reply@trakkerwallet.com.br';
		listMock.mockResolvedValue({
			data: [{ name: 'trackerr.com.br', status: 'verified' }],
		});

		const { adapter, errorSpy } = buildAdapter();
		await adapter.onModuleInit();

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining('trakkerwallet.com.br')
		);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining('TODO envio de e-mail vai falhar')
		);
	});

	it('loga ERROR quando o domínio existe mas não está verificado', async () => {
		process.env.RESEND_FROM = 'no-reply@trackerr.com.br';
		listMock.mockResolvedValue({
			data: [{ name: 'trackerr.com.br', status: 'pending' }],
		});

		const { adapter, errorSpy } = buildAdapter();
		await adapter.onModuleInit();

		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('pending'));
	});

	it('não reclama quando o domínio está verificado', async () => {
		process.env.RESEND_FROM = 'no-reply@trackerr.com.br';
		listMock.mockResolvedValue({
			data: [{ name: 'trackerr.com.br', status: 'verified' }],
		});

		const { adapter, errorSpy, logSpy } = buildAdapter();
		await adapter.onModuleInit();

		expect(errorSpy).not.toHaveBeenCalled();
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining('domínio verificado')
		);
	});

	/**
	 * O SDK já devolveu `{ data: Domain[] }` e `{ data: { data: [...] } }` em
	 * versões diferentes. Aceitar as duas evita que um bump de dependência
	 * transforme a checagem num falso positivo barulhento.
	 */
	it('aceita o formato aninhado { data: { data: [...] } } do SDK', async () => {
		process.env.RESEND_FROM = 'no-reply@trackerr.com.br';
		listMock.mockResolvedValue({
			data: { data: [{ name: 'trackerr.com.br', status: 'verified' }] },
		});

		const { adapter, errorSpy } = buildAdapter();
		await adapter.onModuleInit();

		expect(errorSpy).not.toHaveBeenCalled();
	});

	/**
	 * Resend fora do ar no instante da subida não pode impedir a API inteira
	 * de servir — a checagem é um sinal, não uma dependência de boot.
	 */
	it('não derruba o boot quando a consulta ao Resend falha', async () => {
		process.env.RESEND_FROM = 'no-reply@trackerr.com.br';
		listMock.mockRejectedValue(new Error('network down'));

		const { adapter, warnSpy, errorSpy } = buildAdapter();
		await expect(adapter.onModuleInit()).resolves.toBeUndefined();

		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining('Falha ao checar o domínio')
		);
		expect(errorSpy).not.toHaveBeenCalled();
	});

	it('não faz nada quando não há RESEND_API_KEY (ambiente local)', async () => {
		delete process.env.RESEND_API_KEY;
		process.env.RESEND_FROM = 'no-reply@trackerr.com.br';

		const { adapter, errorSpy } = buildAdapter();
		await adapter.onModuleInit();

		expect(listMock).not.toHaveBeenCalled();
		expect(errorSpy).not.toHaveBeenCalled();
	});
});
