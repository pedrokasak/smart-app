/**
 * Fila por chave em processo: tarefas da mesma chave rodam uma de cada vez,
 * na ordem de chegada; chaves diferentes rodam juntas. A falha de uma tarefa
 * só rejeita quem a pediu. Vale para uma réplica; com mais de uma, precisa de
 * uma trava distribuída (como o job diário).
 */
export class KeyedSerializer {
	private readonly tails = new Map<string, Promise<void>>();

	/** Chaves com tarefa rodando ou na fila (testes). */
	get size(): number {
		return this.tails.size;
	}

	async run<T>(key: string, task: () => Promise<T>): Promise<T> {
		const previous = this.tails.get(key) ?? Promise.resolve();
		const result = previous.then(task);
		const tail = result.then(
			() => undefined,
			() => undefined
		);
		this.tails.set(key, tail);
		try {
			return await result;
		} finally {
			if (this.tails.get(key) === tail) this.tails.delete(key);
		}
	}
}
