import { NestFactory }                    from '@nestjs/core';
import { ValidationPipe, Logger }         from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule }                      from './app.module';
import * as path                          from 'path';
import * as dotenv                        from 'dotenv';

// Load root .env — 3 levels up: services/auth-service/src → root
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function bootstrap() {
  const app    = await NestFactory.create(AppModule);
  const logger = new Logger('AuthService');

  app.useGlobalPipes(new ValidationPipe({
    whitelist:            true,
    forbidNonWhitelisted: true,
    transform:            true,
  }));

  const config = new DocumentBuilder()
    .setTitle('Auth Service')
    .setDescription('Authentication, registration, 2FA, JWT management')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));

  const port = process.env.PORT ?? 3002;
  await app.listen(port);
  logger.log(`Auth service running on port ${port}`);
}
bootstrap();
