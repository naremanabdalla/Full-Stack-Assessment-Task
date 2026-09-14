import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Request, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';

type ServerHandler = (req: Request, res: Response) => void;

let cachedServer: ServerHandler;

async function bootstrapServer(): Promise<ServerHandler> {
  if (!cachedServer) {
    const app = await NestFactory.create(AppModule, {
      bufferLogs: true,
    });

    app.enableCors({
      origin: 'https://projectflow-web-eta.vercel.app',
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    });

    app.use(helmet({ crossOriginResourcePolicy: false }));

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: {
          enableImplicitConversion: false,
        },
      }),
    );

    await app.init();

    cachedServer = app
      .getHttpAdapter()
      .getInstance() as ServerHandler;
  }

  return cachedServer;
}

const handler = async (
  req: Request,
  res: Response,
): Promise<void | Response> => {
  try {
    const server = await bootstrapServer();
    return server(req, res);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    console.error('BOOTSTRAP ERROR:', error);

    return res.status(500).json({
      statusCode: 500,
      message: 'Server failed to start',
      error: errorMessage,
    });
  }
};

export default handler;
module.exports = handler;
module.exports.default = handler;