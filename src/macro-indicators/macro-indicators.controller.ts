import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { NotUserScoped } from 'src/auth/decorators/ownership.decorator';
import {
	MacroSeriesService,
	todayInSaoPaulo,
} from './application/macro-series.service';
import {
	MacroSeriesParamDto,
	MacroSeriesQueryDto,
} from './macro-indicators.dto';

const DEFAULT_WINDOW_DAYS = 365;

/**
 * Séries macro com procedência (TRA-227). Cada resposta leva série, período,
 * instante da extração, URL que reproduz a consulta e licença — o mínimo
 * honesto para exibir um número do BACEN sob ODbL.
 */
@Controller('macro-indicators')
@ApiTags('macro-indicators')
@ApiBearerAuth('access-token')
export class MacroIndicatorsController {
	constructor(private readonly macroSeries: MacroSeriesService) {}

	@Get(':key/series')
	@NotUserScoped('série macro pública do BACEN, igual para todos os usuários')
	@ApiResponse({ status: 200, description: 'OK' })
	@ApiResponse({ status: 400, description: 'Série ou data inválida' })
	async getSeries(
		@Param() { key }: MacroSeriesParamDto,
		@Query() query: MacroSeriesQueryDto
	) {
		const to = query.to ?? todayInSaoPaulo(new Date());
		const from =
			query.from ??
			new Date(
				new Date(`${to}T00:00:00.000Z`).getTime() -
					DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000
			)
				.toISOString()
				.slice(0, 10);

		const { descriptor, points, extractedAt, sourceUrl } =
			await this.macroSeries.getSeries(key, from, to);

		return {
			key: descriptor.key,
			label: descriptor.label,
			kind: descriptor.kind,
			periodicity: descriptor.periodicity,
			unit: descriptor.unit,
			from,
			to,
			points,
			provenance: {
				source: `${descriptor.source}_${descriptor.code}`,
				extractedAt: extractedAt ? extractedAt.toISOString() : null,
				url: sourceUrl,
				license: descriptor.license,
			},
		};
	}
}
