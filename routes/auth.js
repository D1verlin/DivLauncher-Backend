const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { JWT_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = require('../config');
const asyncHandler = require('../utils/asyncHandler');
const { generateBase32Secret, generateBackupCodes, verifyTOTP } = require('../utils/totp');
const router = express.Router();

// POST /api/register
router.post('/api/register', asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  const db = await getDb();

  try {
    const hash = await bcrypt.hash(password, 10);
    const newUuid = uuidv4();
    await db.run('INSERT INTO users (username, uuid, password) VALUES (?, ?, ?)', [username, newUuid, hash]);
    res.json({ message: 'User created' });
  } catch (err) {
    res.status(400).json({ error: 'Username may already exist' });
  }
}));

// POST /api/login
router.post('/api/login', asyncHandler(async (req, res) => {
  const { username, password, two_factor_code } = req.body;
  const db = await getDb();

  const user = await db.get(`
    SELECT *
    FROM users
    WHERE username = ?
  `, [username]);

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Check 2FA requirement
  if (user.two_factor_enabled === 1) {
    if (!two_factor_code) {
      return res.json({ requires_2fa: true, message: 'Введите код 2FA из приложения аутентификатора' });
    }

    const cleanCode = two_factor_code.trim().toUpperCase();
    let isCodeValid = verifyTOTP(cleanCode, user.two_factor_secret);
    let backupUsed = false;
    let updatedBackupCodes = null;

    if (!isCodeValid && user.two_factor_backup_codes) {
      try {
        const backupCodes = JSON.parse(user.two_factor_backup_codes);
        const codeIndex = backupCodes.indexOf(cleanCode);
        if (codeIndex !== -1) {
          isCodeValid = true;
          backupUsed = true;
          backupCodes.splice(codeIndex, 1);
          updatedBackupCodes = JSON.stringify(backupCodes);
        }
      } catch (e) {}
    }

    if (!isCodeValid) {
      return res.status(400).json({ error: 'Invalid2FACode', errorMessage: 'Неверный код 2FA или резервный код' });
    }

    if (backupUsed && updatedBackupCodes !== null) {
      await db.run('UPDATE users SET two_factor_backup_codes = ? WHERE id = ?', [updatedBackupCodes, user.id]);
    }
  }

  const token = jwt.sign({ id: user.id, username: user.username, uuid: user.uuid, is_admin: user.is_admin }, JWT_SECRET, { expiresIn: '7d' });
  
  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      uuid: user.uuid,
      skin_url: user.skin_url,
      cape_url: user.cape_url,
      is_admin: user.is_admin,
      badge: user.badge,
      bio: user.bio,
      google_email: user.google_email,
      profile_bg_type: user.profile_bg_type || 'preset',
      profile_bg_value: user.profile_bg_value || 'preset-1',
      skin_model: user.skin_model || 'classic',
      avatar_type: user.avatar_type || 'minecraft',
      avatar_url: user.avatar_url,
      social_discord: user.social_discord,
      social_telegram: user.social_telegram,
      social_youtube: user.social_youtube,
      social_github: user.social_github,
      status_emoji: user.status_emoji,
      status_text: user.status_text,
      avatar_border_color: user.avatar_border_color || '#a78bfa',
      current_activity: user.current_activity || 'online',
      current_game: user.current_game || null,
      two_factor_enabled: user.two_factor_enabled || 0
    }
  });
}));

// 2FA SETUP / ENABLE / DISABLE
router.post('/api/auth/2fa/setup', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  console.log('[2FA Setup] Authorization header:', authHeader ? authHeader.substring(0, 30) + '...' : 'MISSING');
  if (!authHeader) {
    console.log('[2FA Setup] ERROR: No Authorization header');
    return res.status(401).json({ error: 'NoToken', errorMessage: 'Токен не передан' });
  }
  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const db = await getDb();
    const user = await db.get('SELECT * FROM users WHERE id = ?', [decoded.id]);
    if (!user) {
      return res.status(404).json({ error: 'UserNotFound', errorMessage: 'Пользователь не найден' });
    }

    const secret = generateBase32Secret(16);
    const otpauthUrl = `otpauth://totp/DivLauncher:${encodeURIComponent(user.username)}?secret=${secret}&issuer=DivLauncher`;
    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=10&data=${encodeURIComponent(otpauthUrl)}`;
    const backupCodes = generateBackupCodes(8);

    res.json({
      secret,
      otpauthUrl,
      qrCodeUrl,
      backupCodes
    });
  } catch (err) {
    res.status(401).json({ error: 'InvalidToken', errorMessage: 'Невалидный или просроченный токен: ' + err.message });
  }
}));

router.post('/api/auth/2fa/enable', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send();
  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { secret, code, backupCodes } = req.body;

    if (!secret || !code) {
      return res.status(400).json({ error: 'MissingFields', errorMessage: 'Не заполнен secret или 6-значный код' });
    }

    if (!verifyTOTP(code, secret)) {
      return res.status(400).json({ error: 'InvalidCode', errorMessage: 'Неверный проверочный код 2FA' });
    }

    const db = await getDb();
    const backupCodesJson = JSON.stringify(Array.isArray(backupCodes) ? backupCodes : []);

    await db.run(
      'UPDATE users SET two_factor_enabled = 1, two_factor_secret = ?, two_factor_backup_codes = ? WHERE id = ?',
      [secret, backupCodesJson, decoded.id]
    );

    res.json({ success: true, message: 'Двухфакторная аутентификация успешно подключена' });
  } catch (err) {
    res.status(401).send();
  }
}));

router.post('/api/auth/2fa/disable', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send();
  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { password, code } = req.body;
    const db = await getDb();
    const user = await db.get('SELECT * FROM users WHERE id = ?', [decoded.id]);
    if (!user) return res.status(404).send();

    let authorized = false;
    if (password && (await bcrypt.compare(password, user.password))) {
      authorized = true;
    } else if (code && user.two_factor_secret && verifyTOTP(code, user.two_factor_secret)) {
      authorized = true;
    }

    if (!authorized) {
      return res.status(400).json({ error: 'InvalidAuth', errorMessage: 'Неверный пароль или код 2FA' });
    }

    await db.run(
      'UPDATE users SET two_factor_enabled = 0, two_factor_secret = NULL, two_factor_backup_codes = NULL WHERE id = ?',
      [decoded.id]
    );

    res.json({ success: true, message: 'Двухфакторная аутентификация отключена' });
  } catch (err) {
    res.status(401).send();
  }
}));

// GOOGLE OAUTH
router.get('/api/auth/google', (req, res) => {
  const { port, action, token } = req.query;
  if (!port) return res.status(400).send('Missing local port');
  
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return res.status(500).send('Google Authentication is not configured on the server.');
  }

  const stateObj = { port, action: action || 'login', token: token || null };
  const state = Buffer.from(JSON.stringify(stateObj)).toString('base64');

  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?` + 
    `client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}` + 
    `&redirect_uri=${encodeURIComponent(GOOGLE_REDIRECT_URI)}` + 
    `&response_type=code` + 
    `&scope=openid%20profile%20email` + 
    `&state=${state}` + 
    `&prompt=select_account`;

  res.redirect(googleAuthUrl);
});

router.get('/api/auth/google/callback', asyncHandler(async (req, res) => {
  const { code, state, error } = req.query;
  
  let port = 3000;
  let action = 'login';
  let token = null;
  
  if (state) {
    try {
      const stateObj = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
      port = stateObj.port;
      action = stateObj.action || 'login';
      token = stateObj.token;
    } catch (e) {
      console.error('Failed to parse state:', e);
    }
  }

  if (error) {
    return res.redirect(`http://localhost:${port}/auth-callback?status=error&error=${encodeURIComponent(error)}`);
  }
  if (!code) {
    return res.redirect(`http://localhost:${port}/auth-callback?status=error&error=Missing%20authorization%20code`);
  }

  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code'
      })
    });

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      throw new Error(`Failed to exchange code: ${errText}`);
    }

    const tokenData = await tokenResponse.json();
    const googleAccessToken = tokenData.access_token;

    const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${googleAccessToken}` }
    });

    if (!profileResponse.ok) {
      throw new Error('Failed to fetch user profile from Google');
    }

    const googleUser = await profileResponse.json();
    const googleId = googleUser.sub;
    const googleEmail = googleUser.email;
    const googleName = googleUser.name;

    const db = await getDb();

    if (action === 'link') {
      if (!token) {
        return res.redirect(`http://localhost:${port}/auth-callback?status=error&error=Missing%20auth%20token`);
      }
      let decoded;
      try {
        decoded = jwt.verify(token, JWT_SECRET);
      } catch (jwtErr) {
        return res.redirect(`http://localhost:${port}/auth-callback?status=error&error=Invalid%20or%20expired%20session`);
      }

      const existingLink = await db.get('SELECT id, username FROM users WHERE google_id = ?', [googleId]);
      if (existingLink && existingLink.id !== decoded.id) {
        return res.redirect(`http://localhost:${port}/auth-callback?status=error&error=This%20Google%20account%20is%20already%20linked%20to%20player%20${existingLink.username}`);
      }

      await db.run('UPDATE users SET google_id = ?, google_email = ? WHERE id = ?', [googleId, googleEmail, decoded.id]);
      return res.redirect(`http://localhost:${port}/auth-callback?status=success&action=link&email=${encodeURIComponent(googleEmail)}`);
    } else {
      let user = await db.get('SELECT * FROM users WHERE google_id = ?', [googleId]);

      if (!user) {
        user = await db.get('SELECT * FROM users WHERE google_email = ?', [googleEmail]);
        if (user) {
          await db.run('UPDATE users SET google_id = ? WHERE id = ?', [googleId, user.id]);
        } else {
          let username = (googleName || googleEmail.split('@')[0]).replace(/[^a-zA-Z0-9_]/g, '');
          if (username.length < 3) username = `GoogleUser_${crypto.randomBytes(3).toString('hex')}`;
          
          let usernameCheck = await db.get('SELECT id FROM users WHERE username = ?', [username]);
          while (usernameCheck) {
            username = `${username}_${crypto.randomBytes(2).toString('hex')}`;
            usernameCheck = await db.get('SELECT id FROM users WHERE username = ?', [username]);
          }

          const userUuid = crypto.randomUUID().replace(/-/g, '');
          const randomPassword = crypto.randomBytes(16).toString('hex');
          const hashedPassword = await bcrypt.hash(randomPassword, 10);

          const result = await db.run(
            `INSERT INTO users (username, uuid, password, google_id, google_email) VALUES (?, ?, ?, ?, ?)`,
            [username, userUuid, hashedPassword, googleId, googleEmail]
          );

          user = await db.get('SELECT * FROM users WHERE id = ?', [result.lastID]);
        }
      }

      const token = jwt.sign({ id: user.id, username: user.username, uuid: user.uuid, is_admin: user.is_admin }, JWT_SECRET, { expiresIn: '7d' });
      const clientToken = crypto.randomUUID().replace(/-/g, '');
      const yggdrasilAccessToken = crypto.randomUUID().replace(/-/g, '');
      
      await db.run('UPDATE users SET access_token = ?, client_token = ? WHERE id = ?', [yggdrasilAccessToken, clientToken, user.id]);

      return res.redirect(`http://localhost:${port}/auth-callback?status=success` + 
        `&action=login` +
        `&token=${token}` +
        `&accessToken=${yggdrasilAccessToken}` +
        `&clientToken=${clientToken}` +
        `&username=${encodeURIComponent(user.username)}` +
        `&uuid=${user.uuid}` +
        `&id=${user.id}` +
        `&is_admin=${user.is_admin}` +
        `&badge=${user.badge || ''}`);
    }
  } catch (err) {
    console.error('Google OAuth callback error:', err);
    return res.redirect(`http://localhost:${port}/auth-callback?status=error&error=${encodeURIComponent(err.message)}`);
  }
}));

module.exports = router;
