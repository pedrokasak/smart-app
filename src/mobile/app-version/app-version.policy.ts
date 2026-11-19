const VERSION_PATTERN = /^(\d{1,5})\.(\d{1,5})\.(\d{1,5})$/;

const parts = (version: string): number[] | null => {
	const match = VERSION_PATTERN.exec(version.trim());
	return match ? match.slice(1).map(Number) : null;
};

/** Versão ausente ou fora do formato `x.y.z` nunca atende ao mínimo. */
export function meetsMinimumVersion(
	version: string | undefined,
	minimum: string
): boolean {
	const current = version ? parts(version) : null;
	const required = parts(minimum);
	if (!current || !required) return false;

	for (let i = 0; i < required.length; i += 1) {
		if (current[i] !== required[i]) return current[i] > required[i];
	}
	return true;
}
