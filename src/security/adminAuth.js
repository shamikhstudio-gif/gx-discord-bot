import crypto from 'crypto';

// 🔒 Cryptographic Salt & Master Hash for "Qwert54321!@#$%"
// Derived using PBKDF2 with HMAC-SHA512 (100,000 iterations)
const AUTH_SALT = 'e61b9a7c3d2f4e8b01a5c7d9e2f4b6a8';
const AUTH_ITERATIONS = 100000;
const AUTH_KEYLEN = 64;
const AUTH_DIGEST = 'sha512';

// Pre-computed hash of "Qwert54321!@#$%" with AUTH_SALT
const MASTER_PASSWORD_HASH = crypto.pbkdf2Sync(
  'Qwert54321!@#$%',
  AUTH_SALT,
  AUTH_ITERATIONS,
  AUTH_KEYLEN,
  AUTH_DIGEST
).toString('hex');

// Dynamic Server Secret for Session Signing (generated per server lifecycle or persistent)
const JWT_SECRET = process.env.ADMIN_JWT_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 Hours

// Rate Limiting Map: IP -> { attempts, lockedUntil }
const loginRateLimit = new Map();

/**
 * 🔑 Verifies if provided plain password matches the Master Password hash.
 */
export function verifyMasterPassword(plainPassword) {
  if (!plainPassword || typeof plainPassword !== 'string') return false;
  try {
    const computedHash = crypto.pbkdf2Sync(
      plainPassword,
      AUTH_SALT,
      AUTH_ITERATIONS,
      AUTH_KEYLEN,
      AUTH_DIGEST
    ).toString('hex');

    return crypto.timingSafeEqual(
      Buffer.from(computedHash, 'utf-8'),
      Buffer.from(MASTER_PASSWORD_HASH, 'utf-8')
    );
  } catch {
    return false;
  }
}

/**
 * 🛡️ Rate limit checker for login attempts.
 */
export function checkRateLimit(ip) {
  const now = Date.now();
  const entry = loginRateLimit.get(ip);
  if (!entry) return { allowed: true };

  if (entry.lockedUntil && now < entry.lockedUntil) {
    const remainingSec = Math.ceil((entry.lockedUntil - now) / 1000);
    return { allowed: false, error: `حساب مغلق مؤقتاً لمحاولات متكررة. يرجى المحاولة بعد ${remainingSec} ثانية.` };
  }

  if (entry.lockedUntil && now >= entry.lockedUntil) {
    loginRateLimit.delete(ip);
    return { allowed: true };
  }

  return { allowed: true };
}

export function recordFailedLogin(ip) {
  const now = Date.now();
  const entry = loginRateLimit.get(ip) || { attempts: 0, lockedUntil: 0 };
  entry.attempts += 1;

  if (entry.attempts >= 5) {
    entry.lockedUntil = now + (10 * 60 * 1000); // Lock for 10 minutes
  }
  loginRateLimit.set(ip, entry);
}

export function clearFailedLogin(ip) {
  loginRateLimit.delete(ip);
}

/**
 * 🎟️ Issues a cryptographically signed HMAC-SHA256 session token.
 */
export function createAdminSessionToken(userRole = 'HIGH_COMMAND') {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    role: userRole,
    iat: Date.now(),
    exp: Date.now() + SESSION_TTL_MS
  })).toString('base64url');

  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');

  return `${header}.${payload}.${signature}`;
}

/**
 * 🔍 Verifies and decodes an admin session token.
 */
export function verifyAdminSession(token) {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signatureB64] = parts;

  const expectedSignature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');

  if (signatureB64 !== expectedSignature) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
    if (!payload.exp || Date.now() > payload.exp) {
      return null; // Expired
    }
    return payload;
  } catch {
    return null;
  }
}
