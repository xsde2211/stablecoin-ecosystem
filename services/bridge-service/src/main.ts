import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors();

  const config = new DocumentBuilder()
    .setTitle('Bridge Service')
    .setDescription('Cross-chain bridge for INRX, EGOLD, ESLVR — supports Sepolia, BSC Testnet, Polygon Amoy, Tron Nile')
    .setVersion('2.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));

  const port = process.env.PORT ?? 3004;
  await app.listen(port);
  new Logger('BridgeService').log(`Bridge service v2 running on port ${port}`);
}
bootstrap();
