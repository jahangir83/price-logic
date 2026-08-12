import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

export const SESSION_COOKIE_NAME = 'plc_session';

export interface SessionPayload {
  shopId: string;
}

/**
 * Signs/verifies the merchant's session token. The token carries only an
 * internal shopId — never the Shopify access token or any other secret —
 * so nothing sensitive is ever placed in the browser (security #7).
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  sign(payload: SessionPayload): string {
    const ttlDays = this.configService.get<number>('session.ttlDays') ?? 7;
    return this.jwtService.sign(payload, { expiresIn: `${ttlDays}d` });
  }

  verify(token: string): SessionPayload {
    try {
      return this.jwtService.verify<SessionPayload>(token);
    } catch {
      throw new UnauthorizedException('Session is invalid or expired');
    }
  }

  cookieMaxAgeMs(): number {
    const ttlDays = this.configService.get<number>('session.ttlDays') ?? 7;
    return ttlDays * 24 * 60 * 60 * 1000;
  }

  isProduction(): boolean {
    return this.configService.get<string>('nodeEnv') === 'production';
  }
}
