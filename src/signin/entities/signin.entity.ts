import { ApiProperty } from '@nestjs/swagger';
export class SigninEntity {
  @ApiProperty()
  token: string;
}
