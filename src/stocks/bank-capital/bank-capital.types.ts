export interface BankCapitalResult {
	symbol: string;
	bankName: string;
	period: string;
	basileia: number | null;
	imobilizacao: number | null;
}

export interface BankEntry {
	symbol: string;
	bankName: string;
	prudentialCode: string;
}
