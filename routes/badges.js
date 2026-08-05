const express = require('express');
const { getDb } = require('../db');
const { verifyServerToken } = require('../middleware/auth');
const { syncLuckPermsUser } = require('../luckperms');
const asyncHandler = require('../utils/asyncHandler');
const router = express.Router();

// GET /api/badges - Public badges list
router.get('/api/badges', asyncHandler(async (req, res) => {
  const db = await getDb();
  const badges = await db.all('SELECT * FROM badges ORDER BY code ASC');
  res.json(badges);
}));

// POST /api/server/award-badge - Award badge to user (In-Game Server token verified)
router.post('/api/server/award-badge', verifyServerToken, asyncHandler(async (req, res) => {
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

module.exports = router;
