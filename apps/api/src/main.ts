import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import type { Request, Response } from 'express';

let cachedServer: (req: Request, res: Response) => void;

async function bootstrapServer() {
  if (!cachedServer) {
    const app = await NestFactory.create(AppModule, { bufferLogs: true });
    const configService = app.get(ConfigService);

    app.use(helmet());

    const webOrigin = configService.get<string>('WEB_ORIGIN') ?? process.env.WEB_ORIGIN ?? '*';
    
    app.enableCors({
      origin: webOrigin === '*' ? true : webOrigin,
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
      credentials: true,
    });

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    );

    await app.init();
    cachedServer = app.getHttpAdapter().getInstance();
  }

  return cachedServer;
}

export default async function handler(req: Request, res: Response) {
  const server = await bootstrapServer();
  return server(req, res);
}

if (!process.env.VERCEL) {
  const bootstrapLocal = async () => {
    const app = await NestFactory.create(AppModule, { bufferLogs: true });
    const configService = app.get(ConfigService);

    app.use(helmet());
    app.enableCors({
      origin: configService.get<string>('WEB_ORIGIN') ?? 'http://localhost:3742',
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
      credentials: true,
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    );

    const port = configService.get<number>('API_PORT') ?? 4732;
    await app.listen(port);
    new Logger('Bootstrap').log(`ProjectFlow API listening on http://localhost:${port}`);
  };

  void bootstrapLocal();
}