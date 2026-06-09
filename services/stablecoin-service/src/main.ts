import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors();

  const config = new DocumentBuilder()
    .setTitle('Stablecoin Service')
    .setDescription(
      'Manages INRX, EGOLD, ESLVR across Sepolia, BSC Testnet, Polygon Amoy, Tron Nile. ' +
      'Includes token info, oracle prices, proof-of-reserve, treasury timelock, compliance.',
    )
    .setVersion('2.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));

  const port = process.env.PORT ?? 3005;
  await app.listen(port);
  new Logger('StablecoinService').log(`Stablecoin service v2 running on port ${port}`);
}
bootstrap();
