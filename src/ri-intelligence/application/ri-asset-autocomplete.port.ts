export const RI_ASSET_AUTOCOMPLETE = Symbol('RI_ASSET_AUTOCOMPLETE');

export interface RiAssetSuggestion {
	ticker: string;
	company: string;
}

export interface RiAssetAutocompletePort {
	search(query: string, limit: number): Promise<RiAssetSuggestion[]>;
}
