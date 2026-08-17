import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: true preserves the unparsed request body (as req.rawBody) so
  // webhook HMAC verification can hash the exact bytes Shopify signed.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  const configService = app.get(ConfigService);

  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );

  // Every route lives under /api, so the frontend origin and the backend origin
  // can be told apart at a glance and a reverse proxy has one prefix to route.
  // SHOPIFY_APP_URL carries this prefix, which is why the callback and webhook
  // URLs built from it land on real routes.
  app.setGlobalPrefix('api');

  // The embedded app runs on the frontend origin and calls this one, so every
  // request is cross-origin. `origin` is an exact string match against the
  // browser's `Origin` header, which never carries a trailing slash — the
  // config layer strips one if the environment supplied it.
  //
  // `credentials` keeps the session cookie working for the non-embedded paths
  // (the post-install landing, a directly-opened tab). Inside Shopify's iframe
  // that cookie is partitioned away and the Authorization header carries the
  // App Bridge session token instead.
  app.enableCors({
    origin: configService.get<string>('frontendUrl'),
    credentials: true,
  });

  const port = configService.get<number>('port') ?? 3000;
  await app.listen(port);
}
void bootstrap();
