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
      CREATE TABLE IF NOT EXISTS badges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        text TEXT NOT NULL,
        gradient_start TEXT NOT NULL,
        gradient_end TEXT NOT NULL,
        border_color TEXT NOT NULL,
        lp_group TEXT DEFAULT NULL,
        lp_prefix TEXT DEFAULT NULL,
        lp_priority INTEGER DEFAULT 80
      )
    `);

    try {
      const badgeCount = await dbInstance.get('SELECT COUNT(*) as count FROM badges');
      if (badgeCount && badgeCount.count === 0) {
        console.log('Seeding default badges...');
        const defaultBadges = [
          { code: 'ADMIN', text: 'ADMIN', gradient_start: '#ef4444', gradient_end: '#b91c1c', border_color: 'rgba(239, 68, 68, 0.35)', lp_group: 'admin', lp_prefix: '&#d62828&l[&#e63946&lАдмин&#d62828&l]&r ', lp_priority: 100 },
          { code: 'DEV', text: 'DEV', gradient_start: '#3b82f6', gradient_end: '#06b6d4', border_color: 'rgba(59, 130, 246, 0.35)', lp_group: 'developer', lp_prefix: '&#7209b7&l[&#b5179e&lРазработчик&#7209b7&l]&r ', lp_priority: 90 },
          { code: 'VIP', text: 'VIP', gradient_start: '#f59e0b', gradient_end: '#d97706', border_color: 'rgba(245, 158, 11, 0.35)', lp_group: 'vip', lp_prefix: '&#0096c7&l[&#00f5d4&lVIP&#0096c7&l]&r ', lp_priority: 80 },
          { code: 'PREMIUM', text: 'PREMIUM', gradient_start: '#10b981', gradient_end: '#0d9488', border_color: 'rgba(16, 185, 129, 0.35)', lp_group: null, lp_prefix: null, lp_priority: null },
          { code: 'YOUTUBE', text: 'YOUTUBE', gradient_start: '#ff0000', gradient_end: '#ea580c', border_color: 'rgba(255, 0, 0, 0.35)', lp_group: null, lp_prefix: null, lp_priority: null },
          { code: 'SPONSOR', text: 'SPONSOR', gradient_start: '#ec4899', gradient_end: '#8b5cf6', border_color: 'rgba(236, 72, 153, 0.35)', lp_group: 'sponsor', lp_prefix: '&#e85d04&l[&#faa307&lСпонсор&#e85d04&l]&r ', lp_priority: 70 },
          { code: 'HELPER', text: 'HELPER', gradient_start: '#8b5cf6', gradient_end: '#4f46e5', border_color: 'rgba(139, 92, 246, 0.35)', lp_group: 'helper', lp_prefix: '&#0077b6&l[&#00bbf9&lПомощник&#0077b6&l]&r ', lp_priority: 60 }
        ];
        for (const badge of defaultBadges) {
          await dbInstance.run(
            `INSERT INTO badges (code, text, gradient_start, gradient_end, border_color, lp_group, lp_prefix, lp_priority) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [badge.code, badge.text, badge.gradient_start, badge.gradient_end, badge.border_color, badge.lp_group, badge.lp_prefix, badge.lp_priority]
          );
        }
      }
    } catch (seedErr) {
      console.error('Failed to seed default badges:', seedErr.message);
    }

    try {
      await dbInstance.run(`UPDATE users SET badge = 'ADMIN' WHERE UPPER(TRIM(badge)) IN ('ADMIN', 'АДМИН', 'OWNER', 'СОЗДАТЕЛЬ')`);
      await dbInstance.run(`UPDATE users SET badge = 'DEV' WHERE UPPER(TRIM(badge)) IN ('DEV', 'DEVELOPER', 'РАЗРАБОТЧИК')`);
      await dbInstance.run(`UPDATE users SET badge = 'VIP' WHERE UPPER(TRIM(badge)) IN ('VIP', 'ВИП', 'GOLD')`);
      await dbInstance.run(`UPDATE users SET badge = 'PREMIUM' WHERE UPPER(TRIM(badge)) IN ('PREMIUM', 'PREM', 'ПРЕМИУМ')`);
      await dbInstance.run(`UPDATE users SET badge = 'YOUTUBE' WHERE UPPER(TRIM(badge)) IN ('YOUTUBE', 'YT', 'MEDIA')`);
      await dbInstance.run(`UPDATE users SET badge = 'SPONSOR' WHERE UPPER(TRIM(badge)) IN ('SPONSOR', 'СПОНСОР')`);
      await dbInstance.run(`UPDATE users SET badge = 'HELPER' WHERE UPPER(TRIM(badge)) IN ('HELPER', 'ХЕЛПЕР', 'MOD', 'MODER', 'МОДЕРАТОР')`);
    } catch (normErr) {
      console.error('Failed to normalize legacy user badges:', normErr.message);
    }


    const newColumns = [
      { name: 'google_id', type: 'TEXT DEFAULT NULL' },
      { name: 'google_email', type: 'TEXT DEFAULT NULL' },
      { name: 'profile_bg_type', type: 'TEXT DEFAULT \'preset\'' },
      { name: 'profile_bg_value', type: 'TEXT DEFAULT \'preset-1\'' },
      { name: 'skin_model', type: 'TEXT DEFAULT \'classic\'' },
      { name: 'avatar_type', type: 'TEXT DEFAULT \'minecraft\'' },
      { name: 'avatar_url', type: 'TEXT DEFAULT NULL' },
      { name: 'social_discord', type: 'TEXT DEFAULT NULL' },
      { name: 'social_telegram', type: 'TEXT DEFAULT NULL' },
      { name: 'social_youtube', type: 'TEXT DEFAULT NULL' },
      { name: 'social_github', type: 'TEXT DEFAULT NULL' },
      { name: 'status_emoji', type: 'TEXT DEFAULT NULL' },
      { name: 'status_text', type: 'TEXT DEFAULT NULL' }
    ];

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

    for (const col of newColumns) {
      try {
        await dbInstance.exec(`ALTER TABLE users ADD COLUMN ${col.name} ${col.type}`);
      } catch (e) {
        // Column might already exist, ignore
      }
    }

    try {
      await dbInstance.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)`);
    } catch (e) {
      // Index might already exist, ignore
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

      let keysValid = false;
      if (privateKeyRow && publicKeyRow) {
        try {
          const crypto = require('crypto');
          const testData = 'verification-test';
          const sign = crypto.createSign('sha1WithRSAEncryption');
          sign.update(testData);
          const signature = sign.sign(privateKeyRow.key_value, 'base64');
          
          const verify = crypto.createVerify('sha1WithRSAEncryption');
          verify.update(testData);
          keysValid = verify.verify(publicKeyRow.key_value, signature, 'base64');
        } catch (e) {
          keysValid = false;
        }
      }

      if (!keysValid) {
        console.log('Generating fresh matching signature keys...');
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
