import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { loadServerEnv } from '@ai-crm/config';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const env = loadServerEnv(process.env);
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: env.APP_URL, credentials: false });
  const port = Number(new URL(env.API_URL).port || 4000);
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
