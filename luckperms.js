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
    const host = '77.239.121.180';
    const user = 'luckperms';
    const password = 'luckpermspass';
    const database = 'luckperms';
    const port = 3306;

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

let isDbInitialized = false;

async function initializeLuckPermsDB(conn) {
  if (isDbInitialized) return;
  try {
    const [tables] = await conn.query("SHOW TABLES LIKE 'luckperms_groups'");
    if (tables.length === 0) {
      console.log('[LuckPerms Init] Tables do not exist yet. Waiting for Minecraft server to generate them...');
      return;
    }

    const groups = ['admin', 'developer', 'vip', 'sponsor', 'helper', 'default'];
    for (const group of groups) {
      await conn.query('INSERT IGNORE INTO luckperms_groups (name) VALUES (?)', [group]);
    }

    const prefixes = [
      { group: 'admin', priority: 100, text: '&#d62828&l[&#e63946&lАдмин&#d62828&l]&r ' },
      { group: 'developer', priority: 90, text: '&#7209b7&l[&#b5179e&lРазработчик&#7209b7&l]&r ' },
      { group: 'vip', priority: 80, text: '&#0096c7&l[&#00f5d4&lVIP&#0096c7&l]&r ' },
      { group: 'sponsor', priority: 70, text: '&#e85d04&l[&#faa307&lСпонсор&#e85d04&l]&r ' },
      { group: 'helper', priority: 60, text: '&#0077b6&l[&#00bbf9&lПомощник&#0077b6&l]&r ' }
    ];

    for (const p of prefixes) {
      const permission = `prefix.${p.priority}.${p.text}`;
      await conn.query('DELETE FROM luckperms_group_permissions WHERE name = ? AND permission LIKE "prefix.%"', [p.group]);
      await conn.query(
        `INSERT INTO luckperms_group_permissions (name, permission, value, server, world, expiry, contexts)
         VALUES (?, ?, 1, 'global', 'global', 0, '{}')`,
        [p.group, permission]
      );
    }
    isDbInitialized = true;
    console.log('[LuckPerms Init] Groups and prefixes successfully initialized in MySQL.');
  } catch (err) {
    console.error('[LuckPerms Init] Failed to initialize groups and prefixes in DB:', err.message);
  }
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
    await initializeLuckPermsDB(conn);
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
