import { Type } from 'class-transformer';
import {
	IsNotEmpty,
	IsObject,
	IsOptional,
	IsString,
	IsUrl,
	MaxLength,
	ValidateNested,
} from 'class-validator';

/**
 * As chaves vem em base64url e tem tamanho conhecido (p256dh = 65 bytes,
 * auth = 16 bytes). O teto generoso abaixo nao tenta validar formato — quem
 * valida de fato e a cifragem no envio — mas impede que alguem use o campo
 * como area de armazenamento arbitraria.
 */
export class PushSubscriptionKeysDto {
	@IsString()
	@IsNotEmpty()
	@MaxLength(255)
	p256dh: string;

	@IsString()
	@IsNotEmpty()
	@MaxLength(255)
	auth: string;
}

/**
 * Corpo exatamente no formato de `PushSubscription.toJSON()` do navegador
 * — o front repassa o objeto sem remontar nada.
 *
 * Nao existe `userId` aqui: o dono sai do JWT. Com `forbidNonWhitelisted`
 * no ValidationPipe global, mandar um seria 400.
 */
export class RegisterPushSubscriptionDto {
	/**
	 * `https` obrigatorio: o endpoint e sempre um push service publico
	 * (FCM, Mozilla, WNS). Aceitar `http`/`file` abriria a porta para usar o
	 * cron diario como origem de requisicoes arbitrarias — SSRF com
	 * agendador embutido.
	 */
	@IsString()
	@IsNotEmpty()
	@MaxLength(2048)
	@IsUrl({ protocols: ['https'], require_protocol: true })
	endpoint: string;

	/**
	 * O navegador manda `expirationTime` (quase sempre null). Aceito e
	 * ignorado de proposito: sem ele, `forbidNonWhitelisted` recusaria o
	 * corpo cru vindo de `subscription.toJSON()`.
	 */
	@IsOptional()
	expirationTime?: number | null;

	@IsObject()
	@ValidateNested()
	@Type(() => PushSubscriptionKeysDto)
	keys: PushSubscriptionKeysDto;
}

export class UnregisterPushSubscriptionDto {
	@IsString()
	@IsNotEmpty()
	@MaxLength(2048)
	endpoint: string;
}
