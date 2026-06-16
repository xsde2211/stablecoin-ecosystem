import { NestFactory }     from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule }       from './app.module';
import helmet              from 'helmet';
import compression         from 'compression';
import { networkInterfaces } from 'os';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Gateway has no DB — only needs JWT_SECRET, REDIS_URL, and *_SERVICE_URL vars,
// all of which live in the root .env (2 levels up from services/gateway/src)
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function bootstrap() {
  const app    = await NestFactory.create(AppModule);
  const logger = new Logger('Gateway');

  // Compression first
  app.use(compression());

  // Helmet with relaxed settings for development
  // Disabling headers that break Swagger UI + mobile network access
  app.use(helmet({
    crossOriginOpenerPolicy:    false,
    crossOriginEmbedderPolicy:  false,
    contentSecurityPolicy:      false,
    hsts:                       false,
  }));

  // CORS — allow configured origins, or everything if unset (dev convenience)
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(o => o.trim());
  app.enableCors({
    origin:         allowedOrigins?.length ? allowedOrigins : true,
    credentials:    true,
    methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  });

  // Request validation — applies only to gateway's own routes (health),
  // proxied requests pass through raw via the catch-all controller.
  app.useGlobalPipes(new ValidationPipe({
    whitelist:            true,
    forbidNonWhitelisted: false, // catch-all proxy must allow arbitrary bodies
    transform:            true,
  }));

  const localIP = getLocalIP();
  const port    = Number(process.env.GATEWAY_PORT ?? process.env.PORT ?? 3001);

  const config = new DocumentBuilder()
    .setTitle('Stablecoin Ecosystem API')
    .setDescription('e₹ / eGold / eSilver cross-chain stablecoin platform — unified gateway')
    .setVersion('1.0')
    .addBearerAuth()
    .addServer(`http://localhost:${port}`,  'Localhost')
    .addServer(`http://${localIP}:${port}`, 'Local Network (for mobile)')
    .build();

  SwaggerModule.setup(
    'docs',
    app,
    SwaggerModule.createDocument(app, config),
    {
      swaggerOptions: {
        persistAuthorization:   true,
        displayRequestDuration: true,
      },
    },
  );

  await app.listen(port, '0.0.0.0');

  logger.log(`Gateway        → http://localhost:${port}`);
  logger.log(`Swagger docs   → http://localhost:${port}/docs`);
  logger.log(`Mobile access  → http://${localIP}:${port}`);
  logger.log(`Health check   → http://${localIP}:${port}/health`);
}

function getLocalIP(): string {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of (nets[name] ?? [])) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

bootstrap();
