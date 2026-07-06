export type NotificationChannel = 'email' | 'webhook' | 'slack';

export interface Notification {
  channel: NotificationChannel;
  recipient: string;
  subject: string;
  body: string;
  metadata?: Record<string, unknown>;
}

export interface NotificationPort {
  send(notification: Notification): Promise<void>;
}
