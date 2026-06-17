const Database = require('better-sqlite3');
const path = require('path');

let dbInstance = null;

async function getDb() {
  if (!dbInstance) {
    const db = new Database(path.join(__dirname, 'database.sqlite'));
    
    // Mimic the async API of 'sqlite' wrapper
    dbInstance = {
      exec: async (sql) => {
        return db.exec(sql);
      },
      run: async (sql, ...params) => {
        const args = (params.length === 1 && Array.isArray(params[0])) ? params[0] : params;
        const result = db.prepare(sql).run(...args);
        return { lastID: result.lastInsertRowid, changes: result.changes };
      },
      get: async (sql, ...params) => {
        const args = (params.length === 1 && Array.isArray(params[0])) ? params[0] : params;
        return db.prepare(sql).get(...args);
      },
      all: async (sql, ...params) => {
        const args = (params.length === 1 && Array.isArray(params[0])) ? params[0] : params;
        return db.prepare(sql).all(...args);
      }
    };

    await dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        uuid TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        server_id TEXT,
        skin_url TEXT,
        cape_url TEXT,
        access_token TEXT,
        client_token TEXT,
        is_admin INTEGER DEFAULT 0,
        badge TEXT DEFAULT NULL,
        bio TEXT DEFAULT NULL
      )
    `);

    await dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS user_stats (
        user_id INTEGER PRIMARY KEY,
        playtime_seconds INTEGER DEFAULT 0,
        blocks_mined INTEGER DEFAULT 0,
        mobs_killed INTEGER DEFAULT 0,
        deaths INTEGER DEFAULT 0,
        achievements TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    try {
      await dbInstance.exec(`ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0`);
    } catch (e) {
      // Column might already exist, ignore
    }

    try {
      await dbInstance.exec(`ALTER TABLE users ADD COLUMN badge TEXT DEFAULT NULL`);
    } catch (e) {
      // Column might already exist, ignore
    }

    try {
      await dbInstance.exec(`ALTER TABLE users ADD COLUMN bio TEXT DEFAULT NULL`);
    } catch (e) {
      // Column might already exist, ignore
    }

    try {
      await dbInstance.run(`
        UPDATE users 
        SET skin_url = REPLACE(skin_url, 'https://skins.diverlin.ru/skins/', '/uploads/skins/') 
        WHERE skin_url LIKE 'https://skins.diverlin.ru/skins/%'
      `);
      await dbInstance.run(`
        UPDATE users 
        SET cape_url = REPLACE(cape_url, 'https://skins.diverlin.ru/capes/', '/uploads/capes/') 
        WHERE cape_url LIKE 'https://skins.diverlin.ru/capes/%'
      `);
    } catch (migrationErr) {
      console.error('Database migration failed:', migrationErr.message);
    }

    try {
      await dbInstance.exec(`
        CREATE TABLE IF NOT EXISTS server_keys (
          key_name TEXT PRIMARY KEY,
          key_value TEXT NOT NULL
        )
      `);

      let privateKeyRow = await dbInstance.get('SELECT key_value FROM server_keys WHERE key_name = ?', ['private_key']);
      let publicKeyRow = await dbInstance.get('SELECT key_value FROM server_keys WHERE key_name = ?', ['public_key']);

      if (!privateKeyRow || !publicKeyRow) {
        const crypto = require('crypto');
        const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
          modulusLength: 2048,
          publicKeyEncoding: {
            type: 'spki',
            format: 'pem'
          },
          privateKeyEncoding: {
            type: 'pkcs8',
            format: 'pem'
          }
        });
        await dbInstance.run('INSERT OR REPLACE INTO server_keys (key_name, key_value) VALUES (?, ?)', ['private_key', privateKey]);
        await dbInstance.run('INSERT OR REPLACE INTO server_keys (key_name, key_value) VALUES (?, ?)', ['public_key', publicKey]);
        dbInstance.privateKey = privateKey;
        dbInstance.publicKey = publicKey;
      } else {
        dbInstance.privateKey = privateKeyRow.key_value;
        dbInstance.publicKey = publicKeyRow.key_value;
      }
    } catch (keyErr) {
      console.error('Failed to initialize signature keys:', keyErr.message);
    }
  }
  
  return dbInstance;
}

module.exports = { getDb };
