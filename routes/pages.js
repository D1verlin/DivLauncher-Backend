const express = require('express');
const path = require('path');
const asyncHandler = require('../utils/asyncHandler');
const router = express.Router();

// GET / - Serves custom landing HTML page
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'landing.html'));
});

// GET /download - Dynamically resolves latest version from latest.yml & redirects to R2
router.get('/download', asyncHandler(async (req, res) => {
  const r2Url = process.env.R2_PUBLIC_URL || 'https://mc.diverlin.ru';
  const ymlUrls = [
    `${r2Url}/DivLauncher/updates/latest.yml`,
    `${r2Url}/updates/latest.yml`
  ];
  
  const fetchText = async (url) => {
    if (typeof fetch === 'function') {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Fetch status ${response.status} for ${url}`);
      }
      return await response.text();
    }
    const https = require('https');
    return new Promise((resolve, reject) => {
      const getUrl = (targetUrl) => {
        https.get(targetUrl, (response) => {
          if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            return getUrl(response.headers.location);
          }
          if (response.statusCode < 200 || response.statusCode >= 300) {
            return reject(new Error(`Status Code: ${response.statusCode} for ${targetUrl}`));
          }
          let data = '';
          response.on('data', (chunk) => { data += chunk; });
          response.on('end', () => resolve(data));
        }).on('error', (err) => reject(err));
      };
      getUrl(url);
    });
  };

  let ymlContent = null;
  let successUrl = null;

  for (const url of ymlUrls) {
    try {
      ymlContent = await fetchText(url);
      successUrl = url;
      console.log(`[Download] Successfully fetched latest.yml from: ${url}`);
      break;
    } catch (err) {
      console.warn(`[Download] Failed fetching latest.yml from: ${url} - Reason: ${err.message}`);
    }
  }

  if (ymlContent) {
    const match = ymlContent.match(/path:\s*(.+)/);
    if (match && match[1]) {
      let fileName = match[1].replace(/\r?\n$/, '').trim();
      if (fileName.startsWith('http')) {
        console.log(`[Download] Redirecting directly to full URL: ${fileName}`);
        return res.redirect(fileName);
      }
      if (fileName.startsWith('/')) {
        fileName = fileName.substring(1);
      }
      
      const contextDir = successUrl.includes('/DivLauncher/updates/') ? 'DivLauncher/updates' : 'updates';
      const redirectTarget = `${r2Url}/${contextDir}/${encodeURIComponent(fileName)}`;
      console.log(`[Download] Redirecting to target: ${redirectTarget}`);
      return res.redirect(redirectTarget);
    }
  }

  // Fallback to default if fetch fails
  const fallbackTarget = `${r2Url}/DivLauncher/updates/DivLauncher-Setup.exe`;
  console.log(`[Download] Falling back to default target: ${fallbackTarget}`);
  res.redirect(fallbackTarget);
}));

// GET /api-docs/swagger.json
router.get('/api-docs/swagger.json', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'swagger.json'));
});

// GET /docs - Swagger UI Documentation
router.get('/docs', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="ru">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>DivLauncher API Documentation</title>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.17.14/swagger-ui.min.css" />
        <link rel="icon" type="image/png" href="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.17.14/favicon-32x32.png" sizes="32x32" />
        <style>
          html { box-sizing: border-box; }
          *, *:before, *:after { box-sizing: inherit; }
          body { margin: 0; background: #fafafa; }
        </style>
      </head>
      <body>
        <div id="swagger-ui"></div>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.17.14/swagger-ui-bundle.min.js" charset="UTF-8"></script>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.17.14/swagger-ui-standalone-preset.min.js" charset="UTF-8"></script>
        <script>
          window.onload = () => {
            window.ui = SwaggerUIBundle({
              url: '/api-docs/swagger.json',
              dom_id: '#swagger-ui',
              deepLinking: true,
              presets: [
                SwaggerUIBundle.presets.apis,
                SwaggerUIStandalonePreset
              ],
              plugins: [
                SwaggerUIBundle.plugins.DownloadUrl
              ],
              layout: "BaseLayout"
            });
          };
        </script>
      </body>
    </html>
  `);
});

// GET /privacy - Privacy Policy Page
router.get('/privacy', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`
    <!DOCTYPE html>
    <html lang="ru">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Privacy Policy - DivLauncher</title>
      <style>
        body {
          background: #09090e;
          color: #e4e4e7;
          font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          line-height: 1.6;
          margin: 0;
          padding: 40px 20px;
          display: flex;
          justify-content: center;
        }
        .container {
          max-width: 800px;
          background: rgba(15, 15, 25, 0.6);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 20px;
          padding: 40px;
          box-shadow: 0 20px 50px rgba(0,0,0,0.5);
        }
        h1 {
          color: #10b981;
          font-size: 28px;
          margin-top: 0;
          border-bottom: 1px solid rgba(255,255,255,0.1);
          padding-bottom: 15px;
          text-transform: uppercase;
          letter-spacing: 1px;
        }
        h2 {
          color: #a78bfa;
          font-size: 20px;
          margin-top: 30px;
          border-bottom: 1px solid rgba(255,255,255,0.05);
          padding-bottom: 8px;
        }
        p, li {
          color: #a1a1aa;
          font-size: 14px;
        }
        ul {
          padding-left: 20px;
        }
        .lang-divider {
          height: 1px;
          background: rgba(255, 255, 255, 0.1);
          margin: 40px 0;
        }
        a {
          color: #34d399;
          text-decoration: none;
        }
        a:hover {
          text-decoration: underline;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <!-- ENGLISH VERSION -->
        <div class="lang-section">
          <h1>Privacy Policy</h1>
          <p>Last updated: June 30, 2026</p>
          <p>This Privacy Policy describes our policies and procedures on the collection, use, and disclosure of your information when you use DivLauncher (the "Application" or "Service"). We use your data to provide and improve the Service, verify players, and secure user accounts.</p>

          <h2>1. Information Collection and Use</h2>
          <p>While using our Service, we may ask you to provide us with certain personally identifiable information that can be used to contact or identify you. Personally identifiable information may include, but is not limited to:</p>
          <ul>
            <li><strong>Google Account Information:</strong> When you authenticate or verify your account using Google Sign-In, we collect your Google ID, email address, and profile picture.</li>
            <li><strong>Usage Customization Data:</strong> We collect details regarding your launcher profile preferences (profile background type, customized background values, skin model styles classic/slim, custom avatar pictures, and status emojis/texts).</li>
            <li><strong>Social Media Tags:</strong> If you choose to connect your social network profiles, we store Discord, Telegram, YouTube, and GitHub usernames you provide.</li>
          </ul>

          <h2>2. How We Use Your Data</h2>
          <p>We use the collected information for various purposes:</p>
          <ul>
            <li>To authorize and verify your account.</li>
            <li>To prevent unauthorized access or duplicate accounts.</li>
            <li>To display user profile customized statuses, custom avatars, custom backgrounds, and social links to other players in the launcher.</li>
            <li>To maintain the security and integrity of our game servers.</li>
          </ul>

          <h2>3. Data Protection and Storage</h2>
          <p>The security of your data is important to us. All passwords are encrypted using secure cryptographic hashing algorithms. We store your data securely in a local database and utilize secure industry-standard OAuth2 protocols to interface with Google Identity APIs. We do not sell or share your data with third parties.</p>

          <h2>4. Third-Party Services</h2>
          <p>Our Service utilizes Google OAuth2 for user verification. Google operates under its own Privacy Policy: <a href="https://policies.google.com/privacy" target="_blank">Google Privacy & Terms</a>.</p>

          <h2>5. Contact Us</h2>
          <p>If you have any questions about this Privacy Policy, you can contact us by email: support@diverlin.ru</p>
        </div>

        <div class="lang-divider"></div>

        <!-- RUSSIAN VERSION -->
        <div class="lang-section">
          <h1>Политика конфиденциальности</h1>
          <p>Последнее обновление: 30 июня 2026 г.</p>
          <p>Настоящая Политика конфиденциальности описывает наши правила и процедуры сбора, использования и раскрытия вашей информации при использовании DivLauncher («Приложение» или «Сервис»). Мы используем ваши данные для предоставления и улучшения Сервиса, верификации игроков и защиты учетных записей.</p>

          <h2>1. Сбор и использование информации</h2>
          <p>При использовании нашего Сервиса мы можем попросить вас предоставить определенную личную информацию для вашей идентификации. Личная информация может включать, помимо прочего:</p>
          <ul>
            <li><strong>Данные аккаунта Google:</strong> При авторизации или верификации через Google Sign-In мы собираем ваш Google ID, адрес электронной почты и аватар профиля.</li>
            <li><strong>Данные кастомизации:</strong> Мы собираем информацию о ваших предпочтениях профиля лаунчера (тип фонового изображения, значение кастомного фона, модель скина classic/slim, загруженный аватар, эмодзи и статус).</li>
            <li><strong>Социальные сети:</strong> Если вы решите привязать свои профили соцсетей, мы сохраняем указанные вами имена пользователей Discord, Telegram, YouTube и GitHub.</li>
          </ul>

          <h2>2. Использование ваших данных</h2>
          <p>Мы используем собранную информацию для следующих целей:</p>
          <ul>
            <li>Для авторизации и верификации вашего аккаунта.</li>
            <li>Для защиты от несанкционированного доступа и создания дубликатов аккаунтов.</li>
            <li>Для отображения вашего настроенного профиля (статус, аватар, обои и ссылки) другим игрокам в списке пользователей лаунчера.</li>
            <li>Для обеспечения безопасности и стабильной работы игровых серверов.</li>
          </ul>

          <h2>3. Защита и хранение данных</h2>
          <p>Безопасность ваших данных является приоритетом. Все пароли хэшируются с использованием надежных криптографических алгоритмов. Ваши данные надежно хранятся в базе данных авторизации. Мы используем стандартный протокол OAuth2 для интеграции с API авторизации Google. Мы не передаем и не продаем ваши личные данные третьим лицам.</p>

          <h2>4. Сторонние сервисы</h2>
          <p>Наш Сервис использует Google OAuth2 для верификации. Подробнее о политике Google: <a href="https://policies.google.com/privacy" target="_blank">Политика конфиденциальности Google</a>.</p>

          <h2>5. Обратная связь</h2>
          <p>Если у вас есть вопросы по политике конфиденциальности, вы можете связаться с нами по почте: support@diverlin.ru</p>
        </div>
      </div>
    </body>
    </html>
  `);
});

// GET /terms - Terms of Service Page
router.get('/terms', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`
    <!DOCTYPE html>
    <html lang="ru">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Terms of Service - DivLauncher</title>
      <style>
        body {
          background: #09090e;
          color: #e4e4e7;
          font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          line-height: 1.6;
          margin: 0;
          padding: 40px 20px;
          display: flex;
          justify-content: center;
        }
        .container {
          max-width: 800px;
          background: rgba(15, 15, 25, 0.6);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 20px;
          padding: 40px;
          box-shadow: 0 20px 50px rgba(0,0,0,0.5);
        }
        h1 {
          color: #a78bfa;
          font-size: 28px;
          margin-top: 0;
          border-bottom: 1px solid rgba(255,255,255,0.1);
          padding-bottom: 15px;
          text-transform: uppercase;
          letter-spacing: 1px;
        }
        h2 {
          color: #10b981;
          font-size: 20px;
          margin-top: 30px;
          border-bottom: 1px solid rgba(255,255,255,0.05);
          padding-bottom: 8px;
        }
        p, li {
          color: #a1a1aa;
          font-size: 14px;
        }
        ul {
          padding-left: 20px;
        }
        .lang-divider {
          height: 1px;
          background: rgba(255, 255, 255, 0.1);
          margin: 40px 0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <!-- ENGLISH VERSION -->
        <div class="lang-section">
          <h1>Terms of Service</h1>
          <p>Last updated: June 30, 2026</p>
          <p>Please read these Terms of Service ("Terms", "Terms of Service") carefully before using the DivLauncher application and game servers (the "Service") operated by DivLauncher ("us", "we", or "our").</p>

          <h2>1. Terms Acceptance</h2>
          <p>By accessing or using the Service, you agree to be bound by these Terms. If you disagree with any part of the terms, you may not access the Service.</p>

          <h2>2. Accounts and Security</h2>
          <p>When you create an account with us, you must provide us information that is accurate, complete, and current at all times. Failure to do so constitutes a breach of the Terms, which may result in immediate termination of your account on our Service.</p>
          <p>You are responsible for safeguarding the password that you use to access the Service. You agree not to disclose your password to any third party.</p>

          <h2>3. Profile Customization and Upload Rules</h2>
          <p>Our Service permits you to customize your profile, including uploading custom background images, GIF files, and custom avatars. You are responsible for the content you upload. You agree not to upload any materials that:</p>
          <ul>
            <li>Are unlawful, offensive, hateful, or promote violence.</li>
            <li>Infringe upon copyrights, trademarks, or personal privacy of others.</li>
            <li>Contain explicit, adult content, or inappropriate materials.</li>
          </ul>
          <p>We reserve the right to remove any custom background or avatar, and suspend accounts violating these content guidelines.</p>

          <h2>4. Fair Play and Server Rules</h2>
          <p>You agree not to use modified game clients, cheats, hacks, exploits, or third-party tools that grant unfair competitive advantages on our game servers. Violations will result in permanent account termination.</p>

          <h2>5. Limitation of Liability</h2>
          <p>In no event shall DivLauncher, nor its developers, be liable for any indirect, incidental, special, consequential, or punitive damages arising out of your access to or use of the Service.</p>
        </div>

        <div class="lang-divider"></div>

        <!-- RUSSIAN VERSION -->
        <div class="lang-section">
          <h1>Условия использования</h1>
          <p>Последнее обновление: 30 июня 2026 г.</p>
          <p>Пожалуйста, внимательно прочтите настоящие Условия использования перед использованием приложения DivLauncher и игровых серверов (вместе — «Сервис»), управляемых DivLauncher («мы», «наш»).</p>

          <h2>1. Согласие с условиями</h2>
          <p>Используя наш Сервис, вы соглашаетесь соблюдать настоящие Условия. Если вы не согласны с какой-либо частью условий, вы не имеете права использовать Сервис.</p>

          <h2>2. Учетные записи и безопасность</h2>
          <p>При создании учетной записи вы обязуетесь указывать достоверную информацию. Вы несете личную ответственность за безопасность вашего пароля. Передача доступа к аккаунту третьим лицам запрещена.</p>

          <h2>3. Правила кастомизации и загрузки контента</h2>
          <p>Наш Сервис позволяет загружать собственные изображения/GIF для фона профиля и аватары. Загружая медиафайлы, вы соглашаетесь, что они не содержат:</p>
          <ul>
            <li>Материалов, нарушающих законодательство РФ, пропагандирующих насилие или разжигающих ненависть.</li>
            <li>Нарушений авторских прав третьих лиц.</li>
            <li>Элементов эротического или откровенного содержания.</li>
          </ul>
          <p>Администрация оставляет за собой право удалить любой кастомный контент и временно или навсегда заблокировать аккаунт в случае нарушения данных правил.</p>

          <h2>4. Честная игра и правила серверов</h2>
          <p>Запрещается использовать читы, вредоносные моды, дюпы, баги игры или сторонние утилиты для получения преимуществ на серверах. Нарушение правил игры ведет к постоянной блокировке аккаунта.</p>

          <h2>5. Ограничение ответственности</h2>
          <p>Разработчики DivLauncher ни при каких обстоятельствах не несут ответственности за любые прямые или косвенные убытки, возникшие в результате использования или невозможности использования данного Сервиса.</p>
        </div>
      </div>
    </body>
    </html>
  `);
});

module.exports = router;
