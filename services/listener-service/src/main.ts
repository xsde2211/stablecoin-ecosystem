import { NestFactory }            from '@nestjs/core';
import { Logger }                 from '@nestjs/common';
import { AppModule }              from './app.module';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('ListenerService');
  const port = process.env.PORT ?? 3014;
  await app.listen(port);
  logger.log(`Listener service running on port ${port} — watching chains for events`);
}
bootstrap();
