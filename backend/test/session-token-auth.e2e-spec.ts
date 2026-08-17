import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { SESSION_COOKIE_NAME } from '../src/modules/session/services/session.service';

/**
 * Authenticating a real HTTP request with an App Bridge session token.
 *
 * The unit tests cover the token verifier and the guard in isolation; this
 * proves the chain end to end — header parsed, JWT verified, shop resolved from
 * `dest`, guard satisfied, controller reached — against a token signed exactly
 * the way Shopify signs one.
 *
 * It also pins the two properties that matter more than the happy path: a token
 * for another app must not authenticate, and a client-supplied shop id must not
 * be able to redirect the request at another merchant's data.
 */
describe('session token auth (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let jwt: JwtService;

  let apiKey: string;
  let clientSecret: string;
  let sessionSecret: string;

  const SHOP_ID = 'a5a5a5a5-0000-4000-8000-0000000000a5';
  const OTHER_ID = 'b5b5b5b5-0000-4000-8000-0000000000b5';
  const SHOP_DOMAIN = 'token-auth.myshopify.com';
  const OTHER_DOMAIN = 'token-other.myshopify.com';
  const GONE_DOMAIN = 'token-gone.myshopify.com';
  const OTHER_CAMPAIGN = 'c5c5c5c5-0000-4000-8000-0000000000c5';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // The cookie fallback needs the same middleware main.ts installs.
    app.use(cookieParser());
    await app.init();

    dataSource = app.get(DataSource);
    jwt = app.get(JwtService);

    const config = app.get(ConfigService);
    apiKey = config.get<string>('shopify.apiKey') as string;
    clientSecret = config.get<string>('shopify.clientSecret') as string;
    sessionSecret = config.get<string>('session.secret') as string;

    await dataSource.query(`DELETE FROM campaigns WHERE shop_id IN ($1, $2)`, [
      SHOP_ID,
      OTHER_ID,
    ]);
    await dataSource.query(`DELETE FROM shops WHERE id IN ($1, $2)`, [
      SHOP_ID,
      OTHER_ID,
    ]);
    await dataSource.query(
      `INSERT INTO shops (id, shopify_shop_id, shop_domain, access_token_encrypted, status)
       VALUES ($1, 'token-auth',  $2, 'ciphertext', 'ACTIVE'),
              ($3, 'token-other', $4, 'ciphertext', 'ACTIVE')`,
      [SHOP_ID, SHOP_DOMAIN, OTHER_ID, OTHER_DOMAIN],
    );
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM campaigns WHERE shop_id IN ($1, $2)`, [
      SHOP_ID,
      OTHER_ID,
    ]);
    await dataSource.query(`DELETE FROM shops WHERE id IN ($1, $2)`, [
      SHOP_ID,
      OTHER_ID,
    ]);
    await app.close();
  });

  /** A token shaped and signed exactly the way Shopify mints one. */
  function sessionToken(
    shopDomain = SHOP_DOMAIN,
    overrides: Record<string, unknown> = {},
    secret = clientSecret,
  ): string {
    const now = Math.floor(Date.now() / 1000);
    return jwt.sign(
      {
        iss: `https://${shopDomain}/admin`,
        dest: `https://${shopDomain}`,
        aud: apiKey,
        sub: '99',
        exp: now + 60,
        nbf: now - 5,
        iat: now - 5,
        jti: 'jti-e2e',
        sid: 'sid-e2e',
        ...overrides,
      },
      { secret, algorithm: 'HS256' },
    );
  }

  it('authenticates a guarded request with a session token', async () => {
    await request(app.getHttpServer())
      .get('/campaigns')
      .set('Authorization', `Bearer ${sessionToken()}`)
      .expect(200);
  });

  it('scopes the request to the shop the token names', async () => {
    // Both shops exist and both are ACTIVE; only the token decides which one
    // the request acts as.
    const mine = await request(app.getHttpServer())
      .get('/campaigns')
      .set('Authorization', `Bearer ${sessionToken()}`)
      .expect(200);

    const theirs = await request(app.getHttpServer())
      .get('/campaigns')
      .set('Authorization', `Bearer ${sessionToken(OTHER_DOMAIN)}`)
      .expect(200);

    expect(mine.body).toBeDefined();
    expect(theirs.body).toBeDefined();
  });

  it('ignores a shop id supplied by the client', async () => {
    // The whole point of deriving the shop from the credential. The other shop
    // owns a campaign; naming that shop in the query must not surface it.
    await dataSource.query(
      `INSERT INTO campaigns (id, shop_id, title) VALUES ($1, $2, 'Other shop campaign')
       ON CONFLICT (id) DO NOTHING`,
      [OTHER_CAMPAIGN, OTHER_ID],
    );

    const response = await request(app.getHttpServer())
      .get('/campaigns')
      .query({ shopId: OTHER_ID })
      .set('Authorization', `Bearer ${sessionToken()}`)
      .expect(200);

    const titles = JSON.stringify(response.body);
    expect(titles).not.toContain('Other shop campaign');
  });

  it('does surface that campaign to the shop that owns it', async () => {
    // The negative above would also pass if the endpoint returned nothing at
    // all, so the same row is asserted visible from the other side.
    const response = await request(app.getHttpServer())
      .get('/campaigns')
      .set('Authorization', `Bearer ${sessionToken(OTHER_DOMAIN)}`)
      .expect(200);

    expect(JSON.stringify(response.body)).toContain('Other shop campaign');
  });

  it('refuses a request with no credential at all', async () => {
    await request(app.getHttpServer()).get('/campaigns').expect(401);
  });

  it('refuses a token signed with the wrong secret', async () => {
    await request(app.getHttpServer())
      .get('/campaigns')
      .set('Authorization', `Bearer ${sessionToken(SHOP_DOMAIN, {}, 'wrong')}`)
      .expect(401);
  });

  it('refuses a token issued to a different app', async () => {
    // Genuine Shopify token, genuine shop — but minted for someone else's app.
    await request(app.getHttpServer())
      .get('/campaigns')
      .set(
        'Authorization',
        `Bearer ${sessionToken(SHOP_DOMAIN, { aud: 'another-apps-client-id' })}`,
      )
      .expect(401);
  });

  it('refuses an expired token', async () => {
    const now = Math.floor(Date.now() / 1000);
    await request(app.getHttpServer())
      .get('/campaigns')
      .set(
        'Authorization',
        `Bearer ${sessionToken(SHOP_DOMAIN, { exp: now - 30, iat: now - 300 })}`,
      )
      .expect(401);
  });

  it('answers APP_NOT_INSTALLED for a shop with no install', async () => {
    // The code is what lets the frontend send the merchant to OAuth instead of
    // showing them a dead end.
    const response = await request(app.getHttpServer())
      .get('/campaigns')
      .set('Authorization', `Bearer ${sessionToken(GONE_DOMAIN)}`)
      .expect(401);

    expect((response.body as { code?: string }).code).toBe('APP_NOT_INSTALLED');
  });

  it('still accepts the session cookie when there is no token', async () => {
    // The non-embedded path — the post-install landing, or a tab opened
    // directly — has no App Bridge to ask.
    const cookie = jwt.sign(
      { shopId: SHOP_ID },
      { secret: sessionSecret, expiresIn: '1d' },
    );

    await request(app.getHttpServer())
      .get('/campaigns')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${cookie}`)
      .expect(200);
  });

  it('prefers the token when both are present', async () => {
    // A cookie left from a previous install must not outrank a token Shopify
    // minted seconds ago.
    const staleCookie = jwt.sign(
      { shopId: OTHER_ID },
      { secret: sessionSecret, expiresIn: '1d' },
    );

    await request(app.getHttpServer())
      .get('/campaigns')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${staleCookie}`)
      .set('Authorization', `Bearer ${sessionToken(GONE_DOMAIN)}`)
      // The token names a shop with no install, so the request fails — proving
      // the cookie was not consulted. Falling back would have returned 200.
      .expect(401);
  });
});
