import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ShopifySessionTokenService } from './shopify-session-token.service';

const API_KEY = 'this-apps-client-id';
const CLIENT_SECRET = 'this-apps-client-secret';
const SHOP = 'demo.myshopify.com';

describe('ShopifySessionTokenService', () => {
  const jwtService = new JwtService({});
  let service: ShopifySessionTokenService;

  beforeEach(() => {
    const config = {
      get: jest.fn((key: string) =>
        key === 'shopify.apiKey'
          ? API_KEY
          : key === 'shopify.clientSecret'
            ? CLIENT_SECRET
            : undefined,
      ),
    };
    service = new ShopifySessionTokenService(
      jwtService,
      config as unknown as ConfigService,
    );
  });

  /** A token shaped exactly like the ones Shopify mints. */
  function tokenFor(
    overrides: Record<string, unknown> = {},
    secret = CLIENT_SECRET,
  ): string {
    const now = Math.floor(Date.now() / 1000);
    return jwtService.sign(
      {
        iss: `https://${SHOP}/admin`,
        dest: `https://${SHOP}`,
        aud: API_KEY,
        sub: '42',
        exp: now + 60,
        nbf: now - 5,
        iat: now - 5,
        jti: 'jti-1',
        sid: 'sid-1',
        ...overrides,
      },
      { secret, algorithm: 'HS256' },
    );
  }

  it('accepts a well-formed token and returns the shop it names', () => {
    const result = service.verify(tokenFor());

    expect(result.shopDomain).toBe(SHOP);
    expect(result.userId).toBe('42');
    expect(result.sessionId).toBe('sid-1');
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects a token signed with the wrong secret', () => {
    expect(() => service.verify(tokenFor({}, 'someone-elses-secret'))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a token for another app', () => {
    // The check that matters most: any app installed on this shop can get a
    // token for it, and without `aud` that token would authenticate here.
    expect(() => service.verify(tokenFor({ aud: 'a-different-app' }))).toThrow(
      /issued to another app/,
    );
  });

  it('rejects a token with no audience at all', () => {
    expect(() => service.verify(tokenFor({ aud: undefined }))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an expired token', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(() =>
      service.verify(tokenFor({ exp: now - 10, iat: now - 120 })),
    ).toThrow(/invalid or expired/);
  });

  it('rejects a token that is not valid yet', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(() => service.verify(tokenFor({ nbf: now + 300 }))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a token whose dest names a different shop than iss', () => {
    // The swap: a token naming shop A as issuer and shop B as destination.
    // The signature check already makes this unreachable in practice; the pair
    // is asserted anyway so the guarantee does not rest on one check alone.
    expect(() =>
      service.verify(tokenFor({ dest: 'https://other.myshopify.com' })),
    ).toThrow(/destination is inconsistent/);
  });

  it('rejects a dest that is not a myshopify domain', () => {
    expect(() =>
      service.verify(
        tokenFor({
          iss: 'https://evil.example.com/admin',
          dest: 'https://evil.example.com',
        }),
      ),
    ).toThrow(/destination is not a shop/);
  });

  it('rejects a dest that only looks like a myshopify domain', () => {
    expect(() =>
      service.verify(
        tokenFor({
          iss: 'https://demo.myshopify.com.evil.com/admin',
          dest: 'https://demo.myshopify.com.evil.com',
        }),
      ),
    ).toThrow(/destination is not a shop/);
  });

  it('rejects a token with no dest', () => {
    expect(() => service.verify(tokenFor({ dest: undefined }))).toThrow(
      /destination is inconsistent/,
    );
  });

  it('rejects a dest that is not a URL', () => {
    expect(() =>
      service.verify(tokenFor({ dest: 'demo.myshopify.com' })),
    ).toThrow(/destination is inconsistent/);
  });

  it('rejects an unsigned token', () => {
    // `alg: none` — the classic JWT bypass. Pinning HS256 is what stops it.
    const header = Buffer.from(
      JSON.stringify({ alg: 'none', typ: 'JWT' }),
    ).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        iss: `https://${SHOP}/admin`,
        dest: `https://${SHOP}`,
        aud: API_KEY,
        exp: Math.floor(Date.now() / 1000) + 60,
      }),
    ).toString('base64url');

    expect(() => service.verify(`${header}.${payload}.`)).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a token that is not a JWT', () => {
    expect(() => service.verify('not-a-token')).toThrow(UnauthorizedException);
  });

  it('compares the shop domain case-insensitively', () => {
    const result = service.verify(
      tokenFor({
        iss: `https://DEMO.myshopify.com/admin`,
        dest: `https://DEMO.myshopify.com`,
      }),
    );

    expect(result.shopDomain).toBe(SHOP);
  });
});
