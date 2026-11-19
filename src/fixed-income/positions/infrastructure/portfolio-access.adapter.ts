import { Injectable } from '@nestjs/common';
import { PortfolioService } from 'src/portfolio/portfolio.service';
import type { PortfolioAccess } from '../application/fixed-income-positions.ports';

/** Dono e inclusão do ativo pela própria carteira (cota de ativos, histórico). */
@Injectable()
export class PortfolioAccessAdapter implements PortfolioAccess {
	constructor(private readonly portfolioService: PortfolioService) {}

	assertOwnership(userId: string, portfolioId: string): Promise<void> {
		return this.portfolioService.assertPortfolioOwnership(userId, portfolioId);
	}

	insertAsset(portfolioId: string, asset: Record<string, unknown>) {
		return this.portfolioService.insertValuedAsset(portfolioId, asset);
	}
}
