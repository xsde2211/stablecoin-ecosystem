import { Module } from "@nestjs/common";
import { PassportModule } from "@nestjs/passport";
import { JwtModule } from "@nestjs/jwt";
import { AdminController } from "./admin.controller";
import { AdminService }    from "./admin.service";
import { JwtStrategy } from '../auth/jwt.strategy';
@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt' }), JwtModule.register({ secret: process.env.JWT_SECRET })],
  controllers: [AdminController],
  providers: [AdminService, JwtStrategy],
})
export class AdminModule {}
