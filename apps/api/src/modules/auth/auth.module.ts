import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { OAuthController } from './oauth.controller';
import { AuthService } from './auth.service';
import { OAuthService } from './oauth.service';
import { TokenService } from './token.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController, OAuthController],
  providers: [AuthService, OAuthService, TokenService],
  exports: [TokenService, JwtModule],
})
export class AuthModule {}
