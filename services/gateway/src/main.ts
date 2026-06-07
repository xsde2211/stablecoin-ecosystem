import { NestFactory }     from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule }       from './app.module';
import helmet              from 'helmet';
import compression         from 'compression';
import { networkInterfaces } from 'os';

async function bootstrap() {
  const app    = await NestFactory.create(AppModule);
  const logger = new Logger('Gateway');

  // Compression first
  app.use(compression());

  // Helmet with relaxed settings for development
  // Disabling the problematic headers that break Swagger + mobile access
  app.use(helmet({
    crossOriginOpenerPolicy:    false,  // was blocking Swagger
    crossOriginEmbedderPolicy:  false,  // was blocking Swagger assets
    contentSecurityPolicy:      false,  // was blocking CDN resources in Swagger
    hsts:                       false,  // was forcing HTTPS redirect
  }));

  // CORS — allow everything in development
  app.enableCors({
    origin:         true,
    credentials:    true,
    methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  });

  // Request validation
  app.useGlobalPipes(new ValidationPipe({
    whitelist:            true,
    forbidNonWhitelisted: true,
    transform:            true,
  }));

  // Swagger docs
  const localIP = getLocalIP();
  const port    = process.env.PORT ?? 3001;

  const config = new DocumentBuilder()
    .setTitle('Stablecoin Ecosystem API')
    .setDescription('e₹ / eGold / eSilver cross-chain stablecoin platform')
    .setVersion('1.0')
    .addBearerAuth()
    .addServer(`http://localhost:${port}`,    'Localhost')
    .addServer(`http://${localIP}:${port}`,   'Local Network (for mobile)')
    .build();

  SwaggerModule.setup(
    'docs',
    app,
    SwaggerModule.createDocument(app, config),
    {
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
      },
    }
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