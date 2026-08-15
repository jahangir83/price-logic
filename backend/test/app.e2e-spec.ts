import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  // The Nest scaffold shipped a `GET /` → "Hello World!" test; the controller
  // has only ever exposed a health probe, so the assertion was stale from the
  // first commit. This also boots the whole AppModule against a real database,
  // which makes it the cheapest check that every entity still maps.
  it('GET /health reports ok', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(200);

    const body = response.body as { status: string; timestamp: string };
    expect(body.status).toBe('ok');
    expect(Date.parse(body.timestamp)).not.toBeNaN();
  });
});
