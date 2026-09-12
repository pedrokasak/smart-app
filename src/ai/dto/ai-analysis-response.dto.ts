import { ApiProperty } from '@nestjs/swagger';

export class StockScoreDto {
	@ApiProperty() score: number;
	@ApiProperty() rating: string;
	@ApiProperty({ type: [String] }) details: string[];
	@ApiProperty() recommendation: string;
}

export class FiiScoreDto {
	@ApiProperty() score: number;
	@ApiProperty() rating: string;
	@ApiProperty({ type: [String] }) details: string[];
	@ApiProperty() recommendation: string;
	@ApiProperty({ required: false }) critical_rejection?: boolean;
}

export class ForecastDto {
	@ApiProperty() current: number;
	@ApiProperty() forecast_30d: number;
	@ApiProperty() confidence_lower: number;
	@ApiProperty() confidence_upper: number;
	@ApiProperty() trend: 'up' | 'down';
}

export class AiAnalysisResponseDto {
	@ApiProperty() plan: string;
	@ApiProperty({ type: Object }) stock_scores: Record<string, StockScoreDto>;
	@ApiProperty({ type: Object }) fii_scores: Record<string, FiiScoreDto>;
	@ApiProperty({ type: Object, required: false }) forecasts?: Record<
		string,
		ForecastDto
	>;
	@ApiProperty({ required: false }) claude_analysis?: any;
	@ApiProperty({ required: false }) message?: string;
	@ApiProperty() timestamp: string;
}
