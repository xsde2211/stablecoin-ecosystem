import { Controller, Post, Body, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { AuthGuard } from "@nestjs/passport";
import { NotificationService } from "./notification.service";
import { IsString, IsNotEmpty, IsOptional } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

class SendPushDto {
  @ApiProperty() @IsString() @IsNotEmpty() userId: string;
  @ApiProperty() @IsString() @IsNotEmpty() title: string;
  @ApiProperty() @IsString() @IsNotEmpty() body: string;
}

@ApiTags("Notifications")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"))
@Controller("notifications")
export class NotificationController {
  constructor(private svc: NotificationService) {}

  @Post("push")
  @ApiOperation({ summary: "Send push notification (internal use)" })
  push(@Body() dto: SendPushDto) { return this.svc.sendPush(dto); }
}
