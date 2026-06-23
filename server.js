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

const JWT_SECRET = 'your-super-secret-key';
const SERVER_DOMAIN = 'http://localhost:3000'; // Change to actual domain in prod

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
    SELECT u.*, s.playtime_seconds, s.blocks_mined, s.mobs_killed, s.deaths, s.achievements
    FROM users u
    LEFT JOIN user_stats s ON u.id = s.user_id
    WHERE u.username = ?
  `, [username]);

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ id: user.id, username: user.username, uuid: user.uuid, is_admin: user.is_admin }, JWT_SECRET, { expiresIn: '7d' });
  
  const stats = {
    playtime_seconds: user.playtime_seconds || 0,
    blocks_mined: user.blocks_mined || 0,
    mobs_killed: user.mobs_killed || 0,
    deaths: user.deaths || 0,
    achievements_completed: user.achievements ? JSON.parse(user.achievements) : []
  };

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
      stats
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
      SELECT u.id, u.username, u.uuid, u.skin_url, u.cape_url, u.is_admin, u.badge, u.bio,
             s.playtime_seconds, s.blocks_mined, s.mobs_killed, s.deaths, s.achievements
      FROM users u
      LEFT JOIN user_stats s ON u.id = s.user_id
      WHERE u.id = ?
    `, [decoded.id]);

    if (user) {
      user.stats = {
        playtime_seconds: user.playtime_seconds || 0,
        blocks_mined: user.blocks_mined || 0,
        mobs_killed: user.mobs_killed || 0,
        deaths: user.deaths || 0,
        achievements_completed: user.achievements ? JSON.parse(user.achievements) : []
      };
      delete user.playtime_seconds;
      delete user.blocks_mined;
      delete user.mobs_killed;
      delete user.deaths;
      delete user.achievements;
    }

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

app.post('/api/profile/sync-stats', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send();
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { playtime_seconds = 0, blocks_mined = 0, mobs_killed = 0, deaths = 0, achievements = [] } = req.body;
    const db = await getDb();
    
    // Insert or update stats inside user_stats
    await db.run(`
      INSERT INTO user_stats (user_id, playtime_seconds, blocks_mined, mobs_killed, deaths, achievements, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET
        playtime_seconds = excluded.playtime_seconds,
        blocks_mined = excluded.blocks_mined,
        mobs_killed = excluded.mobs_killed,
        deaths = excluded.deaths,
        achievements = excluded.achievements,
        updated_at = CURRENT_TIMESTAMP
    `, [decoded.id, playtime_seconds, blocks_mined, mobs_killed, deaths, JSON.stringify(achievements)]);

    // Automatically award "Ветеран" badge if playtime >= 50 hours (180000 seconds)
    if (playtime_seconds >= 50 * 3600) {
      const user = await db.get("SELECT badge, uuid, username FROM users WHERE id = ?", [decoded.id]);
      if (user && user.badge !== 'Ветеран') {
        await db.run('UPDATE users SET badge = ? WHERE id = ?', ['Ветеран', decoded.id]);
        console.log(`[Badge Auto-Award] Awarded "Ветеран" badge to ${user.username} (Playtime: ${playtime_seconds}s)`);
        await syncLuckPermsUser(user.uuid, user.username, 'Ветеран');
      }
    }

    res.json({ message: 'Stats synced successfully' });
  } catch (err) {
    console.error('Stats sync error:', err.message);
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
      SELECT u.username, u.uuid, u.skin_url, u.cape_url, u.is_admin, u.badge, u.bio,
             s.playtime_seconds, s.blocks_mined, s.mobs_killed, s.deaths, s.achievements
      FROM users u
      LEFT JOIN user_stats s ON u.id = s.user_id
    `);

    const formattedUsers = users.map(user => {
      user.stats = {
        playtime_seconds: user.playtime_seconds || 0,
        blocks_mined: user.blocks_mined || 0,
        mobs_killed: user.mobs_killed || 0,
        deaths: user.deaths || 0,
        achievements_completed: user.achievements ? JSON.parse(user.achievements) : []
      };
      delete user.playtime_seconds;
      delete user.blocks_mined;
      delete user.mobs_killed;
      delete user.deaths;
      delete user.achievements;
      return user;
    });

    res.json(formattedUsers);
  } catch (err) {
    res.status(401).send();
  }
}));

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

app.post('/api/server/sync-stats', verifyServerToken, asyncHandler(async (req, res) => {
  const { uuid, username, stats } = req.body;
  if (!uuid) {
    return res.status(400).json({ error: 'BadRequest', errorMessage: 'Missing player UUID' });
  }

  const db = await getDb();
  
  // Find user by uuid (ignoring dashes) or username as fallback
  let user = await db.get(
    "SELECT id, username, uuid FROM users WHERE REPLACE(uuid, '-', '') = REPLACE(?, '-', '') OR username = ?", 
    [uuid, uuid, username]
  );
  
  if (!user) {
    console.log(`[Stats Sync] User with UUID ${uuid} or username ${username} not found in launcher database.`);
    return res.status(404).json({ error: 'UserNotFound', errorMessage: 'User not registered in launcher' });
  }

  const playerStats = stats || {};
  await db.run(
    `INSERT INTO user_stats (user_id, playtime_seconds, blocks_mined, mobs_killed, deaths, achievements, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id) DO UPDATE SET
       playtime_seconds = excluded.playtime_seconds,
       blocks_mined = excluded.blocks_mined,
       mobs_killed = excluded.mobs_killed,
       deaths = excluded.deaths,
       achievements = excluded.achievements,
       updated_at = CURRENT_TIMESTAMP`,
    [
      user.id,
      playerStats.playtime_seconds || 0,
      playerStats.blocks_mined || 0,
      playerStats.mobs_killed || 0,
      playerStats.deaths || 0,
      JSON.stringify(playerStats.achievements_completed || [])
    ]
  );

  console.log(`[Stats Sync] Synced stats for ${user.username} (${uuid}) successfully.`);
  res.json({ message: 'Stats synced successfully' });
}));

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
