import { NestFactory }     from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule }       from './app.module';
import helmet              from 'helmet';
import compression    from 'compression';

async function bootstrap() {
  const app    = await NestFactory.create(AppModule);
  const logger = new Logger('Gateway');

  // Security headers
  app.use(helmet());

  // Gzip compression
  app.use(compression());

  // CORS — allow your frontend origins
  app.enableCors({
    origin:      process.env.ALLOWED_ORIGINS?.split(',') ?? ['http://localhost:3000'],
    credentials: true,
    methods:     ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  });

  // Validate all incoming request bodies
  app.useGlobalPipes(new ValidationPipe({
    whitelist:            true,
    forbidNonWhitelisted: true,
    transform:            true,
  }));

  // Swagger docs
  const config = new DocumentBuilder()
    .setTitle('Stablecoin Ecosystem API')
    .setDescription('e₹ / eGold / eSilver cross-chain stablecoin platform — API Gateway')
    .setVersion('1.0')
    .addBearerAuth()
    .addServer('http://localhost:3001', 'Local Development')
    .build();

  SwaggerModule.setup(
    'docs',
    app,
    SwaggerModule.createDocument(app, config),
    {
      swaggerOptions: {
        persistAuthorization: true,    // keeps JWT token between page refreshes
        displayRequestDuration: true,
      },
    }
  );

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  logger.log(`Gateway running on http://localhost:${port}`);
  logger.log(`Swagger docs at http://localhost:${port}/docs`);
}
bootstrap();