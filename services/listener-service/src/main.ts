import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { AppModule } from "./app.module";
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT ?? 3014;
  await app.listen(port);
  new Logger("ListenerService").log(`Running on port ${port}`);
}
bootstrap();
