export type Locale = 'en' | 'th';

export type TranslationDict = Record<string, string>;

const en: TranslationDict = {
  // Navigation items
  'nav.dashboard': 'Dashboard',
  'nav.printers': 'Printers',
  'nav.discovery': 'Discovery',
  'nav.diagnostics': 'Diagnostics',
  'nav.templates': 'Templates',
  'nav.paperProfiles': 'Paper Profiles',
  'nav.sandbox': 'Sandbox',
  'nav.webhooks': 'Webhooks',
  'nav.routePolicies': 'Route Policies',
  'nav.bindings': 'Bindings',
  'nav.jobQueue': 'Job Queue',
  'nav.runners': 'Runners',
  'nav.auditLogs': 'Audit Logs',
  'nav.usersRoles': 'Users & Roles',
  'nav.export': 'Export',
  'nav.settings': 'Settings',

  // Navigation groups
  'nav.group.operations': 'Operator Workflow',
  'nav.group.administration': 'Administration',

  // Navigation accessibility
  'nav.menu.open': 'Open navigation menu',
  'nav.menu.close': 'Close navigation menu',
  'nav.ariaLabel': 'Main navigation',

  // Common
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.reset': 'Reset',
  'common.loading': 'Loading…',
  'common.error': 'An error occurred.',
  'common.signOut': 'Sign out',
  'common.signIn': 'Sign in',
  'common.signingIn': 'Signing in…',

  // Settings
  'settings.title': 'Settings',
  'settings.language': 'Language',
  'settings.language.en': 'English',
  'settings.language.th': 'ภาษาไทย',
  'settings.appearance': 'Appearance',
  'settings.appearance.theme': 'Theme',
  'settings.appearance.theme.light': 'Light',
  'settings.appearance.theme.dark': 'Dark',
  'settings.appearance.theme.system': 'System',
  'settings.workspace': 'Workspace Profile',
  'settings.workspace.projectName': 'Project Name',
  'settings.workspace.projectNamePlaceholder': 'Enter project or site name',
  'settings.workspace.workspacePath': 'Local Workspace Path',
  'settings.workspace.workspacePathPlaceholder': 'e.g. C:\\PrintOps\\workspace',
  'settings.saved': 'Settings saved.',
  'settings.savedError': 'Could not save settings.',
  'settings.resetConfirm': 'Reset all settings to defaults?',
  'settings.resetDone': 'Settings reset to defaults.',

  // Login
  'login.title': 'PrinterOps',
  'login.subtitle': 'Sign in to manage local printing operations.',
  'login.email': 'Email',
  'login.password': 'Password',
  'login.hint':
    'Dev accounts: sysadmin@printerops.local, admin@printerops.local, user@printerops.local, viewer@printerops.local',
  'login.error': 'Invalid email or password',

  // Splash
  'splash.starting': 'PrintOps is starting…',
  'splash.ready': 'System Ready',
  'splash.unable': 'Unable to connect to server',
  'splash.tagline': 'Print Gateway for Hospitals',
  'splash.progress': 'Starting… ({n}/120)',

  // Error boundary
  'error.title': 'Something went wrong',
  'error.reload': 'Reload App',

  // Session
  'session.signedInAs': 'Signed in as',
  'session.role': 'Role',
  'session.role.OWNER': 'Sysadmin',
  'session.role.ADMIN': 'Admin',
  'session.role.OPERATOR': 'User',
  'session.role.VIEWER': 'Viewer',
};

const th: TranslationDict = {
  // Navigation items
  'nav.dashboard': 'แดชบอร์ด',
  'nav.printers': 'เครื่องพิมพ์',
  'nav.discovery': 'ค้นหาเครื่องพิมพ์',
  'nav.diagnostics': 'การวินิจฉัย',
  'nav.templates': 'เทมเพลต',
  'nav.paperProfiles': 'โปรไฟล์กระดาษ',
  'nav.sandbox': 'แซนด์บ็อกซ์',
  'nav.webhooks': 'เว็บฮุก',
  'nav.routePolicies': 'นโยบายเส้นทาง',
  'nav.bindings': 'การผูก',
  'nav.jobQueue': 'คิวงาน',
  'nav.runners': 'ตัวรับงาน',
  'nav.auditLogs': 'บันทึกการตรวจสอบ',
  'nav.usersRoles': 'ผู้ใช้และบทบาท',
  'nav.export': 'ส่งออก',
  'nav.settings': 'การตั้งค่า',

  // Navigation groups
  'nav.group.operations': 'ขั้นตอนปฏิบัติงาน',
  'nav.group.administration': 'การจัดการระบบ',

  // Navigation accessibility
  'nav.menu.open': 'เปิดเมนูนำทาง',
  'nav.menu.close': 'ปิดเมนูนำทาง',
  'nav.ariaLabel': 'เมนูนำทางหลัก',

  // Common
  'common.save': 'บันทึก',
  'common.cancel': 'ยกเลิก',
  'common.reset': 'รีเซ็ต',
  'common.loading': 'กำลังโหลด…',
  'common.error': 'เกิดข้อผิดพลาด',
  'common.signOut': 'ออกจากระบบ',
  'common.signIn': 'เข้าสู่ระบบ',
  'common.signingIn': 'กำลังเข้าสู่ระบบ…',

  // Settings
  'settings.title': 'การตั้งค่า',
  'settings.language': 'ภาษา',
  'settings.language.en': 'English',
  'settings.language.th': 'ภาษาไทย',
  'settings.appearance': 'ลักษณะที่ปรากฏ',
  'settings.appearance.theme': 'ธีม',
  'settings.appearance.theme.light': 'สว่าง',
  'settings.appearance.theme.dark': 'มืด',
  'settings.appearance.theme.system': 'ตามระบบ',
  'settings.workspace': 'โปรไฟล์พื้นที่ทำงาน',
  'settings.workspace.projectName': 'ชื่อโปรเจกต์',
  'settings.workspace.projectNamePlaceholder': 'ระบุชื่อโปรเจกต์หรือไซต์',
  'settings.workspace.workspacePath': 'พาธพื้นที่ทำงาน',
  'settings.workspace.workspacePathPlaceholder': 'เช่น C:\\PrintOps\\workspace',
  'settings.saved': 'บันทึกการตั้งค่าแล้ว',
  'settings.savedError': 'ไม่สามารถบันทึกการตั้งค่าได้',
  'settings.resetConfirm': 'รีเซ็ตการตั้งค่าทั้งหมดเป็นค่าเริ่มต้น?',
  'settings.resetDone': 'รีเซ็ตการตั้งค่าเป็นค่าเริ่มต้นแล้ว',

  // Login
  'login.title': 'PrinterOps',
  'login.subtitle': 'เข้าสู่ระบบเพื่อจัดการการพิมพ์',
  'login.email': 'อีเมล',
  'login.password': 'รหัสผ่าน',
  'login.hint':
    'บัญชีสำหรับพัฒนา: sysadmin@printerops.local, admin@printerops.local, user@printerops.local, viewer@printerops.local',
  'login.error': 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',

  // Splash
  'splash.starting': 'PrintOps กำลังเริ่มทำงาน…',
  'splash.ready': 'ระบบพร้อมใช้งาน',
  'splash.unable': 'ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้',
  'splash.tagline': 'เกตเวย์การพิมพ์สำหรับโรงพยาบาล',
  'splash.progress': 'กำลังเริ่ม… ({n}/120)',

  // Error boundary
  'error.title': 'เกิดข้อผิดพลาด',
  'error.reload': 'โหลดแอปใหม่',

  // Session
  'session.signedInAs': 'เข้าสู่ระบบในนาม',
  'session.role': 'บทบาท',
  'session.role.OWNER': 'ผู้ดูแลระบบ',
  'session.role.ADMIN': 'ผู้ดูแล',
  'session.role.OPERATOR': 'ผู้ใช้งาน',
  'session.role.VIEWER': 'ผู้ชม',
};

export const translations: Record<Locale, TranslationDict> = { en, th };

export function t(locale: Locale, key: string): string {
  return translations[locale]?.[key] ?? translations.en[key] ?? key;
}
