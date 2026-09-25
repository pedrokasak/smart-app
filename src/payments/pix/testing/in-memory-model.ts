import { Types } from 'mongoose';

/**
 * Coleção em memória para os testes do PIX (TRA-195) — só testes.
 *
 * Implementa o subconjunto de Mongoose que o módulo usa, avaliando os filtros
 * de verdade (igualdade, `$in`, `$ne`, `$gt`, `$gte`, `$exists`). O ponto é
 * testar a IDEMPOTÊNCIA do webhook: com mock de "foi chamado", uma segunda
 * entrega que liberasse o plano de novo passaria verde.
 */
type Doc = Record<string, any>;

const toComparable = (value: unknown) =>
	value instanceof Types.ObjectId
		? value.toString()
		: value instanceof Date
			? value.getTime()
			: value;

function matchesCondition(actual: unknown, condition: unknown): boolean {
	if (
		condition &&
		typeof condition === 'object' &&
		!(condition instanceof Date) &&
		!(condition instanceof Types.ObjectId) &&
		!Array.isArray(condition)
	) {
		return Object.entries(condition as Doc).every(([op, expected]) => {
			const a = toComparable(actual);
			switch (op) {
				case '$in':
					return (expected as unknown[]).map(toComparable).includes(a);
				case '$nin':
					return !(expected as unknown[]).map(toComparable).includes(a);
				case '$ne':
					return a !== toComparable(expected);
				case '$gt':
					return (
						actual != null && (a as number) > (toComparable(expected) as number)
					);
				case '$gte':
					return (
						actual != null &&
						(a as number) >= (toComparable(expected) as number)
					);
				case '$lt':
					return (
						actual != null && (a as number) < (toComparable(expected) as number)
					);
				case '$exists':
					return expected ? actual !== undefined : actual === undefined;
				default:
					throw new Error(`operador não suportado no fake: ${op}`);
			}
		});
	}
	return toComparable(actual) === toComparable(condition);
}

export function matches(doc: Doc, filter: Doc): boolean {
	return Object.entries(filter).every(([field, condition]) =>
		matchesCondition(doc[field], condition)
	);
}

function applyUpdate(doc: Doc, update: Doc, inserting: boolean) {
	for (const [field, value] of Object.entries(update.$set ?? {}))
		doc[field] = value;
	for (const field of Object.keys(update.$unset ?? {})) delete doc[field];
	if (inserting) {
		for (const [field, value] of Object.entries(update.$setOnInsert ?? {})) {
			doc[field] = value;
		}
	}
}

export class InMemoryModel {
	readonly docs: Doc[] = [];

	constructor(private readonly defaults: Doc = {}) {}

	private wrap(doc: Doc) {
		const docs = this.docs;
		return Object.assign(doc, {
			save: async () => {
				if (!docs.includes(doc)) docs.push(doc);
				return doc;
			},
		});
	}

	seed(doc: Doc) {
		const created = this.wrap({
			_id: new Types.ObjectId(),
			...this.defaults,
			...doc,
		});
		this.docs.push(created);
		return created;
	}

	async create(doc: Doc) {
		return this.seed(doc);
	}

	findById(id: unknown) {
		const found =
			this.docs.find((doc) => toComparable(doc._id) === toComparable(id)) ??
			null;
		const promise: any = Promise.resolve(found);
		promise.select = () => promise;
		return promise;
	}

	findOne(filter: Doc) {
		const found = this.docs.find((doc) => matches(doc, filter)) ?? null;
		const promise: any = Promise.resolve(found);
		promise.select = () => promise;
		return promise;
	}

	async exists(filter: Doc) {
		return this.docs.some((doc) => matches(doc, filter)) ? { _id: 'x' } : null;
	}

	async updateOne(filter: Doc, update: Doc) {
		const doc = this.docs.find((candidate) => matches(candidate, filter));
		if (doc) applyUpdate(doc, update, false);
		return { matchedCount: doc ? 1 : 0, modifiedCount: doc ? 1 : 0 };
	}

	async findOneAndUpdate(
		filter: Doc,
		update: Doc,
		options: { new?: boolean; upsert?: boolean } = {}
	) {
		let doc = this.docs.find((candidate) => matches(candidate, filter));
		if (!doc) {
			if (!options.upsert) return null;
			doc = this.seed({});
			applyUpdate(doc, update, true);
			return doc;
		}
		const before = { ...doc };
		applyUpdate(doc, update, false);
		return options.new ? doc : before;
	}
}
