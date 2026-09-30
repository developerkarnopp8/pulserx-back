import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule, JwtSignOptions } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { LocalStrategy } from './strategies/local.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UsersModule } from '../users/users.module';
import { EmailService } from '../common/email.service';
import { PasswordResetController } from './password-reset.controller';
import { PasswordResetService } from './password-reset.service';

export function buildJwtModuleOptions(configService: ConfigService) {
  const secret = configService.get<string>('JWT_SECRET');
  if (!secret) {
    throw new Error(
      'JWT_SECRET não configurado — defina a variável de ambiente antes de iniciar a aplicação.',
    );
  }
  return {
    secret,
    signOptions: {
      // @nestjs/jwt 12 tipa expiresIn como number | StringValue (formato do `ms`, ex.: '7d');
      // o valor vem de env como string livre, validado só em runtime pelo jsonwebtoken.
      expiresIn: configService.get<string>('JWT_EXPIRES_IN', '7d') as JwtSignOptions['expiresIn'],
    },
  };
}

@Module({
  imports: [
    UsersModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: buildJwtModuleOptions,
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController, PasswordResetController],
  providers: [AuthService, LocalStrategy, JwtStrategy, PasswordResetService, EmailService],
  exports: [AuthService, PasswordResetService],
})
export class AuthModule {}
