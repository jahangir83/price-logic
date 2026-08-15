import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module';

/**
 * The gate the frontend asks before it renders anything.
 *
 * Every merchant hits this endpoint on every load, before a session exists, so
 * it is the one route that must answer correctly with no authentication at all
 * — and must never answer "installed" for a shop whose token no longer works,
 * because that produces an app that renders and then 401s on every request.
 */
describe('install gate (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;

  const ACTIVE_SHOP = 'e1e1e1e1-0000-4000-8000-0000000000e1';
  const GONE_SHOP = 'e2e2e2e2-0000-4000-8000-0000000000e2';
  const ACTIVE_DOMAIN = 'installed-gate.myshopify.com';
  const GONE_DOMAIN = 'uninstalled-gate.myshopify.com';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    dataSource = app.get(DataSource);

    await dataSource.query(`DELETE FROM shops WHERE id IN ($1, $2)`, [
      ACTIVE_SHOP,
      GONE_SHOP,
    ]);
    await dataSource.query(
      `INSERT INTO shops (id, shopify_shop_id, shop_domain, access_token_encrypted, status)
       VALUES ($1, 'gate-active', $2, 'ciphertext', 'ACTIVE'),
              ($3, 'gate-gone',   $4, 'ciphertext', 'DISCONNECTED')`,
      [ACTIVE_SHOP, ACTIVE_DOMAIN, GONE_SHOP, GONE_DOMAIN],
    );
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM shops WHERE id IN ($1, $2)`, [
      ACTIVE_SHOP,
      GONE_SHOP,
    ]);
    await app.close();
  });

  it('answers installed for an active shop, with nothing to redirect to', async () => {
    const response = await request(app.getHttpServer())
      .get('/store/check-installation')
      .query({ shop: ACTIVE_DOMAIN })
      .expect(200);

    expect(response.body).toEqual({ installed: true, authUrl: null });
  });

  it('answers not-installed for a shop that has never installed', async () => {
    const response = await request(app.getHttpServer())
      .get('/store/check-installation')
      .query({ shop: 'never-seen-gate.myshopify.com' })
      .expect(200);

    const body = response.body as { installed: boolean; authUrl: string };
    expect(body.installed).toBe(false);
    expect(body.authUrl).toContain('/auth?shop=never-seen-gate.myshopify.com');
  });

  it('answers not-installed for a shop that uninstalled', async () => {
    // The row survives so the merchant's campaign history is still there when
    // they come back — but the token is dead, so they need OAuth again.
    const response = await request(app.getHttpServer())
      .get('/store/check-installation')
      .query({ shop: GONE_DOMAIN })
      .expect(200);

    const body = response.body as { installed: boolean; authUrl: string };
    expect(body.installed).toBe(false);
    expect(body.authUrl).toContain(GONE_DOMAIN);
  });

  it('carries host through to the auth URL', async () => {
    // App Bridge needs `host` to re-embed the app after OAuth, and it is lost
    // unless it makes the whole round trip.
    const response = await request(app.getHttpServer())
      .get('/store/check-installation')
      .query({ shop: 'never-seen-gate.myshopify.com', host: 'YWRtaW4uc2hvcA' })
      .expect(200);

    const body = response.body as { authUrl: string };
    expect(body.authUrl).toContain('host=YWRtaW4uc2hvcA');
  });

  it('needs no session cookie', async () => {
    // Asserted explicitly: the endpoint runs before a session can exist, so a
    // guard added to it later would lock every merchant out of the app.
    await request(app.getHttpServer())
      .get('/store/check-installation')
      .query({ shop: ACTIVE_DOMAIN })
      .expect(200);
  });

  it('rejects a domain that is not a myshopify domain', async () => {
    // Not an error — the frontend's only useful move either way is OAuth, and
    // there is nowhere safe to send a caller who supplied an arbitrary host.
    for (const shop of [
      'evil.example.com',
      'demo.myshopify.com.evil.com',
      'not a domain',
      '',
    ]) {
      const response = await request(app.getHttpServer())
        .get('/store/check-installation')
        .query({ shop })
        .expect(200);

      expect(response.body).toEqual({ installed: false, authUrl: null });
    }
  });

  it('answers without a shop parameter at all', async () => {
    const response = await request(app.getHttpServer())
      .get('/store/check-installation')
      .expect(200);

    expect(response.body).toEqual({ installed: false, authUrl: null });
  });
});
