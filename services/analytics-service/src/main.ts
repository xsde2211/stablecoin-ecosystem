import { NestFactory } from "@nestjs/core";
import { ValidationPipe, Logger } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { AppModule } from "./app.module";
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const config = new DocumentBuilder().setTitle("Analytics Service").setVersion("1.0").addBearerAuth().build();
  SwaggerModule.setup("docs", app, SwaggerModule.createDocument(app, config));
  const port = process.env.PORT ?? 3012;
  await app.listen(port);
  new Logger("AnalyticsService").log(`Running on port ${port}`);
}
bootstrap();
