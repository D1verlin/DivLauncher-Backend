let mysql = null;
try {
  mysql = require('mysql2/promise');
} catch (e) {
  // mysql2 is not installed, which is fine if only using SQLite locally
}

// Badge to LuckPerms group mapping
const BADGE_MAP = {
  'ADMIN': 'admin',
  'DEV': 'developer',
  'VIP': 'vip',
  'SPONSOR': 'sponsor',
  'HELPER': 'helper'
};

const ALL_GROUPS = Object.values(BADGE_MAP);

let pool = null;

function getPool() {
  if (!pool) {
    const host = process.env.LP_DB_HOST || '77.239.121.180';
    const user = process.env.LP_DB_USER || 'luckperms';
    const password = process.env.LP_DB_PASS || 'luckpermspass';
    const database = process.env.LP_DB_NAME || 'luckperms';
    const port = process.env.LP_DB_PORT || 3306;

    if (!mysql) {
      console.log('[LuckPerms Sync] The "mysql2" module is not installed. Run "npm install mysql2" to enable database synchronization.');
      return null;
    }

    try {
      pool = mysql.createPool({
        host,
        user,
        password,
        database,
        port: parseInt(port),
        waitForConnections: true,
        connectionLimit: 5,
        queueLimit: 0
      });
      console.log('[LuckPerms Sync] MySQL connection pool initialized for host:', host);
    } catch (err) {
      console.error('[LuckPerms Sync] Failed to create MySQL pool:', err.message);
    }
  }
  return pool;
}

/**
 * Formats a UUID to ensure it has hyphens (36 chars) as required by LuckPerms.
 */
function formatUUID(uuid) {
  if (!uuid) return null;
  // If uuid has no dashes, insert them: 8-4-4-4-12
  if (uuid.indexOf('-') === -1 && uuid.length === 32) {
    return `${uuid.substring(0, 8)}-${uuid.substring(8, 12)}-${uuid.substring(12, 16)}-${uuid.substring(16, 20)}-${uuid.substring(20)}`;
  }
  return uuid;
}

/**
 * Synchronizes user permissions and roles in the LuckPerms MySQL database.
 * @param {string} rawUuid User UUID
 * @param {string} username Username
 * @param {string|null} badge Badge name
 */
async function syncLuckPermsUser(rawUuid, username, badge) {
  const connectionPool = getPool();
  if (!connectionPool) return;

  const uuid = formatUUID(rawUuid);
  if (!uuid) {
    console.error('[LuckPerms Sync] Invalid UUID passed for sync:', rawUuid);
    return;
  }

  const groupName = badge ? BADGE_MAP[badge.toUpperCase()] : null;
  console.log(`[LuckPerms Sync] Syncing user ${username} (${uuid}) with badge ${badge} -> LuckPerms group ${groupName}`);

  let conn;
  try {
    conn = await connectionPool.getConnection();
    await conn.beginTransaction();

    // 1. Delete existing badge groups for this user
    for (const group of ALL_GROUPS) {
      const permission = `group.${group}`;
      await conn.query(
        'DELETE FROM luckperms_user_permissions WHERE uuid = ? AND permission = ?',
        [uuid, permission]
      );
    }

    // 2. Add the new badge group if set
    if (groupName) {
      const permission = `group.${groupName}`;
      await conn.query(
        `INSERT INTO luckperms_user_permissions (uuid, permission, value, server, world, expiry, contexts)
         VALUES (?, ?, 1, 'global', 'global', 0, '{}')`,
        [uuid, permission]
      );
    }

    // 3. Sync player primary group and username in luckperms_players
    const primaryGroup = groupName || 'default';
    await conn.query(
      `INSERT INTO luckperms_players (uuid, username, primary_group)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE username = VALUES(username), primary_group = VALUES(primary_group)`,
      [uuid, username, primaryGroup]
    );

    await conn.commit();
    console.log(`[LuckPerms Sync] Successfully synced ${username} to LuckPerms`);
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch (rbErr) {
        console.error('[LuckPerms Sync] Rollback error:', rbErr.message);
      }
    }
    console.error('[LuckPerms Sync] Database sync failed:', err.message);
  } finally {
    if (conn) conn.release();
  }
}

module.exports = {
  syncLuckPermsUser
};
