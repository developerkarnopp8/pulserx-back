import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/** O aluno confirma a senha antes de excluir a conta (ação sem volta). */
export class DeleteAccountDto {
  @ApiProperty()
  @IsString()
  @MinLength(1, { message: 'Digite sua senha para confirmar.' })
  @MaxLength(128)
  password!: string;
}

/** Admin: localizar o aluno pelo e-mail exato do pedido de exclusão. */
export class FindAthleteDto {
  @ApiProperty()
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  @MaxLength(254)
  email!: string;
}
