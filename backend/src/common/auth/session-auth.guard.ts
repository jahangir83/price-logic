import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  SESSION_COOKIE_NAME,
  SessionService,
} from '../../modules/session/session.service';
import type { AuthenticatedRequest } from './authenticated-request';

/**
 * Step 1 of the authorization chain: Authenticated?
 * Verifies the session cookie and attaches the decoded payload to the
 * request. Never trusts any client-supplied identity beyond this token.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly sessionService: SessionService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = (request.cookies as Record<string, string> | undefined)?.[
      SESSION_COOKIE_NAME
    ];

    if (!token) {
      throw new UnauthorizedException('No session');
    }

    request.session = this.sessionService.verify(token);
    return true;
  }
}
