import {
  Controller, Post, Get, Body, Req,
  HttpCode, HttpStatus, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiBody } from '@nestjs/swagger';
import { AuthService }      from './auth.service';
import { RegisterDto }      from './dto/register.dto';
import { LoginDto }         from './dto/login.dto';
import { RefreshDto }       from './dto/refresh.dto';
import { Verify2FADto }     from './dto/verify-2fa.dto';
import { JwtAuthGuard }     from './jwt-auth.guard';
import { JwtRefreshGuard }  from './jwt-refresh.guard';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register new user — returns access + refresh tokens' })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email + password (+ TOTP if 2FA enabled)' })
  login(@Body() dto: LoginDto, @Req() req: any) {
    const ip = req.ip ?? req.headers['x-forwarded-for'] ?? 'unknown';
    return this.auth.login(dto, ip);
  }

  @Post('refresh')
  @UseGuards(JwtRefreshGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate refresh token — get new access + refresh pair' })
  refresh(@Req() req: any) {
    return this.auth.refresh(req.user.refreshToken);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout — invalidates refresh token and blacklists access token' })
  logout(@Req() req: any, @Body() dto: RefreshDto) {
    const accessToken = req.headers.authorization?.replace('Bearer ', '');
    return this.auth.logout(req.user.sub, dto.refreshToken, accessToken);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current authenticated user profile' })
  me(@Req() req: any) {
    return this.auth.getMe(req.user.sub);
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
  @ApiOperation({ summary: 'Verify TOTP code and enable 2FA on account' })
  verify2FA(@Req() req: any, @Body() dto: Verify2FADto) {
    return this.auth.verify2FA(req.user.sub, dto.token);
  }

  @Post('2fa/disable')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disable 2FA — requires valid TOTP code to confirm' })
  disable2FA(@Req() req: any, @Body() dto: Verify2FADto) {
    return this.auth.disable2FA(req.user.sub, dto.token);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change password — requires current password' })
  @ApiBody({
    schema: {
      properties: {
        currentPassword: { type:'string' },
        newPassword:     { type:'string' },
      },
    },
  })
  changePassword(
    @Req() req: any,
    @Body('currentPassword') currentPassword: string,
    @Body('newPassword')     newPassword:     string,
  ) {
    return this.auth.changePassword(req.user.sub, currentPassword, newPassword);
  }
}
