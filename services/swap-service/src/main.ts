import { NestFactory }                    from '@nestjs/core';
import { ValidationPipe, Logger }         from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule }                      from './app.module';
import * as path                          from 'path';
import * as dotenv                        from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function bootstrap() {
  const app    = await NestFactory.create(AppModule);
  const logger = new Logger('SwapService');

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const config = new DocumentBuilder()
    .setTitle('Swap Service')
    .setDescription('Swap INRX / eGold / eSilver with each other, native chain gas tokens, or any other token')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));

  const port = process.env.PORT ?? 3016;
  await app.listen(port);
  logger.log(`Swap service running on port ${port}`);
}
bootstrap();
