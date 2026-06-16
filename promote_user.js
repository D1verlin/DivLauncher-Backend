const { getDb } = require('./db');

async function main() {
  const username = process.argv[2];
  if (!username) {
    console.error('Please specify username, e.g. node promote_user.js username');
    process.exit(1);
  }
  
  try {
    const db = await getDb();
    
    // Check if user exists
    const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);
    if (!user) {
      console.error(`User "${username}" not found!`);
      process.exit(1);
    }
    
    await db.run('UPDATE users SET is_admin = 1 WHERE username = ?', [username]);
    console.log(`Successfully made "${username}" an admin!`);
  } catch (err) {
    console.error('Error:', err.message);
  }
}

main();
