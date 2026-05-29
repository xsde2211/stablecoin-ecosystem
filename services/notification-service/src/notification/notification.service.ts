import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export interface NotifyParams {
  userId: string; title: string; body: string; data?: Record<string, string>;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  constructor(private prisma: PrismaService) {}

  async sendPush(params: NotifyParams) {
    // Production: const msg = { notification: { title: params.title, body: params.body }, data: params.data, token: fcmToken };
    // await admin.messaging().send(msg);
    this.logger.log(`[PUSH] → ${params.userId}: ${params.title}`);
    return { sent: true, channel: "push" };
  }

  async sendEmail(to: string, subject: string, html: string) {
    // Production: use SendGrid / AWS SES
    // await sgMail.send({ to, from: "noreply@yourdomain.com", subject, html });
    this.logger.log(`[EMAIL] → ${to}: ${subject}`);
    return { sent: true, channel: "email" };
  }

  async notifyTransactionConfirmed(userId: string, txHash: string, amount: string, token: string) {
    return this.sendPush({ userId, title: "Transaction Confirmed", body: `${amount} ${token} confirmed`, data: { txHash, type: "tx_confirmed" } });
  }

  async notifyBridgeCompleted(userId: string, amount: string, src: string, dst: string) {
    return this.sendPush({ userId, title: "Bridge Complete", body: `${amount} transferred from ${src} to ${dst}`, data: { type: "bridge_complete" } });
  }

  async notifyPaymentReceived(userId: string, amount: string, token: string) {
    return this.sendPush({ userId, title: "Payment Received", body: `Received ${amount} ${token}`, data: { type: "payment_received" } });
  }

  async notifyKycStatus(userId: string, status: "APPROVED" | "REJECTED") {
    const msg = status === "APPROVED" ? "Your KYC has been approved" : "Your KYC was rejected. Please resubmit.";
    return this.sendPush({ userId, title: `KYC ${status}`, body: msg, data: { type: "kyc_status", status } });
  }
}
