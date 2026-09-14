import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { Request, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';

type ServerHandler = (req: Request, res: Response) => void;

let cachedServer: ServerHandler;

async function createApp() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });


  app.use(helmet());

  app.enableCors({
  origin: true,
  credentials: true,
});

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

  return app;
}

// Local development
async function bootstrap(): Promise<void> {
  const app = await createApp();

  const configService = app.get(ConfigService);
  const port = configService.get<number>('API_PORT') ?? 4732;

  await app.listen(port);

  new Logger('Bootstrap').log(
    `ProjectFlow API listening on http://localhost:${port}`,
  );
}

// Vercel serverless handler
async function bootstrapServer(): Promise<ServerHandler> {
  if (!cachedServer) {
    const app = await createApp();

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
    console.error('BOOTSTRAP ERROR:', error);

    return res.status(500).json({
      statusCode: 500,
      message: 'Server failed to start',
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

if (process.env.VERCEL) {
  module.exports = handler;
  module.exports.default = handler;
} else {
  void bootstrap();
}
