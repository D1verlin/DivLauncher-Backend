const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { getDb } = require('../db');
const { JWT_SECRET } = require('../config');
const asyncHandler = require('../utils/asyncHandler');
const router = express.Router();

// GET /api/profile
router.get('/api/profile', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send();
  const token = authHeader.split(' ')[1];
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const db = await getDb();
    
    const { uuid } = req.query;
    let user;
    if (uuid) {
      user = await db.get(`
        SELECT id, username, uuid, skin_url, cape_url, is_admin, badge, bio, google_email,
               profile_bg_type, profile_bg_value, skin_model, avatar_type, avatar_url,
               social_discord, social_telegram, social_youtube, social_github,
               status_emoji, status_text, avatar_border_color, current_activity, current_game, two_factor_enabled
        FROM users
        WHERE REPLACE(uuid, '-', '') = REPLACE(?, '-', '')
      `, [uuid]);
    } else {
      user = await db.get(`
        SELECT id, username, uuid, skin_url, cape_url, is_admin, badge, bio, google_email,
               profile_bg_type, profile_bg_value, skin_model, avatar_type, avatar_url,
               social_discord, social_telegram, social_youtube, social_github,
               status_emoji, status_text, avatar_border_color, current_activity, current_game, two_factor_enabled
        FROM users
        WHERE id = ?
      `, [decoded.id]);
    }

    if (!user) return res.status(404).send();

    res.json(user);
  } catch (err) {
    res.status(401).send();
  }
}));

// POST /api/profile/password
router.post('/api/profile/password', asyncHandler(async (req, res) => {
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

// POST /api/profile/bio
router.post('/api/profile/bio', asyncHandler(async (req, res) => {
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

// POST /api/profile/customize
router.post('/api/profile/customize', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send();
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const updates = req.body;
    const db = await getDb();

    const allowedFields = [
      'profile_bg_type', 'profile_bg_value', 'skin_model', 'avatar_type',
      'status_emoji', 'status_text', 'bio', 'avatar_border_color',
      'current_activity', 'current_game'
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
             status_emoji, status_text, bio, google_email, avatar_border_color,
             current_activity, current_game
      FROM users WHERE id = ?
    `, [decoded.id]);

    res.json({ message: 'Profile updated successfully', user: updatedUser });
  } catch (err) {
    res.status(401).send();
  }
}));

// POST /api/profile/google/unlink
router.post('/api/profile/google/unlink', asyncHandler(async (req, res) => {
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

module.exports = router;
