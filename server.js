const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('./db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
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

app.get(['/api/yggdrasil', '/api/yggdrasil/'], (req, res) => {
  const host = req.get('host');
  const domain = host ? host.split(':')[0] : 'localhost';
  const domains = new Set(["localhost", "127.0.0.1", "mcauth.diverlin.ru", "diverlin.ru", domain]);
  
  res.json({
    meta: {
      serverName: "DivLauncher Auth",
      implementationName: "divlauncher-auth",
      implementationVersion: "1.0.0"
    },
    skinDomains: Array.from(domains),
    signaturePublickey: "" // For authlib-injector signature verification if needed
  });
});

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

  res.json({
    id: stripUUID(user.uuid),
    name: user.username,
    properties: [
      {
        name: "textures",
        value: texturesBase64
      }
    ]
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

  res.json({
    id: stripUUID(user.uuid),
    name: user.username,
    properties: [
      {
        name: "textures",
        value: texturesBase64
      }
    ]
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

  const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ id: user.id, username: user.username, uuid: user.uuid, is_admin: user.is_admin }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { username: user.username, uuid: user.uuid, skin_url: user.skin_url, cape_url: user.cape_url, is_admin: user.is_admin } });
}));

app.get('/api/profile', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send();
  const token = authHeader.split(' ')[1];
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const db = await getDb();
    const user = await db.get('SELECT username, uuid, skin_url, cape_url, is_admin FROM users WHERE id = ?', [decoded.id]);
    res.json(user);
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
    
    const users = await db.all('SELECT id, username, uuid, skin_url, cape_url, is_admin FROM users');
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

// Global error handler middleware
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  if (!res.destroyed && !res.headersSent) {
    res.status(500).json({ error: 'InternalServerError', errorMessage: err.message || 'An unexpected error occurred.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Auth server running on port ${PORT}`);
});
