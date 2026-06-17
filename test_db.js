const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
let mysql;
try {
  mysql = require('mysql2/promise');
} catch (e) {
  console.error('[ОШИБКА] Модуль mysql2 не установлен. Пожалуйста, запустите "npm install" в папке backend перед тестом.');
  process.exit(1);
}

const host = process.env.LP_DB_HOST || '77.239.121.180';
const port = parseInt(process.env.LP_DB_PORT || 3306);
const user = process.env.LP_DB_USER || 'luckperms';
const password = process.env.LP_DB_PASS || 'luckpermspass';
const database = process.env.LP_DB_NAME || 'luckperms';

console.log('=== ДИАГНОСТИКА ПОДКЛЮЧЕНИЯ К БАЗЕ ДАННЫХ LUCKPERMS ===');
console.log(`Хост: ${host}`);
console.log(`Порт: ${port}`);
console.log(`Пользователь: ${user}`);
console.log(`База данных: ${database}`);
console.log(`Пароль: ${password ? '****' : '(пусто)'}`);
console.log('----------------------------------------------------');
console.log('Попытка подключения...');

mysql.createConnection({
  host,
  port,
  user,
  password,
  database,
  connectTimeout: 5000
}).then(async (conn) => {
  console.log('\n[УСПЕШНО] Подключение к MySQL успешно установлено!');
  
  // Проверим наличие необходимых таблиц LuckPerms
  try {
    const [rows] = await conn.query("SHOW TABLES LIKE 'luckperms_%'");
    console.log(`[ИНФО] Найдено таблиц LuckPerms: ${rows.length}`);
    if (rows.length === 0) {
      console.log('[ПРЕДУПРЕЖДЕНИЕ] База данных пуста или таблицы LuckPerms еще не созданы плагином.');
    }
  } catch (err) {
    console.log(`[ОШИБКА] Не удалось выполнить запрос проверки таблиц: ${err.message}`);
  }
  
  await conn.end();
  process.exit(0);
}).catch((err) => {
  console.error('\n[ОШИБКА] Не удалось подключиться к базе данных MySQL:');
  console.error(err.message);
  console.log('\nВозможные причины:');
  if (err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND') {
    console.log('1. Неверный IP-адрес хоста (LP_DB_HOST).');
    console.log('2. Порт 3306 закрыт брандмауэром (Firewall) на сервере базы данных.');
    console.log('3. База данных не запущена или слушает только localhost.');
  } else if (err.code === 'ER_ACCESS_DENIED_ERROR') {
    console.log('1. Неверное имя пользователя (LP_DB_USER) или пароль (LP_DB_PASS).');
    console.log('2. У этого пользователя нет прав на подключение с вашего текущего IP-адреса.');
  } else if (err.code === 'ER_BAD_DB_ERROR') {
    console.log('1. База данных с именем (LP_DB_NAME) не существует.');
  }
  process.exit(1);
});
