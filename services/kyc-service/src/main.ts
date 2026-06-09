import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors();

  const config = new DocumentBuilder()
    .setTitle('KYC Service')
    .setDescription(
      'Know Your Customer service. Supports HyperVerge, DigiLocker, Onfido. ' +
      'Webhook endpoints for async provider callbacks. ' +
      'On approval: user.kycStatus → APPROVED, canTransact → true.',
    )
    .setVersion('2.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));

  const port = process.env.PORT ?? 3010;
  await app.listen(port);
  new Logger('KycService').log(`KYC service v2 running on port ${port}`);
}
bootstrap();
