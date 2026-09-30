import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, MaxLength, MinLength } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty()
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  @MaxLength(254)
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'Token do link recebido por e-mail' })
  @IsString()
  @Length(20, 200, { message: 'Link inválido ou expirado. Peça um novo.' })
  token!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'A senha precisa ter pelo menos 8 caracteres.' })
  @MaxLength(100)
  password!: string;
}

/** Confirmar o e-mail da inscrição = criar a senha (a inscrição não tem senha). */
export class VerifyEmailDto {
  @ApiProperty({ description: 'Token do link de confirmação recebido por e-mail' })
  @IsString()
  @Length(20, 200, { message: 'Link inválido ou expirado. Peça um novo.' })
  token!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'A senha precisa ter pelo menos 8 caracteres.' })
  @MaxLength(100)
  password!: string;
}
