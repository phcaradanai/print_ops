import type { Locale } from './translations.js';

const fields: Record<Locale, Record<string, string>> = {
  en: {
    'page.webhooks.endpointCode': 'Endpoint code',
    'page.webhooks.endpointCodeHint': 'Use 1–64 letters, numbers, hyphens, or underscores. Start and end with a letter or number.',
    'page.webhooks.source': 'Source system',
    'page.webhooks.sourceHint': 'External integration service that sends intake requests to PrintOps.',
  },
  th: {
    'page.webhooks.endpointCode': 'รหัสจุดรับงาน',
    'page.webhooks.endpointCodeHint': 'ใช้ตัวอักษร ตัวเลข ขีดกลาง หรือขีดล่าง 1–64 ตัว และขึ้นต้นลงท้ายด้วยตัวอักษรหรือตัวเลข',
    'page.webhooks.source': 'ระบบต้นทาง',
    'page.webhooks.sourceHint': 'บริการเชื่อมต่อภายนอกที่ส่งคำขอรับงานมายัง PrintOps',
  },
};

export function webhookFieldTranslation(locale: Locale, key: string): string | undefined {
  return fields[locale][key];
}
