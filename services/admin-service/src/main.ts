import { NestFactory }                    from '@nestjs/core';
import { ValidationPipe, Logger }         from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule }                      from './app.module';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// Transaction.blockNumber is a Prisma BigInt column; JSON.stringify can't
// serialize BigInt by default. GET /admin/transactions returns these rows
// directly, so without this, any transaction with a confirmed block crashes
// the response.
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('AdminService');
  app.useGlobalPipes(new ValidationPipe({ whitelist:true, transform:true }));
  const config = new DocumentBuilder().setTitle('Admin Service').setDescription('User management, audit logs, system overview').setVersion('1.0').addBearerAuth().build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
  const port = 3015;
  await app.listen(port);
  logger.log(`Admin service running on port ${port}`);
}
bootstrap();