import {
  Controller, Post, Body, Req,
  HttpCode, HttpStatus, UseGuards, Get,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthService }   from './auth.service';
import { RegisterDto }   from './dto/register.dto';
import { LoginDto }      from './dto/login.dto';
import { RefreshDto }    from './dto/refresh.dto';
import { JwtAuthGuard }  from './jwt-auth.guard';
import { JwtRefreshGuard } from './jwt-refresh.guard';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register new user' })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email + password' })
  login(@Body() dto: LoginDto, @Req() req: any) {
    const ip = req.ip ?? req.headers['x-forwarded-for'] ?? 'unknown';
    return this.auth.login(dto, ip);
  }

  @Post('refresh')
  @UseGuards(JwtRefreshGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get new access token using refresh token' })
  refresh(@Req() req: any) {
    return this.auth.refresh(req.user.refreshToken);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout and invalidate tokens' })
  logout(@Req() req: any, @Body() dto: RefreshDto) {
    return this.auth.logout(req.user.sub, dto.refreshToken);
  }

  @Post('2fa/setup')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate 2FA secret and QR code URL' })
  setup2FA(@Req() req: any) {
    return this.auth.setup2FA(req.user.sub);
  }

  @Post('2fa/verify')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verify and activate 2FA' })
  verify2FA(@Req() req: any, @Body('token') token: string) {
    return this.auth.verify2FA(req.user.sub, token);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user info' })
  me(@Req() req: any) {
    return req.user;
  }
}