const express = require('express');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { ListObjectsV2Command, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const { getDb } = require('../db');
const { JWT_SECRET, R2_MODS_BUCKET, R2_MODS_PUBLIC_URL, getR2ModsClient } = require('../config');
const { requireAdmin } = require('../middleware/auth');
const { syncLuckPermsUser, syncLuckPermsGroup } = require('../luckperms');
const asyncHandler = require('../utils/asyncHandler');
const router = express.Router();

const uploadR2Memory = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

// Helper: stream to buffer
async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// GET /api/users - List users for logged in users
router.get('/api/users', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send();
  const token = authHeader.split(' ')[1];
  try {
    jwt.verify(token, JWT_SECRET);
    const db = await getDb();
    const users = await db.all(`
      SELECT id, username, uuid, skin_url, cape_url, is_admin, badge, bio,
             profile_bg_type, profile_bg_value, skin_model, avatar_type, avatar_url,
             status_emoji, status_text, avatar_border_color, current_activity, current_game
      FROM users
    `);

    res.json(users);
  } catch (err) {
    res.status(401).send();
  }
}));

// GET /api/admin/users
router.get('/api/admin/users', asyncHandler(async (req, res) => {
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

// DELETE /api/admin/users/:id
router.delete('/api/admin/users/:id', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send();
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const db = await getDb();
    const currentUser = await db.get('SELECT is_admin FROM users WHERE id = ?', [decoded.id]);
    if (!currentUser || !currentUser.is_admin) return res.status(403).json({ error: 'Not an admin' });
    
    if (parseInt(req.params.id) === decoded.id) {
      return res.status(400).json({ error: 'Cannot delete yourself' });
    }
    await db.run('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(401).send();
  }
}));

// PUT /api/admin/users/:id
router.put('/api/admin/users/:id', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send();
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const db = await getDb();
    const currentUser = await db.get('SELECT is_admin FROM users WHERE id = ?', [decoded.id]);
    if (!currentUser || !currentUser.is_admin) return res.status(403).json({ error: 'Not an admin' });

    const { is_admin, badge, bio } = req.body;
    
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

// POST /api/admin/promote/:id
router.post('/api/admin/promote/:id', asyncHandler(async (req, res) => {
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

// --- Badges Admin Routes ---

// POST /api/admin/badges
router.post('/api/admin/badges', requireAdmin, asyncHandler(async (req, res) => {
  const { code, text, gradient_start, gradient_end, border_color, lp_group, lp_prefix, lp_priority } = req.body;
  if (!code || !text || !gradient_start || !gradient_end || !border_color) {
    return res.status(400).json({ error: 'MissingRequiredFields', errorMessage: 'Missing required badge fields' });
  }
  const cleanCode = code.toUpperCase().trim();
  const db = await getDb();
  try {
    const result = await db.run(
      `INSERT INTO badges (code, text, gradient_start, gradient_end, border_color, lp_group, lp_prefix, lp_priority)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [cleanCode, text.trim(), gradient_start.trim(), gradient_end.trim(), border_color.trim(), lp_group ? lp_group.trim() : null, lp_prefix ? lp_prefix.trim() : null, lp_priority ? parseInt(lp_priority, 10) : 80]
    );
    
    if (lp_group) {
      await syncLuckPermsGroup(lp_group, lp_prefix, lp_priority);
    }
    
    const newBadge = await db.get('SELECT * FROM badges WHERE id = ?', [result.lastID]);
    res.status(201).json(newBadge);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'BadgeExists', errorMessage: 'A badge with this code already exists' });
    }
    throw err;
  }
}));

// PUT /api/admin/badges/:id
router.put('/api/admin/badges/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { code, text, gradient_start, gradient_end, border_color, lp_group, lp_prefix, lp_priority } = req.body;
  if (!code || !text || !gradient_start || !gradient_end || !border_color) {
    return res.status(400).json({ error: 'MissingRequiredFields', errorMessage: 'Missing required badge fields' });
  }
  const cleanCode = code.toUpperCase().trim();
  const db = await getDb();
  
  const oldBadge = await db.get('SELECT code, lp_group FROM badges WHERE id = ?', [req.params.id]);
  if (!oldBadge) {
    return res.status(404).json({ error: 'BadgeNotFound', errorMessage: 'Badge not found' });
  }
  
  try {
    await db.run(
      `UPDATE badges 
       SET code = ?, text = ?, gradient_start = ?, gradient_end = ?, border_color = ?, lp_group = ?, lp_prefix = ?, lp_priority = ?
       WHERE id = ?`,
      [cleanCode, text.trim(), gradient_start.trim(), gradient_end.trim(), border_color.trim(), lp_group ? lp_group.trim() : null, lp_prefix ? lp_prefix.trim() : null, lp_priority ? parseInt(lp_priority, 10) : 80, req.params.id]
    );
    
    if (oldBadge.code !== cleanCode) {
      await db.run('UPDATE users SET badge = ? WHERE UPPER(badge) = ?', [cleanCode, oldBadge.code]);
    }
    
    if (lp_group) {
      await syncLuckPermsGroup(lp_group, lp_prefix, lp_priority);
    }
    
    const updatedBadge = await db.get('SELECT * FROM badges WHERE id = ?', [req.params.id]);
    res.json(updatedBadge);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'BadgeExists', errorMessage: 'A badge with this code already exists' });
    }
    throw err;
  }
}));

// DELETE /api/admin/badges/:id
router.delete('/api/admin/badges/:id', requireAdmin, asyncHandler(async (req, res) => {
  const db = await getDb();
  const badge = await db.get('SELECT code FROM badges WHERE id = ?', [req.params.id]);
  if (!badge) {
    return res.status(404).json({ error: 'BadgeNotFound', errorMessage: 'Badge not found' });
  }
  
  const usersToSync = await db.all('SELECT username, uuid FROM users WHERE UPPER(badge) = ?', [badge.code]);
  await db.run('UPDATE users SET badge = NULL WHERE UPPER(badge) = ?', [badge.code]);
  await db.run('DELETE FROM badges WHERE id = ?', [req.params.id]);
  
  for (const u of usersToSync) {
    await syncLuckPermsUser(u.uuid, u.username, null);
  }
  
  res.json({ message: 'Badge deleted successfully and users updated' });
}));

// --- Admin R2 Routes ---

// GET /api/admin/r2/list
router.get('/api/admin/r2/list', requireAdmin, asyncHandler(async (req, res) => {
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

// POST /api/admin/r2/upload
router.post('/api/admin/r2/upload', requireAdmin, (req, res, next) => {
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

// DELETE /api/admin/r2/delete
router.delete('/api/admin/r2/delete', requireAdmin, asyncHandler(async (req, res) => {
  const { key } = req.query;
  if (!key) return res.status(400).json({ error: 'Missing key query param' });
  console.log(`[R2 delete] bucket=${R2_MODS_BUCKET} key="${key}"`);
  const s3 = getR2ModsClient();
  await s3.send(new DeleteObjectCommand({ Bucket: R2_MODS_BUCKET, Key: key }));
  res.json({ success: true, key });
}));

// GET /api/admin/r2/mods-json
router.get('/api/admin/r2/mods-json', requireAdmin, asyncHandler(async (req, res) => {
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

// PUT /api/admin/r2/mods-json
router.put('/api/admin/r2/mods-json', requireAdmin, asyncHandler(async (req, res) => {
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

module.exports = router;
