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
        is_admin INTEGER DEFAULT 0
      )
    `);

    try {
      await dbInstance.exec(`ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0`);
    } catch (e) {
      // Column might already exist, ignore
    }
  }
  
  return dbInstance;
}

module.exports = { getDb };
