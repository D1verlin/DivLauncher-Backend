const express = require('express');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { getDb } = require('../db');
const { JWT_SECRET, skinsDir, capesDir, backgroundsDir, avatarsDir } = require('../config');
const asyncHandler = require('../utils/asyncHandler');
const { validateMinecraftPng } = require('../utils/validators');
const router = express.Router();

const uploadMemory = multer({ storage: multer.memoryStorage() });

// GET /api/skins/:username
router.get('/api/skins/:username', asyncHandler(async (req, res) => {
  const username = req.params.username.replace(/\.png$/i, '');
  const db = await getDb();
  const user = await db.get('SELECT skin_url FROM users WHERE username = ?', [username]);

  if (!user || !user.skin_url) {
    return res.redirect('https://textures.minecraft.net/texture/1a65f6c2084c7e6a57564619379d71c4c82b4dfa666ee3b1a2080a424af6e8c');
  }

  const relativePath = user.skin_url.split('?')[0];
  const absolutePath = path.join(__dirname, '..', relativePath);
  if (fs.existsSync(absolutePath)) {
    return res.sendFile(absolutePath);
  }
  res.redirect('https://textures.minecraft.net/texture/1a65f6c2084c7e6a57564619379d71c4c82b4dfa666ee3b1a2080a424af6e8c');
}));

// GET /api/capes/:username
router.get('/api/capes/:username', asyncHandler(async (req, res) => {
  const username = req.params.username.replace(/\.png$/i, '');
  const db = await getDb();
  const user = await db.get('SELECT cape_url FROM users WHERE username = ?', [username]);

  if (!user || !user.cape_url) {
    return res.status(404).send('Cape not found');
  }

  const relativePath = user.cape_url.split('?')[0];
  const absolutePath = path.join(__dirname, '..', relativePath);
  if (fs.existsSync(absolutePath)) {
    return res.sendFile(absolutePath);
  }
  res.status(404).send('Cape file not found');
}));

// POST /api/profile/skin
router.post('/api/profile/skin', (req, res, next) => {
  uploadMemory.single('skin')(req, res, (err) => {
    if (err) return next(err);
    next();
  });
}, asyncHandler(async (req, res) => {
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
    if (!req.file) {
      if (!res.destroyed && !res.headersSent) {
        res.status(400).json({ error: 'NoFile', errorMessage: 'Не передан файл скина' });
      }
      return;
    }

    if (req.file.size > 500 * 1024) {
      if (!res.destroyed && !res.headersSent) {
        res.status(400).json({ error: 'TooLarge', errorMessage: 'Скин слишком большого размера (лимит 500 КБ)' });
      }
      return;
    }

    if (req.file.mimetype !== 'image/png') {
      if (!res.destroyed && !res.headersSent) {
        res.status(400).json({ error: 'InvalidType', errorMessage: 'Разрешены только файлы PNG' });
      }
      return;
    }

    const valResult = validateMinecraftPng(req.file.buffer, false);
    if (!valResult.valid) {
      if (!res.destroyed && !res.headersSent) {
        res.status(400).json({ error: 'InvalidDimensions', errorMessage: valResult.error });
      }
      return;
    }

    const targetPath = path.join(skinsDir, `${decoded.id}.png`);
    fs.writeFileSync(targetPath, req.file.buffer);

    const skinUrl = `/uploads/skins/${decoded.id}.png?v=${Date.now()}`;

    const db = await getDb();
    await db.run('UPDATE users SET skin_url = ? WHERE id = ?', [skinUrl, decoded.id]);
    
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

// POST /api/profile/cape
router.post('/api/profile/cape', (req, res, next) => {
  uploadMemory.single('cape')(req, res, (err) => {
    if (err) return next(err);
    next();
  });
}, asyncHandler(async (req, res) => {
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
    if (!req.file) {
      if (!res.destroyed && !res.headersSent) {
        res.status(400).json({ error: 'NoFile', errorMessage: 'Не передан файл плаща' });
      }
      return;
    }

    if (req.file.size > 100 * 1024) {
      if (!res.destroyed && !res.headersSent) {
        res.status(400).json({ error: 'TooLarge', errorMessage: 'Плащ слишком большого размера (лимит 100 КБ)' });
      }
      return;
    }

    if (req.file.mimetype !== 'image/png') {
      if (!res.destroyed && !res.headersSent) {
        res.status(400).json({ error: 'InvalidType', errorMessage: 'Разрешены только файлы PNG' });
      }
      return;
    }

    const valResult = validateMinecraftPng(req.file.buffer, true);
    if (!valResult.valid) {
      if (!res.destroyed && !res.headersSent) {
        res.status(400).json({ error: 'InvalidDimensions', errorMessage: valResult.error });
      }
      return;
    }

    const targetPath = path.join(capesDir, `${decoded.id}.png`);
    fs.writeFileSync(targetPath, req.file.buffer);

    const capeUrl = `/uploads/capes/${decoded.id}.png?v=${Date.now()}`;

    const db = await getDb();
    await db.run('UPDATE users SET cape_url = ? WHERE id = ?', [capeUrl, decoded.id]);
    
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

// POST /api/profile/background
router.post('/api/profile/background', (req, res, next) => {
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

    const files = fs.readdirSync(backgroundsDir);
    for (const file of files) {
      if (file.startsWith(`${decoded.id}.`)) {
        try { fs.unlinkSync(path.join(backgroundsDir, file)); } catch (e) {}
      }
    }

    const fileName = `${decoded.id}.${ext}`;
    const targetPath = path.join(backgroundsDir, fileName);
    fs.writeFileSync(targetPath, req.file.buffer);

    const bgUrl = `/uploads/backgrounds/${fileName}?v=${Date.now()}`;
    const db = await getDb();
    await db.run('UPDATE users SET profile_bg_type = ?, profile_bg_value = ? WHERE id = ?', ['custom', bgUrl, decoded.id]);

    res.json({ message: 'Background uploaded successfully', profile_bg_value: bgUrl });
  } catch (err) {
    res.status(401).send();
  }
}));

// POST /api/profile/avatar
router.post('/api/profile/avatar', (req, res, next) => {
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

    const files = fs.readdirSync(avatarsDir);
    for (const file of files) {
      if (file.startsWith(`${decoded.id}.`)) {
        try { fs.unlinkSync(path.join(avatarsDir, file)); } catch (e) {}
      }
    }

    const fileName = `${decoded.id}.${ext}`;
    const targetPath = path.join(avatarsDir, fileName);
    fs.writeFileSync(targetPath, req.file.buffer);

    const avatarUrl = `/uploads/avatars/${fileName}?v=${Date.now()}`;
    const db = await getDb();
    await db.run('UPDATE users SET avatar_type = ?, avatar_url = ? WHERE id = ?', ['custom', avatarUrl, decoded.id]);

    res.json({ message: 'Avatar uploaded successfully', avatar_url: avatarUrl });
  } catch (err) {
    res.status(401).send();
  }
}));

module.exports = router;
