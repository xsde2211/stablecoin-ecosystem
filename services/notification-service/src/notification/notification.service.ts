import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService }  from '../redis/redis.service';
import axios from 'axios';

@Injectable()
export class NotificationService implements OnModuleInit {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private prisma: PrismaService, private redis: RedisService) {}

  async onModuleInit() {
    // Subscribe to KYC events from kyc-service
    await this.redis.subscribe('kyc:approved', async (msg) => {
      const { userId, applicationId } = JSON.parse(msg);
      await this.sendNotification(userId, {
        type:    'KYC_APPROVED',
        title:   'KYC Verified ✓',
        body:    'Your identity has been verified. You can now transact without limits.',
        data:    { applicationId },
      });
    });

    await this.redis.subscribe('kyc:rejected', async (msg) => {
      const { userId, reason } = JSON.parse(msg);
      await this.sendNotification(userId, {
        type:  'KYC_REJECTED',
        title: 'KYC Verification Failed',
        body:  `Reason: ${reason}. Please resubmit with valid documents.`,
        data:  { reason },
      });
    });

    this.logger.log('Notification service listening on Redis channels');
  }

  // ─── Send notification (core) ─────────────────────────────────────────────

  async sendNotification(userId: string, payload: {
    type: string; title: string; body: string; data?: Record<string,any>;
  }) {
    // Store in DB
    const notif = await this.prisma.notification.create({
      data: {
        userId,
        type:  payload.type,
        title: payload.title,
        body:  payload.body,
        data:  payload.data ? JSON.stringify(payload.data) : null,
        read:  false,
      },
    }).catch(() => null); // non-fatal if notification table missing

    // Push via FCM if token available
    const fcmToken = await this.redis.get(`fcm:${userId}`);
    if (fcmToken) {
      await this.sendFCM(fcmToken, payload.title, payload.body, payload.data).catch(e =>
        this.logger.warn(`FCM failed for ${userId}: ${e.message}`)
      );
    }

    this.logger.log(`Notification sent: ${payload.type} → user ${userId}`);
    return notif;
  }

  // ─── Direct push (from gateway) ──────────────────────────────────────────

  async push(dto: { userId?: string; title: string; body: string; type?: string; data?: any }) {
    if (dto.userId) {
      return this.sendNotification(dto.userId, {
        type:  dto.type ?? 'SYSTEM',
        title: dto.title,
        body:  dto.body,
        data:  dto.data,
      });
    }
    return { message:'No userId provided — broadcast not yet implemented' };
  }

  // ─── Register FCM token ───────────────────────────────────────────────────

  async registerFcmToken(userId: string, token: string) {
    await this.redis.set(`fcm:${userId}`, token, 60 * 60 * 24 * 30); // 30 days
    return { message: 'FCM token registered' };
  }

  // ─── Get user notifications ───────────────────────────────────────────────

  async getNotifications(userId: string, page=1, limit=20) {
    const [data, total, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where:   { userId },
        orderBy: { createdAt:'desc' },
        skip:    (page-1)*limit,
        take:    limit,
      }),
      this.prisma.notification.count({ where:{ userId } }),
      this.prisma.notification.count({ where:{ userId, read:false } }),
    ]);
    return { data, total, unread, page, limit, totalPages:Math.ceil(total/limit) };
  }

  // ─── Mark read ────────────────────────────────────────────────────────────

  async markRead(userId: string, notificationId?: string) {
    if (notificationId) {
      await this.prisma.notification.updateMany({
        where: { id:notificationId, userId },
        data:  { read:true, readAt:new Date() },
      });
    } else {
      await this.prisma.notification.updateMany({
        where: { userId, read:false },
        data:  { read:true, readAt:new Date() },
      });
    }
    return { message:'Notifications marked as read' };
  }

  // ─── FCM helper ───────────────────────────────────────────────────────────

  private async sendFCM(token: string, title: string, body: string, data?: any) {
    const serverKey = process.env.FCM_SERVER_KEY;
    if (!serverKey) return;
    await axios.post(
      'https://fcm.googleapis.com/fcm/send',
      { to:token, notification:{ title, body }, data: data ?? {} },
      { headers:{ Authorization:`key=${serverKey}`, 'Content-Type':'application/json' }, timeout:5000 },
    );
  }
}
