/**
 * Cabeçalhos das chamadas internas para o trackerr-ia (TRA-89).
 *
 * O trackerr-ia não autentica usuário final — quem faz isso é este serviço,
 * e por isso o `user_id` viaja no corpo. Até TRA-89 nada impedia um terceiro
 * de mandar a mesma requisição com o `user_id` de outra pessoa, então o
 * trackerr-ia passou a exigir um segredo compartilhado no header
 * `x-service-token`.
 *
 * Centralizado num lugar só porque são cinco adapters chamando o mesmo
 * serviço: espalhar a montagem do header garante que o próximo adapter
 * esqueça dele.
 */

export const TRACKERR_IA_SERVICE_TOKEN_ENV = 'TRACKERR_IA_SERVICE_TOKEN';

export function trackerrIaHeaders(): Record<string, string> {
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
	};

	const token = (process.env[TRACKERR_IA_SERVICE_TOKEN_ENV] || '').trim();
	if (token) {
		headers['x-service-token'] = token;
	}

	// Sem token o header simplesmente não vai, e o trackerr-ia responde 401.
	// Falhar aqui derrubaria o processo por uma variável de ambiente ausente
	// numa chamada que todos os adapters já tratam como falível.
	return headers;
}
