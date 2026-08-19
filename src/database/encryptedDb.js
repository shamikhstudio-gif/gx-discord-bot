import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// Authenticated Encryption Key (AES-256-GCM)
const ENCRYPTION_SECRET = process.env.DB_ENCRYPTION_SECRET || 'gx_esports_enterprise_command_secure_key_2026';
const DB_KEY = crypto.createHash('sha256').update(ENCRYPTION_SECRET).digest();

function getDbPath() {
  const dir = path.resolve(process.cwd(), 'data');
  if (!fs.existsSync(dir)) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  }
  return path.join(dir, 'gx_secure_db.enc');
}

export class EncryptedDatabase {
  constructor() {
    this.data = {
      appeals: {},
      panels: {},
      settings: {
        autoRoleName: 'UNTRUSTED',
        autoRoleId: '1538486805211389982',
        welcomeChannelId: '1538560876339265667',
        leaveChannelId: '1538561457912946788',
        sustainedThreshold: 11000,
        instantThreshold: 16000,
        muteDurationSeconds: 30
      },
      audit_logs: []
    };
    this.load();
  }

  encrypt(plainText) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', DB_KEY, iv);
    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return JSON.stringify({
      iv: iv.toString('hex'),
      authTag,
      data: encrypted
    });
  }

  decrypt(payload) {
    try {
      const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
      if (!parsed.iv || !parsed.authTag || !parsed.data) return null;
      const iv = Buffer.from(parsed.iv, 'hex');
      const authTag = Buffer.from(parsed.authTag, 'hex');
      const decipher = crypto.createDecipheriv('aes-256-gcm', DB_KEY, iv);
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(parsed.data, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return JSON.parse(decrypted);
    } catch {
      return null;
    }
  }

  load() {
    try {
      const file = getDbPath();
      if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, 'utf8');
        const decrypted = this.decrypt(raw);
        if (decrypted && typeof decrypted === 'object') {
          this.data = Object.assign(this.data, decrypted);
        }
      }
    } catch (err) {
      console.warn('⚠️ [قاعدة البيانات المشفرة] تعذر قراءة الملف:', err.message);
    }
  }

  save() {
    try {
      const file = getDbPath();
      const jsonStr = JSON.stringify(this.data, null, 2);
      const encrypted = this.encrypt(jsonStr);
      fs.writeFileSync(file, encrypted, { encoding: 'utf8', flag: 'w' });
      return true;
    } catch (err) {
      console.error('❌ [قاعدة البيانات المشفرة] خطأ في الحفظ:', err.message);
      return false;
    }
  }

  // --- Appeals API ---
  getAppeals() {
    return this.data.appeals || {};
  }

  getAppeal(targetId) {
    return this.data.appeals[targetId] || null;
  }

  setAppeal(targetId, appealObj) {
    this.data.appeals[targetId] = appealObj;
    this.save();
    return appealObj;
  }

  // --- Panels API ---
  getPanels() {
    return this.data.panels || {};
  }

  getPanel(panelType) {
    return this.data.panels[panelType] || null;
  }

  setPanel(panelType, panelObj) {
    this.data.panels[panelType] = { ...panelObj, updatedAt: Date.now() };
    this.save();
    return this.data.panels[panelType];
  }

  removePanel(panelType) {
    if (this.data.panels[panelType]) {
      this.data.panels[panelType].status = 'removed';
      this.data.panels[panelType].updatedAt = Date.now();
      this.save();
      return true;
    }
    return false;
  }

  // --- Settings API ---
  getSettings() {
    return this.data.settings || {};
  }

  updateSettings(newSettings) {
    this.data.settings = { ...this.data.settings, ...newSettings };
    this.save();
    return this.data.settings;
  }

  // --- Audit Logs ---
  getAuditLogs(limit = 100) {
    return (this.data.audit_logs || []).slice(0, limit);
  }

  addAuditLog(action, details, actor = 'ADMIN') {
    const entry = {
      id: crypto.randomBytes(6).toString('hex'),
      action,
      details,
      actor,
      timestamp: Date.now()
    };
    if (!this.data.audit_logs) this.data.audit_logs = [];
    this.data.audit_logs.unshift(entry);
    if (this.data.audit_logs.length > 500) this.data.audit_logs.pop();
    this.save();
    return entry;
  }
}

export const db = new EncryptedDatabase();
