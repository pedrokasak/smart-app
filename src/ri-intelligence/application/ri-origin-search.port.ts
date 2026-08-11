export const RI_ORIGIN_SEARCH = Symbol('RI_ORIGIN_SEARCH');

export interface RiOriginSearchPort {
	searchOfficialOrigin(companyName: string): Promise<string | null>;
}
