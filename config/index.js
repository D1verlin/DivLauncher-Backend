const path = require('path');
const fs = require('fs');
const { S3Client } = require('@aws-sdk/client-s3');

// Load environment variables from .env
const dotenvResult = require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: true });
if (dotenvResult.error) {
  console.log('Dotenv warning: .env file not found or could not be loaded:', dotenvResult.error.message);
} else {
  console.log('Dotenv: .env loaded successfully from', path.join(__dirname, '..', '.env'));
}

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-key';
if (JWT_SECRET === 'your-super-secret-key') {
  console.warn('\x1b[33m%s\x1b[0m', '[WARNING] JWT_SECRET is set to the default insecure value! Please configure JWT_SECRET in .env');
}

const SERVER_DOMAIN = 'http://localhost:3000';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback';

const R2_BUCKET = process.env.R2_BUCKET_NAME || 'minecraft';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://mc.diverlin.ru';
const R2_MODS_BUCKET = process.env.R2_MODS_BUCKET_NAME || 'minecraft';
const R2_MODS_PUBLIC_URL = process.env.R2_MODS_PUBLIC_URL || 'https://mc.diverlin.ru';

// Cloudflare R2 S3 clients (lazy loaded)
let r2Client = null;
function getR2Client() {
  if (!r2Client) {
    r2Client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
      }
    });
  }
  return r2Client;
}

let r2ModsClient = null;
function getR2ModsClient() {
  if (!r2ModsClient) {
    const accountId = process.env.R2_MODS_ACCOUNT_ID || process.env.R2_ACCOUNT_ID;
    const accessKey = process.env.R2_MODS_ACCESS_KEY_ID;
    const secretKey = process.env.R2_MODS_SECRET_ACCESS_KEY;
    if (!accessKey || accessKey.startsWith('ЗАМЕНИТЕ')) {
      console.warn('[R2 Mods] R2_MODS_ACCESS_KEY_ID не задан в .env — используем основные credentials');
    }
    r2ModsClient = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: (accessKey && !accessKey.startsWith('ЗАМЕНИТЕ')) ? accessKey : process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: (secretKey && !secretKey.startsWith('ЗАМЕНИТЕ')) ? secretKey : process.env.R2_SECRET_ACCESS_KEY
      }
    });
  }
  return r2ModsClient;
}

// Upload Directories Initialization
const uploadsDir = path.join(__dirname, '..', 'uploads');
const skinsDir = path.join(uploadsDir, 'skins');
const capesDir = path.join(uploadsDir, 'capes');
const backgroundsDir = path.join(uploadsDir, 'backgrounds');
const avatarsDir = path.join(uploadsDir, 'avatars');

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
if (!fs.existsSync(skinsDir)) fs.mkdirSync(skinsDir);
if (!fs.existsSync(capesDir)) fs.mkdirSync(capesDir);
if (!fs.existsSync(backgroundsDir)) fs.mkdirSync(backgroundsDir);
if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir);

module.exports = {
  JWT_SECRET,
  SERVER_DOMAIN,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
  R2_BUCKET,
  R2_PUBLIC_URL,
  R2_MODS_BUCKET,
  R2_MODS_PUBLIC_URL,
  getR2Client,
  getR2ModsClient,
  uploadsDir,
  skinsDir,
  capesDir,
  backgroundsDir,
  avatarsDir
};
