import { NestFactory }                    from '@nestjs/core';
import { ValidationPipe, Logger }         from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule }                      from './app.module';
import * as path                          from 'path';
import * as dotenv                        from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function bootstrap() {
  const app    = await NestFactory.create(AppModule);
  const logger = new Logger('StablecoinService');
  app.useGlobalPipes(new ValidationPipe({ whitelist:true, transform:true }));

  const config = new DocumentBuilder()
    .setTitle('Stablecoin Service')
    .setDescription('Token info, supply, oracle prices, reserve ratios for INRX/eGold/eSilver')
    .setVersion('1.0').addBearerAuth().build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));

  const port = process.env.PORT ?? 3005;
  await app.listen(port);
  logger.log(`Stablecoin service running on port ${port}`);
}
bootstrap();
