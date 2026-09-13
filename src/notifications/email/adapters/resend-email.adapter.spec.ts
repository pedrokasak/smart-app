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
	/**
	 * Restaura só as chaves que este arquivo toca, em vez de reatribuir
	 * `process.env` inteiro.
	 *
	 * O Jest isola o registro de módulos por arquivo, mas `process` é o objeto
	 * real do Node, compartilhado por todos os arquivos que rodam no MESMO
	 * worker. Trocar `process.env` por um objeto literal descarta o objeto
	 * especial do Node e apaga qualquer variável que outro arquivo tenha
	 * definido depois — flake intermitente em outra suíte, que muda conforme a
	 * ordem de paralelização.
	 */
	const TOUCHED_KEYS = ['RESEND_API_KEY', 'RESEND_FROM'] as const;
	const envBackup = new Map<string, string | undefined>();

	beforeEach(() => {
		jest.clearAllMocks();
		for (const key of TOUCHED_KEYS) envBackup.set(key, process.env[key]);
		process.env.RESEND_API_KEY = 're_fake_key';
	});

	afterEach(() => {
		jest.useRealTimers();
		for (const key of TOUCHED_KEYS) {
			const original = envBackup.get(key);
			if (original === undefined) delete process.env[key];
			else process.env[key] = original;
		}
		envBackup.clear();
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

	/**
	 * O `try/catch` cobre falha rápida, mas não cobre LENTIDÃO: o SDK usa
	 * `fetch` sem timeout e o Nest espera `onModuleInit` resolver antes de dar
	 * o módulo por pronto. Sem teto, a API do Resend degradada penduraria o
	 * boot para sempre e o container nunca ficaria healthy.
	 */
	it('não trava o boot quando o Resend não responde', async () => {
		jest.useFakeTimers();
		process.env.RESEND_FROM = 'no-reply@trackerr.com.br';
		listMock.mockReturnValue(new Promise(() => undefined));

		const { adapter, warnSpy } = buildAdapter();
		const boot = adapter.onModuleInit();
		jest.advanceTimersByTime(5_000);

		await expect(boot).resolves.toBeUndefined();
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('abandonada'));
	});

	it('avisa quando o formato da resposta do SDK não é reconhecido', async () => {
		process.env.RESEND_FROM = 'no-reply@trackerr.com.br';
		listMock.mockResolvedValue({ data: { formatoNovo: true } });

		const { adapter, warnSpy, errorSpy } = buildAdapter();
		await adapter.onModuleInit();

		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining('Resposta inesperada')
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
