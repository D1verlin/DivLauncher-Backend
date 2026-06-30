const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('./db');
const { syncLuckPermsUser } = require('./luckperms');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { S3Client, ListObjectsV2Command, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const dotenvResult = require('dotenv').config({ path: path.join(__dirname, '.env') });
if (dotenvResult.error) {
  console.log('Dotenv warning: .env file not found or could not be loaded:', dotenvResult.error.message);
} else {
  console.log('Dotenv: .env loaded successfully from', path.join(__dirname, '.env'));
  console.log('Dotenv parsed PORT:', dotenvResult.parsed ? dotenvResult.parsed.PORT : 'undefined');
}
console.log('Process env PORT:', process.env.PORT);
const app = express();
app.use(cors());
app.use(express.json());

// Request logger middleware
app.use((req, res, next) => {
  console.log(`[REQUEST] ${req.method} ${req.url} - Content-Type: ${req.headers['content-type']}`);
  next();
});

// Route rewrite middleware to support Yggdrasil apiRoot paths from CustomSkinLoader
app.use((req, res, next) => {
  if (req.url.startsWith('/api/yggdrasil/sessionserver')) {
    req.url = req.url.replace('/api/yggdrasil/sessionserver', '/sessionserver');
  }
  next();
});

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Helper to handle async express routes and catch errors
const asyncHandler = fn => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// --- Direct Skin & Cape Retrieval APIs by Username ---

app.get('/api/skins/:username', asyncHandler(async (req, res) => {
  const username = req.params.username.replace(/\.png$/i, '');
  const db = await getDb();
  const user = await db.get('SELECT skin_url FROM users WHERE username = ?', [username]);

  if (!user || !user.skin_url) {
    // Redirect to default Mojang Steve skin
    return res.redirect('https://textures.minecraft.net/texture/1a65f6c2084c7e6a57564619379d71c4c82b4dfa666ee3b1a2080a424af6e8c');
  }

  const relativePath = user.skin_url.split('?')[0];
  const absolutePath = path.join(__dirname, relativePath);
  if (fs.existsSync(absolutePath)) {
    return res.sendFile(absolutePath);
  }
  res.redirect('https://textures.minecraft.net/texture/1a65f6c2084c7e6a57564619379d71c4c82b4dfa666ee3b1a2080a424af6e8c');
}));

app.get('/api/capes/:username', asyncHandler(async (req, res) => {
  const username = req.params.username.replace(/\.png$/i, '');
  const db = await getDb();
  const user = await db.get('SELECT cape_url FROM users WHERE username = ?', [username]);

  if (!user || !user.cape_url) {
    return res.status(404).send('Cape not found');
  }

  const relativePath = user.cape_url.split('?')[0];
  const absolutePath = path.join(__dirname, relativePath);
  if (fs.existsSync(absolutePath)) {
    return res.sendFile(absolutePath);
  }
  res.status(404).send('Cape file not found');
}));

// --- Swagger UI Documentation ---
app.get('/api-docs/swagger.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'swagger.json'));
});

app.get('/docs', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="ru">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>DivLauncher API Documentation</title>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.17.14/swagger-ui.min.css" />
        <link rel="icon" type="image/png" href="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.17.14/favicon-32x32.png" sizes="32x32" />
        <style>
          html { box-sizing: border-box; }
          *, *:before, *:after { box-sizing: inherit; }
          body { margin: 0; background: #fafafa; }
        </style>
      </head>
      <body>
        <div id="swagger-ui"></div>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.17.14/swagger-ui-bundle.min.js" charset="UTF-8"></script>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.17.14/swagger-ui-standalone-preset.min.js" charset="UTF-8"></script>
        <script>
          window.onload = () => {
            window.ui = SwaggerUIBundle({
              url: '/api-docs/swagger.json',
              dom_id: '#swagger-ui',
              deepLinking: true,
              presets: [
                SwaggerUIBundle.presets.apis,
                SwaggerUIStandalonePreset
              ],
              plugins: [
                SwaggerUIBundle.plugins.DownloadUrl
              ],
              layout: "BaseLayout"
            });
          };
        </script>
      </body>
    </html>
  `);
});

app.get('/', (req, res) => {
  res.redirect('/docs');
});

// Fallback for local storage if R2 is not configured
const uploadLocal = multer({ dest: 'uploads/' });
const uploadMemory = multer({ storage: multer.memoryStorage() });

// Create uploads directories if they don't exist
const uploadsDir = path.join(__dirname, 'uploads');
const skinsDir = path.join(uploadsDir, 'skins');
const capesDir = path.join(uploadsDir, 'capes');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
if (!fs.existsSync(skinsDir)) fs.mkdirSync(skinsDir);
if (!fs.existsSync(capesDir)) fs.mkdirSync(capesDir);

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-key';
if (JWT_SECRET === 'your-super-secret-key') {
  console.warn('\x1b[33m%s\x1b[0m', '[WARNING] JWT_SECRET is set to the default insecure value! Please configure JWT_SECRET in .env');
}
const SERVER_DOMAIN = 'http://localhost:3000'; // Change to actual domain in prod
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback';

// Helper: Format UUID with or without dashes
const stripUUID = (uuid) => uuid.replace(/-/g, '');

const getFullUrl = (req, url) => {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  const protocol = req.headers['x-forwarded-proto'] === 'https' || req.secure ? 'https' : 'http';
  const host = req.get('host') || 'localhost:3000';
  return `${protocol}://${host}${url}`;
};

// --- Yggdrasil API Endpoints ---

app.get(['/api/yggdrasil', '/api/yggdrasil/'], asyncHandler(async (req, res) => {
  const host = req.get('host');
  const domain = host ? host.split(':')[0] : 'localhost';
  const domains = new Set(["localhost", "127.0.0.1", "mcauth.diverlin.ru", "diverlin.ru", domain]);
  
  const db = await getDb();
  res.json({
    meta: {
      serverName: "DivLauncher Auth",
      implementationName: "divlauncher-auth",
      implementationVersion: "1.0.0"
    },
    skinDomains: Array.from(domains),
    signaturePublicKey: db.publicKey || "" // For authlib-injector signature verification
  });
}));

app.post('/authserver/authenticate', asyncHandler(async (req, res) => {
  const { username, password, clientToken = uuidv4() } = req.body;
  const db = await getDb();
  const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: "ForbiddenOperationException", errorMessage: "Invalid credentials. Invalid username or password." });
  }

  const accessToken = uuidv4();
  await db.run('UPDATE users SET access_token = ?, client_token = ? WHERE id = ?', [accessToken, clientToken, user.id]);

  res.json({
    accessToken,
    clientToken,
    availableProfiles: [{ id: stripUUID(user.uuid), name: user.username }],
    selectedProfile: { id: stripUUID(user.uuid), name: user.username }
  });
}));

app.post('/authserver/refresh', asyncHandler(async (req, res) => {
  const { accessToken, clientToken } = req.body;
  const db = await getDb();
  const user = await db.get('SELECT * FROM users WHERE access_token = ? AND client_token = ?', [accessToken, clientToken]);

  if (!user) {
    return res.status(401).json({ error: "ForbiddenOperationException", errorMessage: "Invalid token." });
  }

  const newAccessToken = uuidv4();
  await db.run('UPDATE users SET access_token = ? WHERE id = ?', [newAccessToken, user.id]);

  res.json({
    accessToken: newAccessToken,
    clientToken,
    selectedProfile: { id: stripUUID(user.uuid), name: user.username }
  });
}));

app.post('/authserver/validate', asyncHandler(async (req, res) => {
  const { accessToken, clientToken } = req.body;
  const db = await getDb();
  
  let query = 'SELECT * FROM users WHERE access_token = ?';
  let params = [accessToken];
  if (clientToken) {
    query += ' AND client_token = ?';
    params.push(clientToken);
  }

  const user = await db.get(query, params);
  if (!user) {
    return res.status(401).json({ error: "ForbiddenOperationException", errorMessage: "Invalid token." });
  }

  res.status(204).send();
}));

// --- Session Server (Minecraft Server joins) ---

app.post('/sessionserver/session/minecraft/join', asyncHandler(async (req, res) => {
  const { accessToken, selectedProfile, serverId } = req.body;
  const db = await getDb();

  // Minecraft client sends selectedProfile as UUID without dashes
  const user = await db.get("SELECT * FROM users WHERE access_token = ? AND REPLACE(uuid, '-', '') = ?", [accessToken, selectedProfile]);

  if (!user) {
    return res.status(401).json({ error: "ForbiddenOperationException", errorMessage: "Invalid token or profile." });
  }

  await db.run('UPDATE users SET server_id = ? WHERE id = ?', [serverId, user.id]);
  res.status(204).send();
}));

app.get('/sessionserver/session/minecraft/hasJoined', asyncHandler(async (req, res) => {
  const { username, serverId } = req.query;
  const db = await getDb();
  const user = await db.get('SELECT * FROM users WHERE username = ? AND server_id = ?', [username, serverId]);

  if (!user) {
    return res.status(204).send(); // Vanilla response for not joined
  }

  // Construct textures property
  const textures = {
    timestamp: Date.now(),
    profileId: stripUUID(user.uuid),
    profileName: user.username,
    textures: {}
  };

  if (user.skin_url) textures.textures.SKIN = { url: getFullUrl(req, user.skin_url) };
  if (user.cape_url) textures.textures.CAPE = { url: getFullUrl(req, user.cape_url) };

  const texturesBase64 = Buffer.from(JSON.stringify(textures)).toString('base64');
  const properties = [
    {
      name: "textures",
      value: texturesBase64
    }
  ];

  if (db.privateKey) {
    const crypto = require('crypto');
    const sign = crypto.createSign('sha1WithRSAEncryption');
    sign.update(texturesBase64);
    properties[0].signature = sign.sign(db.privateKey, 'base64');
  }

  res.json({
    id: stripUUID(user.uuid),
    name: user.username,
    properties
  });
}));

app.get('/sessionserver/session/minecraft/profile/:uuid', asyncHandler(async (req, res) => {
  const uuid = req.params.uuid;
  const db = await getDb();
  const user = await db.get("SELECT * FROM users WHERE REPLACE(uuid, '-', '') = ?", [uuid]);

  if (!user) {
    return res.status(204).send();
  }

  const textures = {
    timestamp: Date.now(),
    profileId: stripUUID(user.uuid),
    profileName: user.username,
    textures: {}
  };

  if (user.skin_url) textures.textures.SKIN = { url: getFullUrl(req, user.skin_url) };
  if (user.cape_url) textures.textures.CAPE = { url: getFullUrl(req, user.cape_url) };

  const texturesBase64 = Buffer.from(JSON.stringify(textures)).toString('base64');
  const properties = [
    {
      name: "textures",
      value: texturesBase64
    }
  ];

  if (db.privateKey) {
    const crypto = require('crypto');
    const sign = crypto.createSign('sha1WithRSAEncryption');
    sign.update(texturesBase64);
    properties[0].signature = sign.sign(db.privateKey, 'base64');
  }

  res.json({
    id: stripUUID(user.uuid),
    name: user.username,
    properties
  });
}));

// --- Web Frontend API ---

app.post('/api/register', asyncHandler(async (req, res) => {
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

app.post('/api/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  const db = await getDb();

  const user = await db.get(`
    SELECT *
    FROM users
    WHERE username = ?
  `, [username]);

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: 'Invalid credentials' });
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
      status_text: user.status_text
    }
  });
}));

app.get('/api/profile', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send();
  const token = authHeader.split(' ')[1];
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const db = await getDb();
    const user = await db.get(`
      SELECT id, username, uuid, skin_url, cape_url, is_admin, badge, bio, google_email,
             profile_bg_type, profile_bg_value, skin_model, avatar_type, avatar_url,
             social_discord, social_telegram, social_youtube, social_github,
             status_emoji, status_text
      FROM users
      WHERE id = ?
    `, [decoded.id]);

    if (!user) return res.status(404).send();

    res.json(user);
  } catch (err) {
    res.status(401).send();
  }
}));

app.post('/api/profile/password', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send();
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword || newPassword.length < 4) {
      return res.status(400).json({ error: 'InvalidPassword', errorMessage: 'Пароль должен быть не менее 4 символов' });
    }

    const db = await getDb();
    const user = await db.get('SELECT * FROM users WHERE id = ?', [decoded.id]);
    if (!user) {
      return res.status(404).json({ error: 'UserNotFound', errorMessage: 'Пользователь не найден' });
    }

    const match = await bcrypt.compare(oldPassword, user.password);
    if (!match) {
      return res.status(400).json({ error: 'IncorrectOldPassword', errorMessage: 'Неверный текущий пароль' });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await db.run('UPDATE users SET password = ? WHERE id = ?', [hash, decoded.id]);
    res.json({ message: 'Пароль успешно изменен' });
  } catch (err) {
    res.status(401).send();
  }
}));

app.post('/api/profile/bio', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send();
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { bio } = req.body;
    const db = await getDb();
    await db.run('UPDATE users SET bio = ? WHERE id = ?', [bio === '' || bio === null ? null : bio, decoded.id]);
    res.json({ message: 'Статус успешно обновлен', bio: bio || null });
  } catch (err) {
    res.status(401).send();
  }
}));

// --- GOOGLE OAUTH ENDPOINTS ---

app.get('/api/auth/google', (req, res) => {
  const { port, action, token } = req.query;
  if (!port) return res.status(400).send('Missing local port');
  
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return res.status(500).send('Google Authentication is not configured on the server.');
  }

  // Create state variable containing action, port, and token if linking
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

app.get('/api/auth/google/callback', asyncHandler(async (req, res) => {
  const { code, state, error } = req.query;
  const crypto = require('crypto');
  
  // Extract port from state to redirect errors to loopback server
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
    // 1. Exchange authorization code for tokens
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

    // 2. Fetch Google profile
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
      // LINKING GOOGLE TO EXISTING USER
      if (!token) {
        return res.redirect(`http://localhost:${port}/auth-callback?status=error&error=Missing%20auth%20token`);
      }
      let decoded;
      try {
        decoded = jwt.verify(token, JWT_SECRET);
      } catch (jwtErr) {
        return res.redirect(`http://localhost:${port}/auth-callback?status=error&error=Invalid%20or%20expired%20session`);
      }

      // Check if this Google ID is already linked
      const existingLink = await db.get('SELECT id, username FROM users WHERE google_id = ?', [googleId]);
      if (existingLink && existingLink.id !== decoded.id) {
        return res.redirect(`http://localhost:${port}/auth-callback?status=error&error=This%20Google%20account%20is%20already%20linked%20to%20player%20${existingLink.username}`);
      }

      await db.run('UPDATE users SET google_id = ?, google_email = ? WHERE id = ?', [googleId, googleEmail, decoded.id]);
      return res.redirect(`http://localhost:${port}/auth-callback?status=success&action=link&email=${encodeURIComponent(googleEmail)}`);
    } else {
      // LOGIN / REGISTRATION WITH GOOGLE
      let user = await db.get('SELECT * FROM users WHERE google_id = ?', [googleId]);

      if (!user) {
        // Check if a user with this email already exists
        user = await db.get('SELECT * FROM users WHERE google_email = ?', [googleEmail]);
        if (user) {
          // Auto-link Google ID to existing user
          await db.run('UPDATE users SET google_id = ? WHERE id = ?', [googleId, user.id]);
        } else {
          // Register a new user
          // Base username on google email or name, strip special characters
          let username = (googleName || googleEmail.split('@')[0]).replace(/[^a-zA-Z0-9_]/g, '');
          if (username.length < 3) username = `GoogleUser_${crypto.randomBytes(3).toString('hex')}`;
          
          // Ensure username uniqueness
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

      // Generate credentials
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

app.post('/api/profile/google/unlink', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send();
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const db = await getDb();
    await db.run('UPDATE users SET google_id = NULL, google_email = NULL WHERE id = ?', [decoded.id]);
    res.json({ message: 'Google account unlinked successfully' });
  } catch (err) {
    res.status(401).send();
  }
}));

// --- PROFILE CUSTOMIZATION ENDPOINTS ---

app.post('/api/profile/customize', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send();
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const updates = req.body;
    const db = await getDb();

    const allowedFields = [
      'profile_bg_type', 'profile_bg_value', 'skin_model', 'avatar_type',
      'social_discord', 'social_telegram', 'social_youtube', 'social_github',
      'status_emoji', 'status_text', 'bio'
    ];

    const fieldsToSet = [];
    const params = [];

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        fieldsToSet.push(`${field} = ?`);
        params.push(updates[field] === '' ? null : updates[field]);
      }
    }

    if (fieldsToSet.length > 0) {
      params.push(decoded.id);
      await db.run(`UPDATE users SET ${fieldsToSet.join(', ')} WHERE id = ?`, params);
    }

    const updatedUser = await db.get(`
      SELECT profile_bg_type, profile_bg_value, skin_model, avatar_type, avatar_url,
             social_discord, social_telegram, social_youtube, social_github,
             status_emoji, status_text, bio, google_email
      FROM users WHERE id = ?
    `, [decoded.id]);

    res.json({ message: 'Profile updated successfully', user: updatedUser });
  } catch (err) {
    res.status(401).send();
  }
}));

app.post('/api/profile/background', (req, res, next) => {
  uploadMemory.single('background')(req, res, (err) => {
    if (err) return next(err);
    next();
  });
}, asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send();
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!req.file) {
      return res.status(400).json({ error: 'NoFile', errorMessage: 'Не передан файл фона' });
    }

    if (req.file.size > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'TooLarge', errorMessage: 'Файл слишком большой (макс. 5 МБ)' });
    }

    const allowedMime = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif'];
    if (!allowedMime.includes(req.file.mimetype)) {
      return res.status(400).json({ error: 'InvalidType', errorMessage: 'Разрешены только файлы PNG, JPG, JPEG или GIF' });
    }

    const ext = req.file.mimetype.split('/')[1] === 'jpeg' ? 'jpg' : req.file.mimetype.split('/')[1];
    const targetDir = path.join(__dirname, 'uploads', 'backgrounds');
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const files = fs.readdirSync(targetDir);
    for (const file of files) {
      if (file.startsWith(`${decoded.id}.`)) {
        try { fs.unlinkSync(path.join(targetDir, file)); } catch (e) {}
      }
    }

    const fileName = `${decoded.id}.${ext}`;
    const targetPath = path.join(targetDir, fileName);
    fs.writeFileSync(targetPath, req.file.buffer);

    const bgUrl = `/uploads/backgrounds/${fileName}?v=${Date.now()}`;
    const db = await getDb();
    await db.run('UPDATE users SET profile_bg_type = ?, profile_bg_value = ? WHERE id = ?', ['custom', bgUrl, decoded.id]);

    res.json({ message: 'Background uploaded successfully', profile_bg_value: bgUrl });
  } catch (err) {
    res.status(401).send();
  }
}));

app.post('/api/profile/avatar', (req, res, next) => {
  uploadMemory.single('avatar')(req, res, (err) => {
    if (err) return next(err);
    next();
  });
}, asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send();
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!req.file) {
      return res.status(400).json({ error: 'NoFile', errorMessage: 'Не передан файл аватарки' });
    }

    if (req.file.size > 2 * 1024 * 1024) {
      return res.status(400).json({ error: 'TooLarge', errorMessage: 'Файл слишком большой (макс. 2 МБ)' });
    }

    const allowedMime = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif'];
    if (!allowedMime.includes(req.file.mimetype)) {
      return res.status(400).json({ error: 'InvalidType', errorMessage: 'Разрешены только файлы PNG, JPG, JPEG или GIF' });
    }

    const ext = req.file.mimetype.split('/')[1] === 'jpeg' ? 'jpg' : req.file.mimetype.split('/')[1];
    const targetDir = path.join(__dirname, 'uploads', 'avatars');
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const files = fs.readdirSync(targetDir);
    for (const file of files) {
      if (file.startsWith(`${decoded.id}.`)) {
        try { fs.unlinkSync(path.join(targetDir, file)); } catch (e) {}
      }
    }

    const fileName = `${decoded.id}.${ext}`;
    const targetPath = path.join(targetDir, fileName);
    fs.writeFileSync(targetPath, req.file.buffer);

    const avatarUrl = `/uploads/avatars/${fileName}?v=${Date.now()}`;
    const db = await getDb();
    await db.run('UPDATE users SET avatar_type = ?, avatar_url = ? WHERE id = ?', ['custom', avatarUrl, decoded.id]);

    res.json({ message: 'Avatar uploaded successfully', avatar_url: avatarUrl });
  } catch (err) {
    res.status(401).send();
  }
}));

app.get('/api/users', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send();
  const token = authHeader.split(' ')[1];
  try {
    jwt.verify(token, JWT_SECRET);
    const db = await getDb();
    const users = await db.all(`
      SELECT id, username, uuid, skin_url, cape_url, is_admin, badge, bio,
             profile_bg_type, profile_bg_value, skin_model, avatar_type, avatar_url,
             social_discord, social_telegram, social_youtube, social_github,
             status_emoji, status_text
      FROM users
    `);

    res.json(users);
  } catch (err) {
    res.status(401).send();
  }
}));

function validateMinecraftPng(buffer, isCape = false) {
  if (!buffer || buffer.length < 24) {
    return { valid: false, error: 'Файл поврежден или слишком мал' };
  }
  // Check PNG signature: 89 50 4E 47 0D 0A 1A 0A
  const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47 &&
                buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A;
  if (!isPng) {
    return { valid: false, error: 'Файл не является корректным PNG-изображением' };
  }
  // Check IHDR chunk type
  const chunkType = buffer.toString('ascii', 12, 16);
  if (chunkType !== 'IHDR') {
    return { valid: false, error: 'Неверный формат PNG (отсутствует IHDR)' };
  }
  const width = buffer.readInt32BE(16);
  const height = buffer.readInt32BE(20);

  if (width <= 0 || height <= 0) {
    return { valid: false, error: 'Некорректные размеры изображения' };
  }

  if (isCape) {
    // Cape dimensions validation (normally 64x32 or ratios of it like 2:1)
    if (width % 64 !== 0 || height % 32 !== 0 || (width / height !== 2)) {
      return { valid: false, error: `Неверные размеры плаща (${width}x${height}). Отношение сторон должно быть 2:1 (например, 64x32)` };
    }
  } else {
    // Skin dimensions validation
    // Standard skin is 64x64 (ratio 1:1) or 64x32 (ratio 2:1)
    const ratio = width / height;
    if (ratio !== 1 && ratio !== 2) {
      return { valid: false, error: `Неверные пропорции скина (${width}x${height}). Соотношение сторон должно быть 1:1 или 2:1 (например, 64x64 или 64x32)` };
    }
    if (width % 64 !== 0) {
      return { valid: false, error: `Некорректное разрешение скина (${width}x${height}). Разрешение должно быть кратно 64 (например, 64x64, 128x128 и т.д.)` };
    }
  }

  return { valid: true, width, height };
}

app.post('/api/profile/skin', (req, res, next) => {
  console.log('[BACKEND] /api/profile/skin: Multer parsing starting...');
  uploadMemory.single('skin')(req, res, (err) => {
    console.log('[BACKEND] /api/profile/skin: Multer parsing finished. Error:', err || 'none');
    if (err) return next(err);
    next();
  });
}, asyncHandler(async (req, res) => {
  console.log('[BACKEND] /api/profile/skin: Main handler starting...');
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    if (!res.destroyed && !res.headersSent) {
      res.status(400).send();
    }
    return;
  }
  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log('[BACKEND] /api/profile/skin: Token decoded successfully, user id:', decoded.id);
    if (!req.file) {
      if (!res.destroyed && !res.headersSent) {
        res.status(400).json({ error: 'NoFile', errorMessage: 'Не передан файл скина' });
      }
      return;
    }

    // 1. File size check (max 500 KB)
    if (req.file.size > 500 * 1024) {
      if (!res.destroyed && !res.headersSent) {
        res.status(400).json({ error: 'TooLarge', errorMessage: 'Скин слишком большого размера (лимит 500 КБ)' });
      }
      return;
    }

    // 2. MIME type check
    if (req.file.mimetype !== 'image/png') {
      if (!res.destroyed && !res.headersSent) {
        res.status(400).json({ error: 'InvalidType', errorMessage: 'Разрешены только файлы PNG' });
      }
      return;
    }

    // 3. Size/Ratio validation
    const valResult = validateMinecraftPng(req.file.buffer, false);
    if (!valResult.valid) {
      if (!res.destroyed && !res.headersSent) {
        res.status(400).json({ error: 'InvalidDimensions', errorMessage: valResult.error });
      }
      return;
    }

    const targetDir = path.join(__dirname, 'uploads', 'skins');
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const targetPath = path.join(targetDir, `${decoded.id}.png`);
    fs.writeFileSync(targetPath, req.file.buffer);
    console.log('[BACKEND] /api/profile/skin: File written to disk:', targetPath);

    const skinUrl = `/uploads/skins/${decoded.id}.png?v=${Date.now()}`;

    const db = await getDb();
    await db.run('UPDATE users SET skin_url = ? WHERE id = ?', [skinUrl, decoded.id]);
    console.log('[BACKEND] /api/profile/skin: DB updated with skinUrl:', skinUrl);
    
    if (!res.destroyed && !res.headersSent) {
      res.json({ message: 'Skin updated', skin_url: skinUrl });
    }
  } catch (err) {
    console.error('Skin upload error:', err);
    if (!res.destroyed && !res.headersSent) {
      res.status(500).json({ error: 'UploadFailed', errorMessage: err.message });
    }
  }
}));

app.post('/api/profile/cape', (req, res, next) => {
  console.log('[BACKEND] /api/profile/cape: Multer parsing starting...');
  uploadMemory.single('cape')(req, res, (err) => {
    console.log('[BACKEND] /api/profile/cape: Multer parsing finished. Error:', err || 'none');
    if (err) return next(err);
    next();
  });
}, asyncHandler(async (req, res) => {
  console.log('[BACKEND] /api/profile/cape: Main handler starting...');
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    if (!res.destroyed && !res.headersSent) {
      res.status(400).send();
    }
    return;
  }
  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log('[BACKEND] /api/profile/cape: Token decoded successfully, user id:', decoded.id);
    if (!req.file) {
      if (!res.destroyed && !res.headersSent) {
        res.status(400).json({ error: 'NoFile', errorMessage: 'Не передан файл плаща' });
      }
      return;
    }

    // 1. File size check (max 100 KB)
    if (req.file.size > 100 * 1024) {
      if (!res.destroyed && !res.headersSent) {
        res.status(400).json({ error: 'TooLarge', errorMessage: 'Плащ слишком большого размера (лимит 100 КБ)' });
      }
      return;
    }

    // 2. MIME type check
    if (req.file.mimetype !== 'image/png') {
      if (!res.destroyed && !res.headersSent) {
        res.status(400).json({ error: 'InvalidType', errorMessage: 'Разрешены только файлы PNG' });
      }
      return;
    }

    // 3. Size/Ratio validation
    const valResult = validateMinecraftPng(req.file.buffer, true);
    if (!valResult.valid) {
      if (!res.destroyed && !res.headersSent) {
        res.status(400).json({ error: 'InvalidDimensions', errorMessage: valResult.error });
      }
      return;
    }

    const targetDir = path.join(__dirname, 'uploads', 'capes');
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const targetPath = path.join(targetDir, `${decoded.id}.png`);
    fs.writeFileSync(targetPath, req.file.buffer);
    console.log('[BACKEND] /api/profile/cape: File written to disk:', targetPath);

    const capeUrl = `/uploads/capes/${decoded.id}.png?v=${Date.now()}`;

    const db = await getDb();
    await db.run('UPDATE users SET cape_url = ? WHERE id = ?', [capeUrl, decoded.id]);
    console.log('[BACKEND] /api/profile/cape: DB updated with capeUrl:', capeUrl);
    
    if (!res.destroyed && !res.headersSent) {
      res.json({ message: 'Cape updated', cape_url: capeUrl });
    }
  } catch (err) {
    console.error(err);
    if (!res.destroyed && !res.headersSent) {
      res.status(500).json({ error: 'UploadFailed', errorMessage: err.message });
    }
  }
}));

app.get('/api/admin/users', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send();
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const db = await getDb();
    const currentUser = await db.get('SELECT is_admin FROM users WHERE id = ?', [decoded.id]);
    if (!currentUser || !currentUser.is_admin) return res.status(403).json({ error: 'Not an admin' });
    
    const users = await db.all('SELECT id, username, uuid, skin_url, cape_url, is_admin, badge FROM users');
    res.json(users);
  } catch (err) {
    res.status(401).send();
  }
}));

app.delete('/api/admin/users/:id', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send();
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const db = await getDb();
    const currentUser = await db.get('SELECT is_admin FROM users WHERE id = ?', [decoded.id]);
    if (!currentUser || !currentUser.is_admin) return res.status(403).json({ error: 'Not an admin' });
    
    // Prevent deleting oneself
    if (parseInt(req.params.id) === decoded.id) {
        return res.status(400).json({ error: 'Cannot delete yourself' });
    }
    await db.run('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(401).send();
  }
}));

app.put('/api/admin/users/:id', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send();
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const db = await getDb();
    const currentUser = await db.get('SELECT is_admin FROM users WHERE id = ?', [decoded.id]);
    if (!currentUser || !currentUser.is_admin) return res.status(403).json({ error: 'Not an admin' });

    const { is_admin, badge, bio } = req.body;
    
    // Prevent demoting yourself to avoid losing admin access
    if (parseInt(req.params.id) === decoded.id && is_admin !== undefined && parseInt(is_admin) === 0) {
      return res.status(400).json({ error: 'Cannot demote yourself' });
    }

    const updates = [];
    const params = [];
    if (is_admin !== undefined) {
      updates.push('is_admin = ?');
      params.push(is_admin ? 1 : 0);
    }
    if (badge !== undefined) {
      updates.push('badge = ?');
      params.push(badge === '' || badge === null ? null : badge);
    }
    if (bio !== undefined) {
      updates.push('bio = ?');
      params.push(bio === '' || bio === null ? null : bio);
    }

    if (updates.length > 0) {
      params.push(req.params.id);
      await db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

      // If badge was updated, sync it with LuckPerms MySQL database in real time
      if (badge !== undefined) {
        const updatedUser = await db.get('SELECT username, uuid, badge FROM users WHERE id = ?', [req.params.id]);
        if (updatedUser) {
          await syncLuckPermsUser(updatedUser.uuid, updatedUser.username, updatedUser.badge);
        }
      }
    }

    res.json({ message: 'User updated successfully' });
  } catch (err) {
    console.error('Error updating user in admin panel:', err);
    res.status(401).send();
  }
}));

app.post('/api/admin/promote/:id', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send();
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const db = await getDb();
    const currentUser = await db.get('SELECT is_admin FROM users WHERE id = ?', [decoded.id]);
    if (!currentUser || !currentUser.is_admin) return res.status(403).json({ error: 'Not an admin' });
    
    await db.run('UPDATE users SET is_admin = 1 WHERE id = ?', [req.params.id]);
    res.json({ message: 'User promoted to admin' });
  } catch (err) {
    res.status(401).send();
  }
}));

// --- In-Game Statistics & Badges Sync API (Server-Only) ---

const verifyServerToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const configuredToken = process.env.SERVER_TOKEN || 'SuperSecretSyncToken123';

  if (!authHeader) {
    return res.status(401).json({ error: 'Unauthorized', errorMessage: 'Missing authorization header' });
  }

  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;

  if (token !== configuredToken) {
    return res.status(403).json({ error: 'Forbidden', errorMessage: 'Invalid server token' });
  }

  next();
};



app.post('/api/server/award-badge', verifyServerToken, asyncHandler(async (req, res) => {
  const { uuid, badge } = req.body;
  if (!uuid || !badge) {
    return res.status(400).json({ error: 'BadRequest', errorMessage: 'Missing uuid or badge' });
  }

  const db = await getDb();
  const user = await db.get("SELECT id, username, uuid, badge FROM users WHERE REPLACE(uuid, '-', '') = REPLACE(?, '-', '')", [uuid, uuid]);

  if (!user) {
    return res.status(404).json({ error: 'UserNotFound', errorMessage: 'User not found' });
  }

  await db.run('UPDATE users SET badge = ? WHERE id = ?', [badge, user.id]);
  console.log(`[Badge Award] Awarded badge "${badge}" to user ${user.username} (${uuid})`);

  // Sync badge to LuckPerms
  await syncLuckPermsUser(user.uuid, user.username, badge);

  res.json({ message: `Badge ${badge} awarded successfully` });
}));

// --- R2 Client: divlauncher-skins (скины/плащи, существующий) ---
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

// --- R2 Client: minecraft (сборки, моды, mods.json) ---
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

const R2_BUCKET = process.env.R2_BUCKET_NAME || 'minecraft';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://mc.diverlin.ru';

// Mods bucket constants (may differ from skin bucket)
const R2_MODS_BUCKET = process.env.R2_MODS_BUCKET_NAME || 'minecraft';
const R2_MODS_PUBLIC_URL = process.env.R2_MODS_PUBLIC_URL || 'https://mc.diverlin.ru';

// Middleware: check admin JWT
async function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const db = await getDb();
    const user = await db.get('SELECT is_admin FROM users WHERE id = ?', [decoded.id]);
    if (!user || !user.is_admin) return res.status(403).json({ error: 'Forbidden' });
    req.adminId = decoded.id;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Helper: stream to buffer
async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// --- Admin R2 Routes (bucket: minecraft) ---

// GET /api/admin/r2/list?prefix=DivLauncher/stalker/mods/
app.get('/api/admin/r2/list', requireAdmin, asyncHandler(async (req, res) => {
  const { prefix = '' } = req.query;
  console.log(`[R2 list] bucket=${R2_MODS_BUCKET} prefix="${prefix}"`);
  const s3 = getR2ModsClient();
  const cmd = new ListObjectsV2Command({
    Bucket: R2_MODS_BUCKET,
    Prefix: prefix,
    Delimiter: '/'
  });
  const data = await s3.send(cmd);
  console.log(`[R2 list] Contents=${data.Contents?.length || 0} Prefixes=${data.CommonPrefixes?.length || 0}`);
  const files = (data.Contents || [])
    .filter(obj => obj.Key !== prefix)
    .map(obj => ({
      key: obj.Key,
      name: obj.Key.replace(prefix, ''),
      size: obj.Size,
      lastModified: obj.LastModified,
      url: `${R2_MODS_PUBLIC_URL}/${obj.Key}`
    }));
  const folders = (data.CommonPrefixes || []).map(cp => ({
    key: cp.Prefix,
    name: cp.Prefix.replace(prefix, '').replace('/', ''),
    isFolder: true
  }));
  res.json({ files, folders, prefix });
}));

// POST /api/admin/r2/upload?key=DivLauncher/stalker/mods/mymod.jar
const uploadR2Memory = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });
app.post('/api/admin/r2/upload', requireAdmin, (req, res, next) => {
  uploadR2Memory.single('file')(req, res, (err) => {
    if (err) return next(err);
    next();
  });
}, asyncHandler(async (req, res) => {
  const { key } = req.query;
  if (!key) return res.status(400).json({ error: 'Missing key query param' });
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  console.log(`[R2 upload] bucket=${R2_MODS_BUCKET} key="${key}" size=${req.file.size}`);
  const s3 = getR2ModsClient();
  const upload = new Upload({
    client: s3,
    params: {
      Bucket: R2_MODS_BUCKET,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype || 'application/octet-stream'
    }
  });
  await upload.done();
  res.json({ success: true, key, url: `${R2_MODS_PUBLIC_URL}/${key}` });
}));

// DELETE /api/admin/r2/delete?key=DivLauncher/stalker/mods/mymod.jar
app.delete('/api/admin/r2/delete', requireAdmin, asyncHandler(async (req, res) => {
  const { key } = req.query;
  if (!key) return res.status(400).json({ error: 'Missing key query param' });
  console.log(`[R2 delete] bucket=${R2_MODS_BUCKET} key="${key}"`);
  const s3 = getR2ModsClient();
  await s3.send(new DeleteObjectCommand({ Bucket: R2_MODS_BUCKET, Key: key }));
  res.json({ success: true, key });
}));

// GET /api/admin/r2/mods-json?key=DivLauncher/stalker/mods.json
app.get('/api/admin/r2/mods-json', requireAdmin, asyncHandler(async (req, res) => {
  const { key } = req.query;
  if (!key) return res.status(400).json({ error: 'Missing key' });
  console.log(`[R2 mods-json GET] bucket=${R2_MODS_BUCKET} key="${key}"`);
  const s3 = getR2ModsClient();
  try {
    const cmd = new GetObjectCommand({ Bucket: R2_MODS_BUCKET, Key: key });
    const data = await s3.send(cmd);
    const buf = await streamToBuffer(data.Body);
    console.log(`[R2 mods-json GET] success, bytes=${buf.length}`);
    res.setHeader('Content-Type', 'application/json');
    res.send(buf);
  } catch (err) {
    console.error(`[R2 mods-json GET] error: ${err.name} - ${err.message}`);
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
      res.json([]);
    } else {
      res.status(500).json({ error: err.name, message: err.message });
    }
  }
}));

// PUT /api/admin/r2/mods-json?key=DivLauncher/stalker/mods.json
app.put('/api/admin/r2/mods-json', requireAdmin, asyncHandler(async (req, res) => {
  const { key } = req.query;
  if (!key) return res.status(400).json({ error: 'Missing key' });
  const content = typeof req.body === 'string' ? req.body : JSON.stringify(req.body, null, 2);
  console.log(`[R2 mods-json PUT] bucket=${R2_MODS_BUCKET} key="${key}" bytes=${content.length}`);
  const s3 = getR2ModsClient();
  await s3.send(new PutObjectCommand({
    Bucket: R2_MODS_BUCKET,
    Key: key,
    Body: content,
    ContentType: 'application/json'
  }));
  res.json({ success: true, key, url: `${R2_MODS_PUBLIC_URL}/${key}` });
}));

// GET /privacy - Privacy Policy Page (bilingual RU/EN)
app.get('/privacy', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`
    <!DOCTYPE html>
    <html lang="ru">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Privacy Policy - DivLauncher</title>
      <style>
        body {
          background: #09090e;
          color: #e4e4e7;
          font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          line-height: 1.6;
          margin: 0;
          padding: 40px 20px;
          display: flex;
          justify-content: center;
        }
        .container {
          max-width: 800px;
          background: rgba(15, 15, 25, 0.6);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 20px;
          padding: 40px;
          box-shadow: 0 20px 50px rgba(0,0,0,0.5);
        }
        h1 {
          color: #10b981;
          font-size: 28px;
          margin-top: 0;
          border-bottom: 1px solid rgba(255,255,255,0.1);
          padding-bottom: 15px;
          text-transform: uppercase;
          letter-spacing: 1px;
        }
        h2 {
          color: #a78bfa;
          font-size: 20px;
          margin-top: 30px;
          border-bottom: 1px solid rgba(255,255,255,0.05);
          padding-bottom: 8px;
        }
        p, li {
          color: #a1a1aa;
          font-size: 14px;
        }
        ul {
          padding-left: 20px;
        }
        .lang-divider {
          height: 1px;
          background: rgba(255, 255, 255, 0.1);
          margin: 40px 0;
        }
        a {
          color: #34d399;
          text-decoration: none;
        }
        a:hover {
          text-decoration: underline;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <!-- ENGLISH VERSION -->
        <div class="lang-section">
          <h1>Privacy Policy</h1>
          <p>Last updated: June 30, 2026</p>
          <p>This Privacy Policy describes our policies and procedures on the collection, use, and disclosure of your information when you use DivLauncher (the "Application" or "Service"). We use your data to provide and improve the Service, verify players, and secure user accounts.</p>

          <h2>1. Information Collection and Use</h2>
          <p>While using our Service, we may ask you to provide us with certain personally identifiable information that can be used to contact or identify you. Personally identifiable information may include, but is not limited to:</p>
          <ul>
            <li><strong>Google Account Information:</strong> When you authenticate or verify your account using Google Sign-In, we collect your Google ID, email address, and profile picture.</li>
            <li><strong>Usage Customization Data:</strong> We collect details regarding your launcher profile preferences (profile background type, customized background values, skin model styles classic/slim, custom avatar pictures, and status emojis/texts).</li>
            <li><strong>Social Media Tags:</strong> If you choose to connect your social network profiles, we store Discord, Telegram, YouTube, and GitHub usernames you provide.</li>
          </ul>

          <h2>2. How We Use Your Data</h2>
          <p>We use the collected information for various purposes:</p>
          <ul>
            <li>To authorize and verify your account.</li>
            <li>To prevent unauthorized access or duplicate accounts.</li>
            <li>To display user profile customized statuses, custom avatars, custom backgrounds, and social links to other players in the launcher.</li>
            <li>To maintain the security and integrity of our game servers.</li>
          </ul>

          <h2>3. Data Protection and Storage</h2>
          <p>The security of your data is important to us. All passwords are encrypted using secure cryptographic hashing algorithms. We store your data securely in a local database and utilize secure industry-standard OAuth2 protocols to interface with Google Identity APIs. We do not sell or share your data with third parties.</p>

          <h2>4. Third-Party Services</h2>
          <p>Our Service utilizes Google OAuth2 for user verification. Google operates under its own Privacy Policy: <a href="https://policies.google.com/privacy" target="_blank">Google Privacy & Terms</a>.</p>

          <h2>5. Contact Us</h2>
          <p>If you have any questions about this Privacy Policy, you can contact us by email: support@diverlin.ru</p>
        </div>

        <div class="lang-divider"></div>

        <!-- RUSSIAN VERSION -->
        <div class="lang-section">
          <h1>Политика конфиденциальности</h1>
          <p>Последнее обновление: 30 июня 2026 г.</p>
          <p>Настоящая Политика конфиденциальности описывает наши правила и процедуры сбора, использования и раскрытия вашей информации при использовании DivLauncher («Приложение» или «Сервис»). Мы используем ваши данные для предоставления и улучшения Сервиса, верификации игроков и защиты учетных записей.</p>

          <h2>1. Сбор и использование информации</h2>
          <p>При использовании нашего Сервиса мы можем попросить вас предоставить определенную личную информацию для вашей идентификации. Личная информация может включать, помимо прочего:</p>
          <ul>
            <li><strong>Данные аккаунта Google:</strong> При авторизации или верификации через Google Sign-In мы собираем ваш Google ID, адрес электронной почты и аватар профиля.</li>
            <li><strong>Данные кастомизации:</strong> Мы собираем информацию о ваших предпочтениях профиля лаунчера (тип фонового изображения, значение кастомного фона, модель скина classic/slim, загруженный аватар, эмодзи и статус).</li>
            <li><strong>Социальные сети:</strong> Если вы решите привязать свои профили соцсетей, мы сохраняем указанные вами имена пользователей Discord, Telegram, YouTube и GitHub.</li>
          </ul>

          <h2>2. Использование ваших данных</h2>
          <p>Мы используем собранную информацию для следующих целей:</p>
          <ul>
            <li>Для авторизации и верификации вашего аккаунта.</li>
            <li>Для защиты от несанкционированного доступа и создания дубликатов аккаунтов.</li>
            <li>Для отображения вашего настроенного профиля (статус, аватар, обои и ссылки) другим игрокам в списке пользователей лаунчера.</li>
            <li>Для обеспечения безопасности и стабильной работы игровых серверов.</li>
          </ul>

          <h2>3. Защита и хранение данных</h2>
          <p>Безопасность ваших данных является приоритетом. Все пароли хэшируются с использованием надежных криптографических алгоритмов. Ваши данные надежно хранятся в базе данных авторизации. Мы используем стандартный протокол OAuth2 для интеграции с API авторизации Google. Мы не передаем и не продаем ваши личные данные третьим лицам.</p>

          <h2>4. Сторонние сервисы</h2>
          <p>Наш Сервис использует Google OAuth2 для верификации. Подробнее о политике Google: <a href="https://policies.google.com/privacy" target="_blank">Политика конфиденциальности Google</a>.</p>

          <h2>5. Обратная связь</h2>
          <p>Если у вас есть вопросы по политике конфиденциальности, вы можете связаться с нами по почте: support@diverlin.ru</p>
        </div>
      </div>
    </body>
    </html>
  `);
});

// GET /terms - Terms of Service Page (bilingual RU/EN)
app.get('/terms', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`
    <!DOCTYPE html>
    <html lang="ru">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Terms of Service - DivLauncher</title>
      <style>
        body {
          background: #09090e;
          color: #e4e4e7;
          font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          line-height: 1.6;
          margin: 0;
          padding: 40px 20px;
          display: flex;
          justify-content: center;
        }
        .container {
          max-width: 800px;
          background: rgba(15, 15, 25, 0.6);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 20px;
          padding: 40px;
          box-shadow: 0 20px 50px rgba(0,0,0,0.5);
        }
        h1 {
          color: #a78bfa;
          font-size: 28px;
          margin-top: 0;
          border-bottom: 1px solid rgba(255,255,255,0.1);
          padding-bottom: 15px;
          text-transform: uppercase;
          letter-spacing: 1px;
        }
        h2 {
          color: #10b981;
          font-size: 20px;
          margin-top: 30px;
          border-bottom: 1px solid rgba(255,255,255,0.05);
          padding-bottom: 8px;
        }
        p, li {
          color: #a1a1aa;
          font-size: 14px;
        }
        ul {
          padding-left: 20px;
        }
        .lang-divider {
          height: 1px;
          background: rgba(255, 255, 255, 0.1);
          margin: 40px 0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <!-- ENGLISH VERSION -->
        <div class="lang-section">
          <h1>Terms of Service</h1>
          <p>Last updated: June 30, 2026</p>
          <p>Please read these Terms of Service ("Terms", "Terms of Service") carefully before using the DivLauncher application and game servers (the "Service") operated by DivLauncher ("us", "we", or "our").</p>

          <h2>1. Terms Acceptance</h2>
          <p>By accessing or using the Service, you agree to be bound by these Terms. If you disagree with any part of the terms, you may not access the Service.</p>

          <h2>2. Accounts and Security</h2>
          <p>When you create an account with us, you must provide us information that is accurate, complete, and current at all times. Failure to do so constitutes a breach of the Terms, which may result in immediate termination of your account on our Service.</p>
          <p>You are responsible for safeguarding the password that you use to access the Service. You agree not to disclose your password to any third party.</p>

          <h2>3. Profile Customization and Upload Rules</h2>
          <p>Our Service permits you to customize your profile, including uploading custom background images, GIF files, and custom avatars. You are responsible for the content you upload. You agree not to upload any materials that:</p>
          <ul>
            <li>Are unlawful, offensive, hateful, or promote violence.</li>
            <li>Infringe upon copyrights, trademarks, or personal privacy of others.</li>
            <li>Contain explicit, adult content, or inappropriate materials.</li>
          </ul>
          <p>We reserve the right to remove any custom background or avatar, and suspend accounts violating these content guidelines.</p>

          <h2>4. Fair Play and Server Rules</h2>
          <p>You agree not to use modified game clients, cheats, hacks, exploits, or third-party tools that grant unfair competitive advantages on our game servers. Violations will result in permanent account termination.</p>

          <h2>5. Limitation of Liability</h2>
          <p>In no event shall DivLauncher, nor its developers, be liable for any indirect, incidental, special, consequential, or punitive damages arising out of your access to or use of the Service.</p>
        </div>

        <div class="lang-divider"></div>

        <!-- RUSSIAN VERSION -->
        <div class="lang-section">
          <h1>Условия использования</h1>
          <p>Последнее обновление: 30 июня 2026 г.</p>
          <p>Пожалуйста, внимательно прочтите настоящие Условия использования перед использованием приложения DivLauncher и игровых серверов (вместе — «Сервис»), управляемых DivLauncher («мы», «наш»).</p>

          <h2>1. Согласие с условиями</h2>
          <p>Используя наш Сервис, вы соглашаетесь соблюдать настоящие Условия. Если вы не согласны с какой-либо частью условий, вы не имеете права использовать Сервис.</p>

          <h2>2. Учетные записи и безопасность</h2>
          <p>При создании учетной записи вы обязуетесь указывать достоверную информацию. Вы несете личную ответственность за безопасность вашего пароля. Передача доступа к аккаунту третьим лицам запрещена.</p>

          <h2>3. Правила кастомизации и загрузки контента</h2>
          <p>Наш Сервис позволяет загружать собственные изображения/GIF для фона профиля и аватары. Загружая медиафайлы, вы соглашаетесь, что они не содержат:</p>
          <ul>
            <li>Материалов, нарушающих законодательство РФ, пропагандирующих насилие или разжигающих ненависть.</li>
            <li>Нарушений авторских прав третьих лиц.</li>
            <li>Элементов эротического или откровенного содержания.</li>
          </ul>
          <p>Администрация оставляет за собой право удалить любой кастомный контент и временно или навсегда заблокировать аккаунт в случае нарушения данных правил.</p>

          <h2>4. Честная игра и правила серверов</h2>
          <p>Запрещается использовать читы, вредоносные моды, дюпы, баги игры или сторонние утилиты для получения преимуществ на серверах. Нарушение правил игры ведет к постоянной блокировке аккаунта.</p>

          <h2>5. Ограничение ответственности</h2>
          <p>Разработчики DivLauncher ни при каких обстоятельствах не несут ответственности за любые прямые или косвенные убытки, возникшие в результате использования или невозможности использования данного Сервиса.</p>
        </div>
      </div>
    </body>
    </html>
  `);
});

// Global error handler middleware
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  if (!res.destroyed && !res.headersSent) {
    res.status(500).json({ error: 'InternalServerError', errorMessage: err.message || 'An unexpected error occurred.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Auth server running on port ${PORT}`);
  try {
    const { initializeLuckPermsDB } = require('./luckperms');
    await initializeLuckPermsDB();
  } catch (err) {
    console.error('Failed to initialize LuckPerms database on startup:', err);
  }
});
