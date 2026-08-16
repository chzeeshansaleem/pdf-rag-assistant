import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  const corsOrigin = configService.get<string>('corsOrigin', { infer: true }) ?? 'http://localhost:5173';
  // Support a comma-separated list so local dev isn't broken when Vite picks
  // a fallback port (5174, 5175, ...) because 5173 is already in use.
  const corsOrigins = corsOrigin.split(',').map((origin) => origin.trim());
  const port = configService.get<number>('port', { infer: true }) ?? 3001;

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: corsOrigins,
    methods: ['GET', 'POST', 'DELETE'],
  });

  // Strips unknown properties and rejects requests that don't match DTOs —
  // this is the app's primary defense against malformed/unexpected input.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  await app.listen(port);
  Logger.log(`🚀 Backend listening on http://localhost:${port}/api`, 'Bootstrap');
}
bootstrap();
