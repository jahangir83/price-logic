import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
// `cookie-parser` is `export =`, not an ES default export — a default
// import compiles to a `.default` property access that doesn't exist at
// runtime under Nest's SWC builder, even though `tsc` type-checks it fine.
import * as cookieParser from 'cookie-parser';
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
  app.enableCors({
    origin: configService.get<string>('frontendUrl'),
    credentials: true,
  });

  const port = configService.get<number>('port') ?? 3000;
  await app.listen(port);
}
void bootstrap();
