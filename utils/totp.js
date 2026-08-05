const crypto = require('crypto');

function base32Decode(base32) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  let hex = '';
  const cleaned = (base32 || '').replace(/=+$/, '').toUpperCase();
  for (let i = 0; i < cleaned.length; i++) {
    const val = alphabet.indexOf(cleaned.charAt(i));
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    const chunk = bits.substr(i, 8);
    hex += parseInt(chunk, 2).toString(16).padStart(2, '0');
  }
  return Buffer.from(hex, 'hex');
}

function generateTOTP(secretBase32, timeStepSeconds = 30, timestamp = Date.now()) {
  const key = base32Decode(secretBase32);
  let time = Math.floor(timestamp / 1000 / timeStepSeconds);
  const buffer = Buffer.alloc(8);
  for (let i = 7; i >= 0; i--) {
    buffer[i] = time & 0xff;
    time = Math.floor(time / 256);
  }
  const hmac = crypto.createHmac('sha1', key).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = (
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  ) % 1000000;
  return code.toString().padStart(6, '0');
}

function verifyTOTP(token, secretBase32, window = 1) {
  if (!token || !secretBase32) return false;
  const cleanToken = token.trim();
  const now = Date.now();
  for (let errorWindow = -window; errorWindow <= window; errorWindow++) {
    const stepTime = now + (errorWindow * 30000);
    const expected = generateTOTP(secretBase32, 30, stepTime);
    if (cleanToken === expected) {
      return true;
    }
  }
  return false;
}

function generateBase32Secret(length = 16) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const randomBytes = crypto.randomBytes(length);
  let secret = '';
  for (let i = 0; i < length; i++) {
    secret += alphabet[randomBytes[i] % alphabet.length];
  }
  return secret;
}

function generateBackupCodes(count = 8) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    const formatted = `${code.slice(0, 4)}-${code.slice(4, 8)}`;
    codes.push(formatted);
  }
  return codes;
}

const stripUUID = (uuid) => (uuid || '').replace(/-/g, '');

const getFullUrl = (req, url) => {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  const protocol = req.headers['x-forwarded-proto'] === 'https' || req.secure ? 'https' : 'http';
  const host = req.get('host') || 'localhost:3000';
  return `${protocol}://${host}${url}`;
};

module.exports = {
  base32Decode,
  generateTOTP,
  verifyTOTP,
  generateBase32Secret,
  generateBackupCodes,
  stripUUID,
  getFullUrl
};
