const Database = require('better-sqlite3');
const path = require('path');

try {
  const db = new Database(path.join(__dirname, 'database.sqlite'));
  const users = db.prepare('SELECT id, username, is_admin FROM users').all();
  console.log('USERS_LIST_START');
  console.log(JSON.stringify(users, null, 2));
  console.log('USERS_LIST_END');
} catch (err) {
  console.error('Error:', err.message);
}
