import { Controller, Get, Post, Body, Param, Req, UseGuards, Query, DefaultValuePipe, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard }            from '@nestjs/passport';
import { NotificationService }  from './notification.service';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

class PushDto {
  @ApiProperty() @IsString() @IsNotEmpty() title: string;
  @ApiProperty() @IsString() @IsNotEmpty() body: string;
  @ApiProperty({ required:false }) @IsOptional() @IsString() userId?: string;
  @ApiProperty({ required:false }) @IsOptional() @IsString() type?: string;
}

class FcmDto {
  @ApiProperty() @IsString() @IsNotEmpty() token: string;
}

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('notifications')
export class NotificationController {
  constructor(private svc: NotificationService) {}

  @Post('push')
  @ApiOperation({ summary:'Send push notification to user or broadcast' })
  push(@Body() dto: PushDto) { return this.svc.push(dto); }

  @Post('fcm/register')
  @ApiOperation({ summary:'Register FCM push token for mobile app' })
  registerFcm(@Req() req: any, @Body() dto: FcmDto) { return this.svc.registerFcmToken(req.user.sub, dto.token); }

  @Get()
  @ApiOperation({ summary:'Get notifications for current user' })
  list(@Req() req:any, @Query('page',new DefaultValuePipe(1),ParseIntPipe) page:number, @Query('limit',new DefaultValuePipe(20),ParseIntPipe) limit:number) {
    return this.svc.getNotifications(req.user.sub, page, limit);
  }

  @Post('read')
  @ApiOperation({ summary:'Mark all notifications as read' })
  markAllRead(@Req() req: any) { return this.svc.markRead(req.user.sub); }

  @Post('read/:id')
  @ApiOperation({ summary:'Mark single notification as read' })
  markOneRead(@Req() req:any, @Param('id') id:string) { return this.svc.markRead(req.user.sub, id); }
}
