import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import {
  SESSION_COOKIE_NAME,
  SessionService,
} from '../../modules/session/session.service';
import { SessionAuthGuard } from './session-auth.guard';

function contextWithCookies(cookies: Record<string, string>): ExecutionContext {
  const request = { cookies };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('SessionAuthGuard', () => {
  it('attaches the verified session payload to the request', () => {
    const sessionService = {
      verify: jest.fn(() => ({ shopId: 'shop-1' })),
    } as unknown as SessionService;
    const guard = new SessionAuthGuard(sessionService);

    const context = contextWithCookies({
      [SESSION_COOKIE_NAME]: 'valid-token',
    });
    expect(guard.canActivate(context)).toBe(true);
    expect(
      context.switchToHttp().getRequest<{ session?: unknown }>().session,
    ).toEqual({ shopId: 'shop-1' });
  });

  it('throws UnauthorizedException when no session cookie is present', () => {
    const sessionService = { verify: jest.fn() } as unknown as SessionService;
    const guard = new SessionAuthGuard(sessionService);

    expect(() => guard.canActivate(contextWithCookies({}))).toThrow(
      UnauthorizedException,
    );
  });
});
