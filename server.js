const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('./db');
const { syncLuckPermsUser, syncLuckPermsGroup } = require('./luckperms');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { S3Client, ListObjectsV2Command, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const dotenvResult = require('dotenv').config({ path: path.join(__dirname, '.env') });
if (dotenvResult.error) {
  console.log('Dotenv warning: .env file not found or could not be loaded:', dotenvResult.error.message);
} else {
  console.log('Dotenv: .env loaded successfully from', path.join(__dirname, '.env'));
  console.log('Dotenv parsed PORT:', dotenvResult.parsed ? dotenvResult.parsed.PORT : 'undefined');
}
console.log('Process env PORT:', process.env.PORT);
const app = express();
app.use(cors());
app.use(express.json());

// Request logger middleware
app.use((req, res, next) => {
  console.log(`[REQUEST] ${req.method} ${req.url} - Content-Type: ${req.headers['content-type']}`);
  next();
});

// Route rewrite middleware to support Yggdrasil apiRoot paths from CustomSkinLoader
app.use((req, res, next) => {
  if (req.url.startsWith('/api/yggdrasil/sessionserver')) {
    req.url = req.url.replace('/api/yggdrasil/sessionserver', '/sessionserver');
  }
  next();
});

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Helper to handle async express routes and catch errors
const asyncHandler = fn => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// --- Direct Skin & Cape Retrieval APIs by Username ---

app.get('/api/skins/:username', asyncHandler(async (req, res) => {
  const username = req.params.username.replace(/\.png$/i, '');
  const db = await getDb();
  const user = await db.get('SELECT skin_url FROM users WHERE username = ?', [username]);

  if (!user || !user.skin_url) {
    // Redirect to default Mojang Steve skin
    return res.redirect('https://textures.minecraft.net/texture/1a65f6c2084c7e6a57564619379d71c4c82b4dfa666ee3b1a2080a424af6e8c');
  }

  const relativePath = user.skin_url.split('?')[0];
  const absolutePath = path.join(__dirname, relativePath);
  if (fs.existsSync(absolutePath)) {
    return res.sendFile(absolutePath);
  }
  res.redirect('https://textures.minecraft.net/texture/1a65f6c2084c7e6a57564619379d71c4c82b4dfa666ee3b1a2080a424af6e8c');
}));

app.get('/api/capes/:username', asyncHandler(async (req, res) => {
  const username = req.params.username.replace(/\.png$/i, '');
  const db = await getDb();
  const user = await db.get('SELECT cape_url FROM users WHERE username = ?', [username]);

  if (!user || !user.cape_url) {
    return res.status(404).send('Cape not found');
  }

  const relativePath = user.cape_url.split('?')[0];
  const absolutePath = path.join(__dirname, relativePath);
  if (fs.existsSync(absolutePath)) {
    return res.sendFile(absolutePath);
  }
  res.status(404).send('Cape file not found');
}));

// --- Swagger UI Documentation ---
app.get('/api-docs/swagger.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'swagger.json'));
});

app.get('/docs', (req, res) => {
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

app.get('/', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>DivLauncher — Next-Gen Minecraft Ecosystem</title>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800;900&display=swap');

        :root {
          --bg-color: #050508;
          --card-bg: rgba(10, 10, 16, 0.45);
          --border-color: rgba(255, 255, 255, 0.07);
          --text-main: #ffffff;
          --text-secondary: #e4e4e7;
          --text-muted: #a1a1aa;
          
          --accent-emerald: #10b981;
          --accent-emerald-hover: #34d399;
          --accent-purple: #a78bfa;
          --accent-purple-hover: #c084fc;
          --accent-purple-deep: #7c3aed;
          --accent-blue: #3b82f6;
          --accent-blue-hover: #60a5fa;
          --accent-amber: #f59e0b;
        }

        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        body {
          background: radial-gradient(circle at 50% 0%, #1a1635 0%, var(--bg-color) 80%);
          color: var(--text-main);
          font-family: 'Montserrat', sans-serif;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          overflow-x: hidden;
        }

        /* Floating blobs */
        .glow-blob {
          position: absolute;
          border-radius: 50%;
          filter: blur(100px);
          z-index: 0;
          pointer-events: none;
          opacity: 0.15;
        }

        .glow-1 {
          width: 500px;
          height: 500px;
          background: var(--accent-purple-deep);
          top: -200px;
          left: -100px;
          animation: float-slow 20s infinite alternate;
        }

        .glow-2 {
          width: 600px;
          height: 600px;
          background: var(--accent-emerald);
          top: 30%;
          right: -200px;
          animation: float-slow 25s infinite alternate-reverse;
        }

        .glow-3 {
          width: 400px;
          height: 400px;
          background: var(--accent-blue);
          bottom: -100px;
          left: 10%;
        }

        @keyframes float-slow {
          0% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(50px, 30px) scale(1.1); }
          100% { transform: translate(-30px, -50px) scale(0.9); }
        }

        header {
          padding: 24px 6%;
          display: flex;
          justify-content: space-between;
          align-items: center;
          z-index: 10;
          position: relative;
        }

        .logo-container {
          display: flex;
          align-items: center;
          gap: 12px;
          text-decoration: none;
        }

        .logo-container i {
          font-size: 28px;
          background: linear-gradient(135deg, var(--accent-emerald) 0%, var(--accent-purple) 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .logo-text {
          font-weight: 900;
          font-size: 22px;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          color: var(--text-main);
        }

        .nav-links {
          display: none;
          align-items: center;
          gap: 32px;
        }

        @media (min-width: 900px) {
          .nav-links {
            display: flex;
          }
        }

        .nav-link {
          color: var(--text-muted);
          text-decoration: none;
          font-weight: 700;
          font-size: 13px;
          text-transform: uppercase;
          letter-spacing: 1px;
          transition: color 0.3s;
        }

        .nav-link:hover {
          color: var(--text-main);
        }

        .nav-actions {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .lang-selector {
          display: flex;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid var(--border-color);
          border-radius: 30px;
          padding: 3px;
        }

        .lang-btn {
          background: none;
          border: none;
          color: var(--text-muted);
          font-family: 'Montserrat', sans-serif;
          font-weight: 800;
          font-size: 10px;
          padding: 6px 12px;
          border-radius: 20px;
          cursor: pointer;
        }

        .lang-btn.active {
          background: var(--accent-emerald);
          color: var(--bg-color);
        }

        /* Hero section */
        .hero {
          padding: 40px 6% 80px;
          display: grid;
          grid-template-columns: 1fr;
          gap: 60px;
          align-items: center;
          position: relative;
          z-index: 5;
        }

        @media (min-width: 1024px) {
          .hero {
            grid-template-columns: 1.2fr 1fr;
          }
        }

        .hero-info {
          max-width: 650px;
        }



        h1 {
          font-size: 38px;
          font-weight: 900;
          line-height: 1.15;
          margin-bottom: 20px;
          letter-spacing: -1px;
        }

        @media (min-width: 640px) {
          h1 { font-size: 54px; }
        }

        .gradient-text {
          background: linear-gradient(135deg, var(--accent-emerald) 0%, var(--accent-purple) 70%, var(--accent-blue) 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .hero-desc {
          font-size: 16px;
          line-height: 1.7;
          color: var(--text-secondary);
          margin-bottom: 40px;
        }

        .cta-container {
          display: flex;
          flex-wrap: wrap;
          gap: 16px;
        }

        .btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          text-decoration: none;
          font-weight: 800;
          font-size: 13px;
          padding: 16px 28px;
          border-radius: 12px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          cursor: pointer;
        }

        .btn:hover {
          transform: translateY(-2px);
        }

        .btn:active {
          transform: translateY(1px);
        }

        .btn-download {
          background: var(--accent-emerald);
          color: var(--bg-color);
          box-shadow: 0 0 20px rgba(16, 185, 129, 0.25);
        }

        .btn-download:hover {
          background: var(--accent-emerald-hover);
          box-shadow: 0 0 30px rgba(16, 185, 129, 0.4);
        }

        .btn-outline {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid var(--border-color);
          color: var(--text-main);
        }

        .btn-outline:hover {
          background: rgba(255, 255, 255, 0.08);
          border-color: rgba(255, 255, 255, 0.2);
        }

        /* Decorative Hero Graphic Styling */
        .decorative-hero-graphic {
          position: relative;
          width: 320px;
          height: 320px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto;
        }

        .main-shield-orb {
          width: 140px;
          height: 140px;
          background: linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(124, 58, 237, 0.15) 100%);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 54px;
          color: #ffffff;
          box-shadow: 0 0 50px rgba(16, 185, 129, 0.15), inset 0 0 20px rgba(255, 255, 255, 0.05);
          z-index: 2;
          animation: pulse-glow 4s infinite alternate;
        }

        .orbital-ring {
          position: absolute;
          border-radius: 50%;
          border: 1px dashed rgba(255, 255, 255, 0.06);
          z-index: 1;
        }

        .ring-1 {
          width: 200px;
          height: 200px;
          animation: spin-clockwise 15s linear infinite;
        }

        .ring-2 {
          width: 260px;
          height: 260px;
          border: 1px solid rgba(255, 255, 255, 0.03);
          animation: spin-counter-clockwise 22s linear infinite;
        }

        .ring-3 {
          width: 320px;
          height: 320px;
          animation: spin-clockwise 30s linear infinite;
        }

        .orbit-dot {
          position: absolute;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          top: -4px;
          left: 50%;
          transform: translateX(-50%);
        }

        .dot-emerald {
          background-color: var(--accent-emerald);
          box-shadow: 0 0 12px var(--accent-emerald);
        }

        .dot-purple {
          background-color: var(--accent-purple);
          box-shadow: 0 0 12px var(--accent-purple);
        }

        .dot-blue {
          background-color: var(--accent-blue-hover);
          box-shadow: 0 0 12px var(--accent-blue);
        }

        @keyframes pulse-glow {
          0% {
            transform: scale(0.98);
            box-shadow: 0 0 40px rgba(16, 185, 129, 0.1);
          }
          100% {
            transform: scale(1.02);
            box-shadow: 0 0 60px rgba(124, 58, 237, 0.2);
          }
        }

        @keyframes spin-clockwise {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        @keyframes spin-counter-clockwise {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(-360deg); }
        }

        /* Mockup Container (Reused as Download Card wrapper) */
        .mockup-container {
          perspective: 1000px;
          width: 100%;
          display: flex;
          justify-content: center;
        }

        /* Features Section */
        .features-section {
          padding: 80px 6%;
          position: relative;
          z-index: 5;
        }

        .section-title {
          text-align: center;
          margin-bottom: 50px;
        }

        .section-title h2 {
          font-size: 32px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 12px;
        }

        .section-title p {
          color: var(--text-muted);
          font-size: 15px;
          max-width: 600px;
          margin: 0 auto;
        }

        .features-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 30px;
        }

        @media (min-width: 768px) {
          .features-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }

        @media (min-width: 1100px) {
          .features-grid {
            grid-template-columns: repeat(3, 1fr);
          }
        }

        .feature-card {
          background: var(--card-bg);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          border: 1px solid var(--border-color);
          border-radius: 20px;
          padding: 35px;
          transition: all 0.3s;
          position: relative;
          overflow: hidden;
        }

        .feature-card:hover {
          transform: translateY(-5px);
          border-color: rgba(255, 255, 255, 0.15);
          box-shadow: 0 15px 35px rgba(0, 0, 0, 0.4);
        }

        .feature-icon-wrapper {
          width: 50px;
          height: 50px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 22px;
          margin-bottom: 24px;
        }

        .icon-emerald {
          background: rgba(16, 185, 129, 0.1);
          border: 1px solid rgba(16, 185, 129, 0.2);
          color: var(--accent-emerald);
        }

        .icon-purple {
          background: rgba(167, 139, 250, 0.1);
          border: 1px solid rgba(167, 139, 250, 0.2);
          color: var(--accent-purple);
        }

        .icon-blue {
          background: rgba(59, 130, 246, 0.1);
          border: 1px solid rgba(59, 130, 246, 0.2);
          color: var(--accent-blue);
        }

        .feature-card h3 {
          font-size: 18px;
          font-weight: 800;
          margin-bottom: 12px;
        }

        .feature-card p {
          color: var(--text-muted);
          font-size: 13px;
          line-height: 1.6;
        }

        /* Steps Section */
        .steps-section {
          padding: 60px 6% 100px;
          position: relative;
          z-index: 5;
          text-align: center;
        }

        .steps-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 30px;
          max-width: 900px;
          margin: 50px auto 0;
        }

        @media (min-width: 768px) {
          .steps-grid {
            grid-template-columns: repeat(3, 1fr);
          }
        }

        .step-card {
          position: relative;
          padding: 20px;
        }

        .step-number {
          font-size: 48px;
          font-weight: 900;
          color: rgba(255, 255, 255, 0.05);
          margin-bottom: -15px;
          line-height: 1;
        }

        .step-card h4 {
          font-size: 16px;
          font-weight: 800;
          margin-bottom: 8px;
        }

        .step-card p {
          font-size: 12px;
          color: var(--text-muted);
          line-height: 1.5;
        }

        /* Footer */
        footer {
          background: #030306;
          border-top: 1px solid var(--border-color);
          padding: 40px 6%;
          text-align: center;
          font-size: 12px;
          color: var(--text-muted);
          z-index: 10;
          position: relative;
        }

        .footer-links {
          display: flex;
          justify-content: center;
          gap: 24px;
          margin-bottom: 20px;
          flex-wrap: wrap;
        }

        .footer-link {
          color: var(--text-muted);
          text-decoration: none;
          transition: color 0.3s;
          font-weight: 600;
        }

        .footer-link:hover {
          color: var(--accent-emerald);
        }

        footer p {
          margin-bottom: 8px;
        }

        footer a {
          color: var(--text-secondary);
          text-decoration: none;
        }

        footer a:hover {
          color: var(--accent-emerald);
        }

        /* Localization styling */
        [lang-content] {
          display: none;
        }

        body.lang-en [lang-content="en"] {
          display: block;
        }

        body.lang-ru [lang-content="ru"] {
          display: block;
        }
      </style>
    </head>
    <body class="lang-en">
      <div class="glow-blob glow-1"></div>
      <div class="glow-blob glow-2"></div>
      <div class="glow-blob glow-3"></div>

      <header>
        <a href="/" class="logo-container">
          <i class="fa-solid fa-shield-halved"></i>
          <span class="logo-text">DivLauncher</span>
        </a>
        <nav class="nav-links">
          <a href="#features" class="nav-link">
            <span lang-content="en">Features</span>
            <span lang-content="ru">Возможности</span>
          </a>
          <a href="/privacy" class="nav-link">
            <span lang-content="en">Privacy</span>
            <span lang-content="ru">Конфиденциальность</span>
          </a>
          <a href="/terms" class="nav-link">
            <span lang-content="en">Terms</span>
            <span lang-content="ru">Правила</span>
          </a>
        </nav>
        <div class="nav-actions">
          <div class="lang-selector">
            <button class="lang-btn active" onclick="setLanguage('en')">EN</button>
            <button class="lang-btn" onclick="setLanguage('ru')">RU</button>
          </div>
        </div>
      </header>

      <main>
        <!-- Hero Section -->
        <section class="hero">
          <div class="hero-info">
            <h1 lang-content="en">The Ultimate <span class="gradient-text">Minecraft</span> Launcher Workspace</h1>
            <h1 lang-content="ru">Экосистема нового поколения для <span class="gradient-text">Minecraft</span></h1>

            <p class="hero-desc" lang-content="en">
              DivLauncher is a custom-branded, high-performance launcher ecosystem. Designed with glassmorphic visuals, it bundles automatic JRE resolution, clean modpack sync, integrated local server controls, automated backups, and secure Google OAuth2 login via our Yggdrasil authentication server.
            </p>
            <p class="hero-desc" lang-content="ru">
              DivLauncher — это брендируемая и высокопроизводительная экосистема лаунчера. Разработанный в стиле Glassmorphism, он объединяет автоматический подбор Java JRE, чистую синхронизацию сборок, встроенное управление серверами с бэкапами и безопасный вход по Google OAuth2.
            </p>

            <div class="cta-container">
              <a href="/download" class="btn btn-download">
                <i class="fa-solid fa-download"></i>
                <span lang-content="en">Download Launcher</span>
                <span lang-content="ru">Скачать лаунчер</span>
              </a>
              <a href="#features" class="btn btn-outline">
                <i class="fa-solid fa-circle-info"></i>
                <span lang-content="en">Learn More</span>
                <span lang-content="ru">Подробнее</span>
              </a>
            </div>
          </div>

          <div class="mockup-container">
            <!-- Decorative Shield & Orbits Graphic (Non-Functional) -->
            <div class="decorative-hero-graphic">
              <div class="orbital-ring ring-1">
                <div class="orbit-dot dot-emerald"></div>
              </div>
              <div class="orbital-ring ring-2">
                <div class="orbit-dot dot-purple"></div>
              </div>
              <div class="orbital-ring ring-3">
                <div class="orbit-dot dot-blue"></div>
              </div>
              <div class="main-shield-orb">
                <i class="fa-solid fa-shield-halved"></i>
              </div>
            </div>
          </div>
        </section>

        <!-- Features Section -->
        <section class="features-section" id="features">
          <div class="section-title">
            <h2 lang-content="en">Powerful Features</h2>
            <h2 lang-content="ru">Возможности лаунчера</h2>
            <p lang-content="en">A unified workspace offering complete control over game clients and servers.</p>
            <p lang-content="ru">Единая среда, обеспечивающая полный контроль над клиентом и игровыми серверами.</p>
          </div>

          <div class="features-grid">
            <!-- Feature 1 -->
            <div class="feature-card">
              <div class="feature-icon-wrapper icon-emerald">
                <i class="fa-solid fa-gamepad"></i>
              </div>
              <h3 lang-content="en">Modpack Sync</h3>
              <h3 lang-content="ru">Синхронизация модов</h3>
              <p lang-content="en">Supports Forge, Fabric, Quilt, and NeoForge. Automatically detects and installs the optimal Java Runtime (JRE 8, 16, 17, 21) while clean-syncing ZIP archives to eliminate conflicts.</p>
              <p lang-content="ru">Поддержка любых версий и ядер. Умный менеджер автоматически скачивает JRE (8, 16, 17, 21), а чистая синхронизация удаляет старые файлы перед установкой ZIP-обновлений.</p>
            </div>

            <!-- Feature 2 -->
            <div class="feature-card">
              <div class="feature-icon-wrapper icon-purple">
                <i class="fa-solid fa-terminal"></i>
              </div>
              <h3 lang-content="en">Server Dashboard</h3>
              <h3 lang-content="ru">Панель сервера</h3>
              <p lang-content="en">Host and launch local game servers in one-click. Includes automated world backup managers, direct mod sync between server & client, and real-time color-coded console logs.</p>
              <p lang-content="ru">Локальный запуск сервера в один клик. Включает резервное копирование миров, быструю синхронизацию модов и отслеживание консоли сервера с подсветкой событий в реальном времени.</p>
            </div>

            <!-- Feature 3 -->
            <div class="feature-card">
              <div class="feature-icon-wrapper icon-blue">
                <i class="fa-solid fa-user-shield"></i>
              </div>
              <h3 lang-content="en">Secure Yggdrasil Auth</h3>
              <h3 lang-content="ru">Безопасный Yggdrasil</h3>
              <p lang-content="en">Powered by a custom backend API enabling secure player verification via Google OAuth2, integration with LuckPerms database ranks, and strict structural PNG validation for skin/cape uploads.</p>
              <p lang-content="ru">Собственный бэкенд с Yggdrasil API для входа через Google OAuth2, автоматической синхронизацией рангов с LuckPerms и жесткой валидацией IHDR-структур скинов/плащей.</p>
            </div>
          </div>
        </section>

        <!-- Steps Section -->
        <section class="steps-section">
          <div class="section-title">
            <h2 lang-content="en">How to Start</h2>
            <h2 lang-content="ru">Быстрый старт</h2>
          </div>
          
          <div class="steps-grid">
            <div class="step-card">
              <div class="step-number">01</div>
              <h4 lang-content="en">Download</h4>
              <h4 lang-content="ru">Скачивание</h4>
              <p lang-content="en">Get the installer for your OS and install the launcher on your PC.</p>
              <p lang-content="ru">Скачайте установщик лаунчера для вашей операционной системы и запустите его.</p>
            </div>
            <div class="step-card">
              <div class="step-number">02</div>
              <h4 lang-content="en">Authenticate</h4>
              <h4 lang-content="ru">Авторизация</h4>
              <p lang-content="en">Log in securely with Google Account verification.</p>
              <p lang-content="ru">Пройдите авторизацию, используя безопасный аккаунт Google OAuth2.</p>
            </div>
            <div class="step-card">
              <div class="step-number">03</div>
              <h4 lang-content="en">Play & Host</h4>
              <h4 lang-content="ru">Игра и сервер</h4>
              <p lang-content="en">Choose your favorite modpack, launch the game, or manage your server.</p>
              <p lang-content="ru">Выберите сборку, играйте с друзьями или запустите свой локальный сервер.</p>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div class="footer-links">
          <a href="/privacy" class="footer-link">
            <span lang-content="en">Privacy Policy</span>
            <span lang-content="ru">Политика конфиденциальности</span>
          </a>
          <a href="/terms" class="footer-link">
            <span lang-content="en">Terms of Service</span>
            <span lang-content="ru">Условия использования</span>
          </a>
          <a href="/docs" class="footer-link">
            <span lang-content="en">API Docs</span>
            <span lang-content="ru">Документация</span>
          </a>
        </div>
        <p>&copy; 2026 DivLauncher. All rights reserved. | <a href="mailto:support@diverlin.ru">support@diverlin.ru</a></p>
        <p style="font-size: 10px; opacity: 0.5; margin-top: 10px;">
          This server is operated under the DivLauncher License Agreement. Minecraft is a trademark of Mojang Synergies AB.
        </p>
      </footer>

      <script>
        function setLanguage(lang) {
          document.body.className = 'lang-' + lang;
          document.querySelectorAll('.lang-btn').forEach(btn => {
            if (btn.innerText.toLowerCase() === lang) {
              btn.classList.add('active');
            } else {
              btn.classList.remove('active');
            }
          });
          localStorage.setItem('divlauncher-lang', lang);
        }

        const storedLang = localStorage.getItem('divlauncher-lang');
        if (storedLang === 'en' || storedLang === 'ru') {
          setLanguage(storedLang);
        } else {
          const userLang = navigator.language || navigator.userLanguage;
          if (userLang.startsWith('ru')) {
            setLanguage('ru');
          } else {
            setLanguage('en');
          }
        }
      </script>
    </body>
    </html>
  `);
});

app.get('/download', asyncHandler(async (req, res) => {
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
    // Fallback using native https with redirect handling
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
    const match = ymlContent.match(/path:\s*([^\s\r\n]+)/);
    if (match && match[1]) {
      let fileName = match[1];
      if (fileName.startsWith('http')) {
        console.log(`[Download] Redirecting directly to full URL: ${fileName}`);
        return res.redirect(fileName);
      }
      if (fileName.startsWith('/')) {
        fileName = fileName.substring(1);
      }
      
      // Determine the directory context based on which URL succeeded
      const contextDir = successUrl.includes('/DivLauncher/updates/') ? 'DivLauncher/updates' : 'updates';
      const redirectTarget = `${r2Url}/${contextDir}/${fileName}`;
      console.log(`[Download] Redirecting to target: ${redirectTarget}`);
      return res.redirect(redirectTarget);
    }
  }

  // Fallback to default if fetch fails
  const fallbackTarget = `${r2Url}/DivLauncher/updates/DivLauncher-Setup.exe`;
  console.log(`[Download] Falling back to default target: ${fallbackTarget}`);
  res.redirect(fallbackTarget);
}));

// Fallback for local storage if R2 is not configured
const uploadLocal = multer({ dest: 'uploads/' });
const uploadMemory = multer({ storage: multer.memoryStorage() });

// Create uploads directories if they don't exist
const uploadsDir = path.join(__dirname, 'uploads');
const skinsDir = path.join(uploadsDir, 'skins');
const capesDir = path.join(uploadsDir, 'capes');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
if (!fs.existsSync(skinsDir)) fs.mkdirSync(skinsDir);
if (!fs.existsSync(capesDir)) fs.mkdirSync(capesDir);

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-key';
if (JWT_SECRET === 'your-super-secret-key') {
  console.warn('\x1b[33m%s\x1b[0m', '[WARNING] JWT_SECRET is set to the default insecure value! Please configure JWT_SECRET in .env');
}
const SERVER_DOMAIN = 'http://localhost:3000'; // Change to actual domain in prod
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback';

// Helper: Format UUID with or without dashes
const stripUUID = (uuid) => uuid.replace(/-/g, '');

const getFullUrl = (req, url) => {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  const protocol = req.headers['x-forwarded-proto'] === 'https' || req.secure ? 'https' : 'http';
  const host = req.get('host') || 'localhost:3000';
  return `${protocol}://${host}${url}`;
};

// --- Yggdrasil API Endpoints ---

app.get(['/api/yggdrasil', '/api/yggdrasil/'], asyncHandler(async (req, res) => {
  const host = req.get('host');
  const domain = host ? host.split(':')[0] : 'localhost';
  const domains = new Set(["localhost", "127.0.0.1", "mcauth.diverlin.ru", "diverlin.ru", domain]);
  
  const db = await getDb();
  res.json({
    meta: {
      serverName: "DivLauncher Auth",
      implementationName: "divlauncher-auth",
      implementationVersion: "1.0.0"
    },
    skinDomains: Array.from(domains),
    signaturePublicKey: db.publicKey || "" // For authlib-injector signature verification
  });
}));

app.post('/authserver/authenticate', asyncHandler(async (req, res) => {
  const { username, password, clientToken = uuidv4() } = req.body;
  const db = await getDb();
  const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: "ForbiddenOperationException", errorMessage: "Invalid credentials. Invalid username or password." });
  }

  const accessToken = uuidv4();
  await db.run('UPDATE users SET access_token = ?, client_token = ? WHERE id = ?', [accessToken, clientToken, user.id]);

  res.json({
    accessToken,
    clientToken,
    availableProfiles: [{ id: stripUUID(user.uuid), name: user.username }],
    selectedProfile: { id: stripUUID(user.uuid), name: user.username }
  });
}));

app.post('/authserver/refresh', asyncHandler(async (req, res) => {
  const { accessToken, clientToken } = req.body;
  const db = await getDb();
  const user = await db.get('SELECT * FROM users WHERE access_token = ? AND client_token = ?', [accessToken, clientToken]);

  if (!user) {
    return res.status(401).json({ error: "ForbiddenOperationException", errorMessage: "Invalid token." });
  }

  const newAccessToken = uuidv4();
  await db.run('UPDATE users SET access_token = ? WHERE id = ?', [newAccessToken, user.id]);

  res.json({
    accessToken: newAccessToken,
    clientToken,
    selectedProfile: { id: stripUUID(user.uuid), name: user.username }
  });
}));

app.post('/authserver/validate', asyncHandler(async (req, res) => {
  const { accessToken, clientToken } = req.body;
  const db = await getDb();
  
  let query = 'SELECT * FROM users WHERE access_token = ?';
  let params = [accessToken];
  if (clientToken) {
    query += ' AND client_token = ?';
    params.push(clientToken);
  }

  const user = await db.get(query, params);
  if (!user) {
    return res.status(401).json({ error: "ForbiddenOperationException", errorMessage: "Invalid token." });
  }

  res.status(204).send();
}));

// --- Session Server (Minecraft Server joins) ---

app.post('/sessionserver/session/minecraft/join', asyncHandler(async (req, res) => {
  const { accessToken, selectedProfile, serverId } = req.body;
  const db = await getDb();

  // Minecraft client sends selectedProfile as UUID without dashes
  const user = await db.get("SELECT * FROM users WHERE access_token = ? AND REPLACE(uuid, '-', '') = ?", [accessToken, selectedProfile]);

  if (!user) {
    return res.status(401).json({ error: "ForbiddenOperationException", errorMessage: "Invalid token or profile." });
  }

  await db.run('UPDATE users SET server_id = ? WHERE id = ?', [serverId, user.id]);
  res.status(204).send();
}));

app.get('/sessionserver/session/minecraft/hasJoined', asyncHandler(async (req, res) => {
  const { username, serverId } = req.query;
  const db = await getDb();
  const user = await db.get('SELECT * FROM users WHERE username = ? AND server_id = ?', [username, serverId]);

  if (!user) {
    return res.status(204).send(); // Vanilla response for not joined
  }

  // Construct textures property
  const textures = {
    timestamp: Date.now(),
    profileId: stripUUID(user.uuid),
    profileName: user.username,
    textures: {}
  };

  if (user.skin_url) textures.textures.SKIN = { url: getFullUrl(req, user.skin_url) };
  if (user.cape_url) textures.textures.CAPE = { url: getFullUrl(req, user.cape_url) };

  const texturesBase64 = Buffer.from(JSON.stringify(textures)).toString('base64');
  const properties = [
    {
      name: "textures",
      value: texturesBase64
    }
  ];

  if (db.privateKey) {
    const crypto = require('crypto');
    const sign = crypto.createSign('sha1WithRSAEncryption');
    sign.update(texturesBase64);
    properties[0].signature = sign.sign(db.privateKey, 'base64');
  }

  res.json({
    id: stripUUID(user.uuid),
    name: user.username,
    properties
  });
}));

app.get('/sessionserver/session/minecraft/profile/:uuid', asyncHandler(async (req, res) => {
  const uuid = req.params.uuid;
  const db = await getDb();
  const user = await db.get("SELECT * FROM users WHERE REPLACE(uuid, '-', '') = ?", [uuid]);

  if (!user) {
    return res.status(204).send();
  }

  const textures = {
    timestamp: Date.now(),
    profileId: stripUUID(user.uuid),
    profileName: user.username,
    textures: {}
  };

  if (user.skin_url) textures.textures.SKIN = { url: getFullUrl(req, user.skin_url) };
  if (user.cape_url) textures.textures.CAPE = { url: getFullUrl(req, user.cape_url) };

  const texturesBase64 = Buffer.from(JSON.stringify(textures)).toString('base64');
  const properties = [
    {
      name: "textures",
      value: texturesBase64
    }
  ];

  if (db.privateKey) {
    const crypto = require('crypto');
    const sign = crypto.createSign('sha1WithRSAEncryption');
    sign.update(texturesBase64);
    properties[0].signature = sign.sign(db.privateKey, 'base64');
  }

  res.json({
    id: stripUUID(user.uuid),
    name: user.username,
    properties
  });
}));

// --- Web Frontend API ---

app.post('/api/register', asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  const db = await getDb();

  try {
    const hash = await bcrypt.hash(password, 10);
    const newUuid = uuidv4();
    await db.run('INSERT INTO users (username, uuid, password) VALUES (?, ?, ?)', [username, newUuid, hash]);
    res.json({ message: 'User created' });
  } catch (err) {
    res.status(400).json({ error: 'Username may already exist' });
  }
}));

app.post('/api/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  const db = await getDb();

  const user = await db.get(`
    SELECT *
    FROM users
    WHERE username = ?
  `, [username]);

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ id: user.id, username: user.username, uuid: user.uuid, is_admin: user.is_admin }, JWT_SECRET, { expiresIn: '7d' });
  
  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      uuid: user.uuid,
      skin_url: user.skin_url,
      cape_url: user.cape_url,
      is_admin: user.is_admin,
      badge: user.badge,
      bio: user.bio,
      google_email: user.google_email,
      profile_bg_type: user.profile_bg_type || 'preset',
      profile_bg_value: user.profile_bg_value || 'preset-1',
      skin_model: user.skin_model || 'classic',
      avatar_type: user.avatar_type || 'minecraft',
      avatar_url: user.avatar_url,
      social_discord: user.social_discord,
      social_telegram: user.social_telegram,
      social_youtube: user.social_youtube,
      social_github: user.social_github,
      status_emoji: user.status_emoji,
      status_text: user.status_text,
      avatar_border_color: user.avatar_border_color || '#a78bfa',
      current_activity: user.current_activity || 'online',
      current_game: user.current_game || null
    }
  });
}));

app.get('/api/profile', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send();
  const token = authHeader.split(' ')[1];
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const db = await getDb();
    
    const { uuid } = req.query;
    let user;
    if (uuid) {
      // Match UUID ignoring dashes (standardize format between Yggdrasil/Launcher and database)
      user = await db.get(`
        SELECT id, username, uuid, skin_url, cape_url, is_admin, badge, bio, google_email,
               profile_bg_type, profile_bg_value, skin_model, avatar_type, avatar_url,
               social_discord, social_telegram, social_youtube, social_github,
               status_emoji, status_text, avatar_border_color, current_activity, current_game
        FROM users
        WHERE REPLACE(uuid, '-', '') = REPLACE(?, '-', '')
      `, [uuid]);
    } else {
      user = await db.get(`
        SELECT id, username, uuid, skin_url, cape_url, is_admin, badge, bio, google_email,
               profile_bg_type, profile_bg_value, skin_model, avatar_type, avatar_url,
               social_discord, social_telegram, social_youtube, social_github,
               status_emoji, status_text, avatar_border_color, current_activity, current_game
        FROM users
        WHERE id = ?
      `, [decoded.id]);
    }

    if (!user) return res.status(404).send();

    res.json(user);
  } catch (err) {
    res.status(401).send();
  }
}));

app.post('/api/profile/password', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send();
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword || newPassword.length < 4) {
      return res.status(400).json({ error: 'InvalidPassword', errorMessage: 'Пароль должен быть не менее 4 символов' });
    }

    const db = await getDb();
    const user = await db.get('SELECT * FROM users WHERE id = ?', [decoded.id]);
    if (!user) {
      return res.status(404).json({ error: 'UserNotFound', errorMessage: 'Пользователь не найден' });
    }

    const match = await bcrypt.compare(oldPassword, user.password);
    if (!match) {
      return res.status(400).json({ error: 'IncorrectOldPassword', errorMessage: 'Неверный текущий пароль' });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await db.run('UPDATE users SET password = ? WHERE id = ?', [hash, decoded.id]);
    res.json({ message: 'Пароль успешно изменен' });
  } catch (err) {
    res.status(401).send();
  }
}));

app.post('/api/profile/bio', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send();
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { bio } = req.body;
    const db = await getDb();
    await db.run('UPDATE users SET bio = ? WHERE id = ?', [bio === '' || bio === null ? null : bio, decoded.id]);
    res.json({ message: 'Статус успешно обновлен', bio: bio || null });
  } catch (err) {
    res.status(401).send();
  }
}));

// --- GOOGLE OAUTH ENDPOINTS ---

app.get('/api/auth/google', (req, res) => {
  const { port, action, token } = req.query;
  if (!port) return res.status(400).send('Missing local port');
  
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return res.status(500).send('Google Authentication is not configured on the server.');
  }

  // Create state variable containing action, port, and token if linking
  const stateObj = { port, action: action || 'login', token: token || null };
  const state = Buffer.from(JSON.stringify(stateObj)).toString('base64');

  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?` + 
    `client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}` + 
    `&redirect_uri=${encodeURIComponent(GOOGLE_REDIRECT_URI)}` + 
    `&response_type=code` + 
    `&scope=openid%20profile%20email` + 
    `&state=${state}` + 
    `&prompt=select_account`;

  res.redirect(googleAuthUrl);
});

app.get('/api/auth/google/callback', asyncHandler(async (req, res) => {
  const { code, state, error } = req.query;
  const crypto = require('crypto');
  
  // Extract port from state to redirect errors to loopback server
  let port = 3000;
  let action = 'login';
  let token = null;
  
  if (state) {
    try {
      const stateObj = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
      port = stateObj.port;
      action = stateObj.action || 'login';
      token = stateObj.token;
    } catch (e) {
      console.error('Failed to parse state:', e);
    }
  }

  if (error) {
    return res.redirect(`http://localhost:${port}/auth-callback?status=error&error=${encodeURIComponent(error)}`);
  }
  if (!code) {
    return res.redirect(`http://localhost:${port}/auth-callback?status=error&error=Missing%20authorization%20code`);
  }

  try {
    // 1. Exchange authorization code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code'
      })
    });

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      throw new Error(`Failed to exchange code: ${errText}`);
    }

    const tokenData = await tokenResponse.json();
    const googleAccessToken = tokenData.access_token;

    // 2. Fetch Google profile
    const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${googleAccessToken}` }
    });

    if (!profileResponse.ok) {
      throw new Error('Failed to fetch user profile from Google');
    }

    const googleUser = await profileResponse.json();
    const googleId = googleUser.sub;
    const googleEmail = googleUser.email;
    const googleName = googleUser.name;

    const db = await getDb();

    if (action === 'link') {
      // LINKING GOOGLE TO EXISTING USER
      if (!token) {
        return res.redirect(`http://localhost:${port}/auth-callback?status=error&error=Missing%20auth%20token`);
      }
      let decoded;
      try {
        decoded = jwt.verify(token, JWT_SECRET);
      } catch (jwtErr) {
        return res.redirect(`http://localhost:${port}/auth-callback?status=error&error=Invalid%20or%20expired%20session`);
      }

      // Check if this Google ID is already linked
      const existingLink = await db.get('SELECT id, username FROM users WHERE google_id = ?', [googleId]);
      if (existingLink && existingLink.id !== decoded.id) {
        return res.redirect(`http://localhost:${port}/auth-callback?status=error&error=This%20Google%20account%20is%20already%20linked%20to%20player%20${existingLink.username}`);
      }

      await db.run('UPDATE users SET google_id = ?, google_email = ? WHERE id = ?', [googleId, googleEmail, decoded.id]);
      return res.redirect(`http://localhost:${port}/auth-callback?status=success&action=link&email=${encodeURIComponent(googleEmail)}`);
    } else {
      // LOGIN / REGISTRATION WITH GOOGLE
      let user = await db.get('SELECT * FROM users WHERE google_id = ?', [googleId]);

      if (!user) {
        // Check if a user with this email already exists
        user = await db.get('SELECT * FROM users WHERE google_email = ?', [googleEmail]);
        if (user) {
          // Auto-link Google ID to existing user
          await db.run('UPDATE users SET google_id = ? WHERE id = ?', [googleId, user.id]);
        } else {
          // Register a new user
          // Base username on google email or name, strip special characters
          let username = (googleName || googleEmail.split('@')[0]).replace(/[^a-zA-Z0-9_]/g, '');
          if (username.length < 3) username = `GoogleUser_${crypto.randomBytes(3).toString('hex')}`;
          
          // Ensure username uniqueness
          let usernameCheck = await db.get('SELECT id FROM users WHERE username = ?', [username]);
          while (usernameCheck) {
            username = `${username}_${crypto.randomBytes(2).toString('hex')}`;
            usernameCheck = await db.get('SELECT id FROM users WHERE username = ?', [username]);
          }

          const userUuid = crypto.randomUUID().replace(/-/g, '');
          const randomPassword = crypto.randomBytes(16).toString('hex');
          const hashedPassword = await bcrypt.hash(randomPassword, 10);

          const result = await db.run(
            `INSERT INTO users (username, uuid, password, google_id, google_email) VALUES (?, ?, ?, ?, ?)`,
            [username, userUuid, hashedPassword, googleId, googleEmail]
          );

          user = await db.get('SELECT * FROM users WHERE id = ?', [result.lastID]);
        }
      }

      // Generate credentials
      const token = jwt.sign({ id: user.id, username: user.username, uuid: user.uuid, is_admin: user.is_admin }, JWT_SECRET, { expiresIn: '7d' });
      const clientToken = crypto.randomUUID().replace(/-/g, '');
      const yggdrasilAccessToken = crypto.randomUUID().replace(/-/g, '');
      
      await db.run('UPDATE users SET access_token = ?, client_token = ? WHERE id = ?', [yggdrasilAccessToken, clientToken, user.id]);

      return res.redirect(`http://localhost:${port}/auth-callback?status=success` + 
        `&action=login` +
        `&token=${token}` +
        `&accessToken=${yggdrasilAccessToken}` +
        `&clientToken=${clientToken}` +
        `&username=${encodeURIComponent(user.username)}` +
        `&uuid=${user.uuid}` +
        `&id=${user.id}` +
        `&is_admin=${user.is_admin}` +
        `&badge=${user.badge || ''}`);
    }
  } catch (err) {
    console.error('Google OAuth callback error:', err);
    return res.redirect(`http://localhost:${port}/auth-callback?status=error&error=${encodeURIComponent(err.message)}`);
  }
}));

app.post('/api/profile/google/unlink', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send();
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const db = await getDb();
    await db.run('UPDATE users SET google_id = NULL, google_email = NULL WHERE id = ?', [decoded.id]);
    res.json({ message: 'Google account unlinked successfully' });
  } catch (err) {
    res.status(401).send();
  }
}));

// --- PROFILE CUSTOMIZATION ENDPOINTS ---

app.post('/api/profile/customize', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send();
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const updates = req.body;
    const db = await getDb();

    const allowedFields = [
      'profile_bg_type', 'profile_bg_value', 'skin_model', 'avatar_type',
      'status_emoji', 'status_text', 'bio', 'avatar_border_color',
      'current_activity', 'current_game'
    ];

    const fieldsToSet = [];
    const params = [];

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        fieldsToSet.push(`${field} = ?`);
        params.push(updates[field] === '' ? null : updates[field]);
      }
    }

    if (fieldsToSet.length > 0) {
      params.push(decoded.id);
      await db.run(`UPDATE users SET ${fieldsToSet.join(', ')} WHERE id = ?`, params);
    }

    const updatedUser = await db.get(`
      SELECT profile_bg_type, profile_bg_value, skin_model, avatar_type, avatar_url,
             status_emoji, status_text, bio, google_email, avatar_border_color,
             current_activity, current_game
      FROM users WHERE id = ?
    `, [decoded.id]);

    res.json({ message: 'Profile updated successfully', user: updatedUser });
  } catch (err) {
    res.status(401).send();
  }
}));

app.post('/api/profile/background', (req, res, next) => {
  uploadMemory.single('background')(req, res, (err) => {
    if (err) return next(err);
    next();
  });
}, asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send();
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!req.file) {
      return res.status(400).json({ error: 'NoFile', errorMessage: 'Не передан файл фона' });
    }

    if (req.file.size > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'TooLarge', errorMessage: 'Файл слишком большой (макс. 5 МБ)' });
    }

    const allowedMime = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif'];
    if (!allowedMime.includes(req.file.mimetype)) {
      return res.status(400).json({ error: 'InvalidType', errorMessage: 'Разрешены только файлы PNG, JPG, JPEG или GIF' });
    }

    const ext = req.file.mimetype.split('/')[1] === 'jpeg' ? 'jpg' : req.file.mimetype.split('/')[1];
    const targetDir = path.join(__dirname, 'uploads', 'backgrounds');
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const files = fs.readdirSync(targetDir);
    for (const file of files) {
      if (file.startsWith(`${decoded.id}.`)) {
        try { fs.unlinkSync(path.join(targetDir, file)); } catch (e) {}
      }
    }

    const fileName = `${decoded.id}.${ext}`;
    const targetPath = path.join(targetDir, fileName);
    fs.writeFileSync(targetPath, req.file.buffer);

    const bgUrl = `/uploads/backgrounds/${fileName}?v=${Date.now()}`;
    const db = await getDb();
    await db.run('UPDATE users SET profile_bg_type = ?, profile_bg_value = ? WHERE id = ?', ['custom', bgUrl, decoded.id]);

    res.json({ message: 'Background uploaded successfully', profile_bg_value: bgUrl });
  } catch (err) {
    res.status(401).send();
  }
}));

app.post('/api/profile/avatar', (req, res, next) => {
  uploadMemory.single('avatar')(req, res, (err) => {
    if (err) return next(err);
    next();
  });
}, asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send();
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!req.file) {
      return res.status(400).json({ error: 'NoFile', errorMessage: 'Не передан файл аватарки' });
    }

    if (req.file.size > 2 * 1024 * 1024) {
      return res.status(400).json({ error: 'TooLarge', errorMessage: 'Файл слишком большой (макс. 2 МБ)' });
    }

    const allowedMime = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif'];
    if (!allowedMime.includes(req.file.mimetype)) {
      return res.status(400).json({ error: 'InvalidType', errorMessage: 'Разрешены только файлы PNG, JPG, JPEG или GIF' });
    }

    const ext = req.file.mimetype.split('/')[1] === 'jpeg' ? 'jpg' : req.file.mimetype.split('/')[1];
    const targetDir = path.join(__dirname, 'uploads', 'avatars');
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const files = fs.readdirSync(targetDir);
    for (const file of files) {
      if (file.startsWith(`${decoded.id}.`)) {
        try { fs.unlinkSync(path.join(targetDir, file)); } catch (e) {}
      }
    }

    const fileName = `${decoded.id}.${ext}`;
    const targetPath = path.join(targetDir, fileName);
    fs.writeFileSync(targetPath, req.file.buffer);

    const avatarUrl = `/uploads/avatars/${fileName}?v=${Date.now()}`;
    const db = await getDb();
    await db.run('UPDATE users SET avatar_type = ?, avatar_url = ? WHERE id = ?', ['custom', avatarUrl, decoded.id]);

    res.json({ message: 'Avatar uploaded successfully', avatar_url: avatarUrl });
  } catch (err) {
    res.status(401).send();
  }
}));

app.get('/api/users', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send();
  const token = authHeader.split(' ')[1];
  try {
    jwt.verify(token, JWT_SECRET);
    const db = await getDb();
    const users = await db.all(`
      SELECT id, username, uuid, skin_url, cape_url, is_admin, badge, bio,
             profile_bg_type, profile_bg_value, skin_model, avatar_type, avatar_url,
             status_emoji, status_text, avatar_border_color, current_activity, current_game
      FROM users
    `);

    res.json(users);
  } catch (err) {
    res.status(401).send();
  }
}));

function validateMinecraftPng(buffer, isCape = false) {
  if (!buffer || buffer.length < 24) {
    return { valid: false, error: 'Файл поврежден или слишком мал' };
  }
  // Check PNG signature: 89 50 4E 47 0D 0A 1A 0A
  const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47 &&
                buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A;
  if (!isPng) {
    return { valid: false, error: 'Файл не является корректным PNG-изображением' };
  }
  // Check IHDR chunk type
  const chunkType = buffer.toString('ascii', 12, 16);
  if (chunkType !== 'IHDR') {
    return { valid: false, error: 'Неверный формат PNG (отсутствует IHDR)' };
  }
  const width = buffer.readInt32BE(16);
  const height = buffer.readInt32BE(20);

  if (width <= 0 || height <= 0) {
    return { valid: false, error: 'Некорректные размеры изображения' };
  }

  if (isCape) {
    // Cape dimensions validation (normally 64x32 or ratios of it like 2:1)
    if (width % 64 !== 0 || height % 32 !== 0 || (width / height !== 2)) {
      return { valid: false, error: `Неверные размеры плаща (${width}x${height}). Отношение сторон должно быть 2:1 (например, 64x32)` };
    }
  } else {
    // Skin dimensions validation
    // Standard skin is 64x64 (ratio 1:1) or 64x32 (ratio 2:1)
    const ratio = width / height;
    if (ratio !== 1 && ratio !== 2) {
      return { valid: false, error: `Неверные пропорции скина (${width}x${height}). Соотношение сторон должно быть 1:1 или 2:1 (например, 64x64 или 64x32)` };
    }
    if (width % 64 !== 0) {
      return { valid: false, error: `Некорректное разрешение скина (${width}x${height}). Разрешение должно быть кратно 64 (например, 64x64, 128x128 и т.д.)` };
    }
  }

  return { valid: true, width, height };
}

app.post('/api/profile/skin', (req, res, next) => {
  console.log('[BACKEND] /api/profile/skin: Multer parsing starting...');
  uploadMemory.single('skin')(req, res, (err) => {
    console.log('[BACKEND] /api/profile/skin: Multer parsing finished. Error:', err || 'none');
    if (err) return next(err);
    next();
  });
}, asyncHandler(async (req, res) => {
  console.log('[BACKEND] /api/profile/skin: Main handler starting...');
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    if (!res.destroyed && !res.headersSent) {
      res.status(400).send();
    }
    return;
  }
  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log('[BACKEND] /api/profile/skin: Token decoded successfully, user id:', decoded.id);
    if (!req.file) {
      if (!res.destroyed && !res.headersSent) {
        res.status(400).json({ error: 'NoFile', errorMessage: 'Не передан файл скина' });
      }
      return;
    }

    // 1. File size check (max 500 KB)
    if (req.file.size > 500 * 1024) {
      if (!res.destroyed && !res.headersSent) {
        res.status(400).json({ error: 'TooLarge', errorMessage: 'Скин слишком большого размера (лимит 500 КБ)' });
      }
      return;
    }

    // 2. MIME type check
    if (req.file.mimetype !== 'image/png') {
      if (!res.destroyed && !res.headersSent) {
        res.status(400).json({ error: 'InvalidType', errorMessage: 'Разрешены только файлы PNG' });
      }
      return;
    }

    // 3. Size/Ratio validation
    const valResult = validateMinecraftPng(req.file.buffer, false);
    if (!valResult.valid) {
      if (!res.destroyed && !res.headersSent) {
        res.status(400).json({ error: 'InvalidDimensions', errorMessage: valResult.error });
      }
      return;
    }

    const targetDir = path.join(__dirname, 'uploads', 'skins');
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const targetPath = path.join(targetDir, `${decoded.id}.png`);
    fs.writeFileSync(targetPath, req.file.buffer);
    console.log('[BACKEND] /api/profile/skin: File written to disk:', targetPath);

    const skinUrl = `/uploads/skins/${decoded.id}.png?v=${Date.now()}`;

    const db = await getDb();
    await db.run('UPDATE users SET skin_url = ? WHERE id = ?', [skinUrl, decoded.id]);
    console.log('[BACKEND] /api/profile/skin: DB updated with skinUrl:', skinUrl);
    
    if (!res.destroyed && !res.headersSent) {
      res.json({ message: 'Skin updated', skin_url: skinUrl });
    }
  } catch (err) {
    console.error('Skin upload error:', err);
    if (!res.destroyed && !res.headersSent) {
      res.status(500).json({ error: 'UploadFailed', errorMessage: err.message });
    }
  }
}));

app.post('/api/profile/cape', (req, res, next) => {
  console.log('[BACKEND] /api/profile/cape: Multer parsing starting...');
  uploadMemory.single('cape')(req, res, (err) => {
    console.log('[BACKEND] /api/profile/cape: Multer parsing finished. Error:', err || 'none');
    if (err) return next(err);
    next();
  });
}, asyncHandler(async (req, res) => {
  console.log('[BACKEND] /api/profile/cape: Main handler starting...');
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    if (!res.destroyed && !res.headersSent) {
      res.status(400).send();
    }
    return;
  }
  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log('[BACKEND] /api/profile/cape: Token decoded successfully, user id:', decoded.id);
    if (!req.file) {
      if (!res.destroyed && !res.headersSent) {
        res.status(400).json({ error: 'NoFile', errorMessage: 'Не передан файл плаща' });
      }
      return;
    }

    // 1. File size check (max 100 KB)
    if (req.file.size > 100 * 1024) {
      if (!res.destroyed && !res.headersSent) {
        res.status(400).json({ error: 'TooLarge', errorMessage: 'Плащ слишком большого размера (лимит 100 КБ)' });
      }
      return;
    }

    // 2. MIME type check
    if (req.file.mimetype !== 'image/png') {
      if (!res.destroyed && !res.headersSent) {
        res.status(400).json({ error: 'InvalidType', errorMessage: 'Разрешены только файлы PNG' });
      }
      return;
    }

    // 3. Size/Ratio validation
    const valResult = validateMinecraftPng(req.file.buffer, true);
    if (!valResult.valid) {
      if (!res.destroyed && !res.headersSent) {
        res.status(400).json({ error: 'InvalidDimensions', errorMessage: valResult.error });
      }
      return;
    }

    const targetDir = path.join(__dirname, 'uploads', 'capes');
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const targetPath = path.join(targetDir, `${decoded.id}.png`);
    fs.writeFileSync(targetPath, req.file.buffer);
    console.log('[BACKEND] /api/profile/cape: File written to disk:', targetPath);

    const capeUrl = `/uploads/capes/${decoded.id}.png?v=${Date.now()}`;

    const db = await getDb();
    await db.run('UPDATE users SET cape_url = ? WHERE id = ?', [capeUrl, decoded.id]);
    console.log('[BACKEND] /api/profile/cape: DB updated with capeUrl:', capeUrl);
    
    if (!res.destroyed && !res.headersSent) {
      res.json({ message: 'Cape updated', cape_url: capeUrl });
    }
  } catch (err) {
    console.error(err);
    if (!res.destroyed && !res.headersSent) {
      res.status(500).json({ error: 'UploadFailed', errorMessage: err.message });
    }
  }
}));

app.get('/api/admin/users', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send();
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const db = await getDb();
    const currentUser = await db.get('SELECT is_admin FROM users WHERE id = ?', [decoded.id]);
    if (!currentUser || !currentUser.is_admin) return res.status(403).json({ error: 'Not an admin' });
    
    const users = await db.all('SELECT id, username, uuid, skin_url, cape_url, is_admin, badge FROM users');
    res.json(users);
  } catch (err) {
    res.status(401).send();
  }
}));

app.delete('/api/admin/users/:id', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send();
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const db = await getDb();
    const currentUser = await db.get('SELECT is_admin FROM users WHERE id = ?', [decoded.id]);
    if (!currentUser || !currentUser.is_admin) return res.status(403).json({ error: 'Not an admin' });
    
    // Prevent deleting oneself
    if (parseInt(req.params.id) === decoded.id) {
        return res.status(400).json({ error: 'Cannot delete yourself' });
    }
    await db.run('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(401).send();
  }
}));

app.put('/api/admin/users/:id', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send();
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const db = await getDb();
    const currentUser = await db.get('SELECT is_admin FROM users WHERE id = ?', [decoded.id]);
    if (!currentUser || !currentUser.is_admin) return res.status(403).json({ error: 'Not an admin' });

    const { is_admin, badge, bio } = req.body;
    
    // Prevent demoting yourself to avoid losing admin access
    if (parseInt(req.params.id) === decoded.id && is_admin !== undefined && parseInt(is_admin) === 0) {
      return res.status(400).json({ error: 'Cannot demote yourself' });
    }

    const updates = [];
    const params = [];
    if (is_admin !== undefined) {
      updates.push('is_admin = ?');
      params.push(is_admin ? 1 : 0);
    }
    if (badge !== undefined) {
      updates.push('badge = ?');
      params.push(badge === '' || badge === null ? null : badge);
    }
    if (bio !== undefined) {
      updates.push('bio = ?');
      params.push(bio === '' || bio === null ? null : bio);
    }

    if (updates.length > 0) {
      params.push(req.params.id);
      await db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

      // If badge was updated, sync it with LuckPerms MySQL database in real time
      if (badge !== undefined) {
        const updatedUser = await db.get('SELECT username, uuid, badge FROM users WHERE id = ?', [req.params.id]);
        if (updatedUser) {
          await syncLuckPermsUser(updatedUser.uuid, updatedUser.username, updatedUser.badge);
        }
      }
    }

    res.json({ message: 'User updated successfully' });
  } catch (err) {
    console.error('Error updating user in admin panel:', err);
    res.status(401).send();
  }
}));

app.post('/api/admin/promote/:id', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send();
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const db = await getDb();
    const currentUser = await db.get('SELECT is_admin FROM users WHERE id = ?', [decoded.id]);
    if (!currentUser || !currentUser.is_admin) return res.status(403).json({ error: 'Not an admin' });
    
    await db.run('UPDATE users SET is_admin = 1 WHERE id = ?', [req.params.id]);
    res.json({ message: 'User promoted to admin' });
  } catch (err) {
    res.status(401).send();
  }
}));

// --- Custom Badge Management APIs ---

app.get('/api/badges', asyncHandler(async (req, res) => {
  const db = await getDb();
  const badges = await db.all('SELECT * FROM badges ORDER BY code ASC');
  res.json(badges);
}));

app.post('/api/admin/badges', requireAdmin, asyncHandler(async (req, res) => {
  const { code, text, gradient_start, gradient_end, border_color, lp_group, lp_prefix, lp_priority } = req.body;
  if (!code || !text || !gradient_start || !gradient_end || !border_color) {
    return res.status(400).json({ error: 'MissingRequiredFields', errorMessage: 'Missing required badge fields' });
  }
  const cleanCode = code.toUpperCase().trim();
  const db = await getDb();
  try {
    const result = await db.run(
      `INSERT INTO badges (code, text, gradient_start, gradient_end, border_color, lp_group, lp_prefix, lp_priority)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [cleanCode, text.trim(), gradient_start.trim(), gradient_end.trim(), border_color.trim(), lp_group ? lp_group.trim() : null, lp_prefix ? lp_prefix.trim() : null, lp_priority ? parseInt(lp_priority, 10) : 80]
    );
    
    if (lp_group) {
      await syncLuckPermsGroup(lp_group, lp_prefix, lp_priority);
    }
    
    const newBadge = await db.get('SELECT * FROM badges WHERE id = ?', [result.lastID]);
    res.status(201).json(newBadge);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'BadgeExists', errorMessage: 'A badge with this code already exists' });
    }
    throw err;
  }
}));

app.put('/api/admin/badges/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { code, text, gradient_start, gradient_end, border_color, lp_group, lp_prefix, lp_priority } = req.body;
  if (!code || !text || !gradient_start || !gradient_end || !border_color) {
    return res.status(400).json({ error: 'MissingRequiredFields', errorMessage: 'Missing required badge fields' });
  }
  const cleanCode = code.toUpperCase().trim();
  const db = await getDb();
  
  const oldBadge = await db.get('SELECT code, lp_group FROM badges WHERE id = ?', [req.params.id]);
  if (!oldBadge) {
    return res.status(404).json({ error: 'BadgeNotFound', errorMessage: 'Badge not found' });
  }
  
  try {
    await db.run(
      `UPDATE badges 
       SET code = ?, text = ?, gradient_start = ?, gradient_end = ?, border_color = ?, lp_group = ?, lp_prefix = ?, lp_priority = ?
       WHERE id = ?`,
      [cleanCode, text.trim(), gradient_start.trim(), gradient_end.trim(), border_color.trim(), lp_group ? lp_group.trim() : null, lp_prefix ? lp_prefix.trim() : null, lp_priority ? parseInt(lp_priority, 10) : 80, req.params.id]
    );
    
    // If the code changed, cascade the update to the users table
    if (oldBadge.code !== cleanCode) {
      await db.run('UPDATE users SET badge = ? WHERE UPPER(badge) = ?', [cleanCode, oldBadge.code]);
    }
    
    // Sync to LuckPerms if LP group specified
    if (lp_group) {
      await syncLuckPermsGroup(lp_group, lp_prefix, lp_priority);
    }
    
    const updatedBadge = await db.get('SELECT * FROM badges WHERE id = ?', [req.params.id]);
    res.json(updatedBadge);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'BadgeExists', errorMessage: 'A badge with this code already exists' });
    }
    throw err;
  }
}));

app.delete('/api/admin/badges/:id', requireAdmin, asyncHandler(async (req, res) => {
  const db = await getDb();
  const badge = await db.get('SELECT code FROM badges WHERE id = ?', [req.params.id]);
  if (!badge) {
    return res.status(404).json({ error: 'BadgeNotFound', errorMessage: 'Badge not found' });
  }
  
  // 1. Find all users with this badge
  const usersToSync = await db.all('SELECT username, uuid FROM users WHERE UPPER(badge) = ?', [badge.code]);
  
  // 2. Clear badge for all users
  await db.run('UPDATE users SET badge = NULL WHERE UPPER(badge) = ?', [badge.code]);
  
  // 3. Delete badge from database
  await db.run('DELETE FROM badges WHERE id = ?', [req.params.id]);
  
  // 4. Sync updated users to LuckPerms so their groups are removed
  for (const u of usersToSync) {
    await syncLuckPermsUser(u.uuid, u.username, null);
  }
  
  res.json({ message: 'Badge deleted successfully and users updated' });
}));

// --- In-Game Statistics & Badges Sync API (Server-Only) ---

const verifyServerToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const configuredToken = process.env.SERVER_TOKEN || 'SuperSecretSyncToken123';

  if (!authHeader) {
    return res.status(401).json({ error: 'Unauthorized', errorMessage: 'Missing authorization header' });
  }

  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;

  if (token !== configuredToken) {
    return res.status(403).json({ error: 'Forbidden', errorMessage: 'Invalid server token' });
  }

  next();
};



app.post('/api/server/award-badge', verifyServerToken, asyncHandler(async (req, res) => {
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

// --- R2 Client: divlauncher-skins (скины/плащи, существующий) ---
let r2Client = null;
function getR2Client() {
  if (!r2Client) {
    r2Client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
      }
    });
  }
  return r2Client;
}

// --- R2 Client: minecraft (сборки, моды, mods.json) ---
let r2ModsClient = null;
function getR2ModsClient() {
  if (!r2ModsClient) {
    const accountId = process.env.R2_MODS_ACCOUNT_ID || process.env.R2_ACCOUNT_ID;
    const accessKey = process.env.R2_MODS_ACCESS_KEY_ID;
    const secretKey = process.env.R2_MODS_SECRET_ACCESS_KEY;
    if (!accessKey || accessKey.startsWith('ЗАМЕНИТЕ')) {
      console.warn('[R2 Mods] R2_MODS_ACCESS_KEY_ID не задан в .env — используем основные credentials');
    }
    r2ModsClient = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: (accessKey && !accessKey.startsWith('ЗАМЕНИТЕ')) ? accessKey : process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: (secretKey && !secretKey.startsWith('ЗАМЕНИТЕ')) ? secretKey : process.env.R2_SECRET_ACCESS_KEY
      }
    });
  }
  return r2ModsClient;
}

const R2_BUCKET = process.env.R2_BUCKET_NAME || 'minecraft';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://mc.diverlin.ru';

// Mods bucket constants (may differ from skin bucket)
const R2_MODS_BUCKET = process.env.R2_MODS_BUCKET_NAME || 'minecraft';
const R2_MODS_PUBLIC_URL = process.env.R2_MODS_PUBLIC_URL || 'https://mc.diverlin.ru';

// Middleware: check admin JWT
async function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const db = await getDb();
    const user = await db.get('SELECT is_admin FROM users WHERE id = ?', [decoded.id]);
    if (!user || !user.is_admin) return res.status(403).json({ error: 'Forbidden' });
    req.adminId = decoded.id;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Helper: stream to buffer
async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// --- Admin R2 Routes (bucket: minecraft) ---

// GET /api/admin/r2/list?prefix=DivLauncher/stalker/mods/
app.get('/api/admin/r2/list', requireAdmin, asyncHandler(async (req, res) => {
  const { prefix = '' } = req.query;
  console.log(`[R2 list] bucket=${R2_MODS_BUCKET} prefix="${prefix}"`);
  const s3 = getR2ModsClient();
  const cmd = new ListObjectsV2Command({
    Bucket: R2_MODS_BUCKET,
    Prefix: prefix,
    Delimiter: '/'
  });
  const data = await s3.send(cmd);
  console.log(`[R2 list] Contents=${data.Contents?.length || 0} Prefixes=${data.CommonPrefixes?.length || 0}`);
  const files = (data.Contents || [])
    .filter(obj => obj.Key !== prefix)
    .map(obj => ({
      key: obj.Key,
      name: obj.Key.replace(prefix, ''),
      size: obj.Size,
      lastModified: obj.LastModified,
      url: `${R2_MODS_PUBLIC_URL}/${obj.Key}`
    }));
  const folders = (data.CommonPrefixes || []).map(cp => ({
    key: cp.Prefix,
    name: cp.Prefix.replace(prefix, '').replace('/', ''),
    isFolder: true
  }));
  res.json({ files, folders, prefix });
}));

// POST /api/admin/r2/upload?key=DivLauncher/stalker/mods/mymod.jar
const uploadR2Memory = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });
app.post('/api/admin/r2/upload', requireAdmin, (req, res, next) => {
  uploadR2Memory.single('file')(req, res, (err) => {
    if (err) return next(err);
    next();
  });
}, asyncHandler(async (req, res) => {
  const { key } = req.query;
  if (!key) return res.status(400).json({ error: 'Missing key query param' });
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  console.log(`[R2 upload] bucket=${R2_MODS_BUCKET} key="${key}" size=${req.file.size}`);
  const s3 = getR2ModsClient();
  const upload = new Upload({
    client: s3,
    params: {
      Bucket: R2_MODS_BUCKET,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype || 'application/octet-stream'
    }
  });
  await upload.done();
  res.json({ success: true, key, url: `${R2_MODS_PUBLIC_URL}/${key}` });
}));

// DELETE /api/admin/r2/delete?key=DivLauncher/stalker/mods/mymod.jar
app.delete('/api/admin/r2/delete', requireAdmin, asyncHandler(async (req, res) => {
  const { key } = req.query;
  if (!key) return res.status(400).json({ error: 'Missing key query param' });
  console.log(`[R2 delete] bucket=${R2_MODS_BUCKET} key="${key}"`);
  const s3 = getR2ModsClient();
  await s3.send(new DeleteObjectCommand({ Bucket: R2_MODS_BUCKET, Key: key }));
  res.json({ success: true, key });
}));

// GET /api/admin/r2/mods-json?key=DivLauncher/stalker/mods.json
app.get('/api/admin/r2/mods-json', requireAdmin, asyncHandler(async (req, res) => {
  const { key } = req.query;
  if (!key) return res.status(400).json({ error: 'Missing key' });
  console.log(`[R2 mods-json GET] bucket=${R2_MODS_BUCKET} key="${key}"`);
  const s3 = getR2ModsClient();
  try {
    const cmd = new GetObjectCommand({ Bucket: R2_MODS_BUCKET, Key: key });
    const data = await s3.send(cmd);
    const buf = await streamToBuffer(data.Body);
    console.log(`[R2 mods-json GET] success, bytes=${buf.length}`);
    res.setHeader('Content-Type', 'application/json');
    res.send(buf);
  } catch (err) {
    console.error(`[R2 mods-json GET] error: ${err.name} - ${err.message}`);
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
      res.json([]);
    } else {
      res.status(500).json({ error: err.name, message: err.message });
    }
  }
}));

// PUT /api/admin/r2/mods-json?key=DivLauncher/stalker/mods.json
app.put('/api/admin/r2/mods-json', requireAdmin, asyncHandler(async (req, res) => {
  const { key } = req.query;
  if (!key) return res.status(400).json({ error: 'Missing key' });
  const content = typeof req.body === 'string' ? req.body : JSON.stringify(req.body, null, 2);
  console.log(`[R2 mods-json PUT] bucket=${R2_MODS_BUCKET} key="${key}" bytes=${content.length}`);
  const s3 = getR2ModsClient();
  await s3.send(new PutObjectCommand({
    Bucket: R2_MODS_BUCKET,
    Key: key,
    Body: content,
    ContentType: 'application/json'
  }));
  res.json({ success: true, key, url: `${R2_MODS_PUBLIC_URL}/${key}` });
}));

// GET /privacy - Privacy Policy Page (bilingual RU/EN)
app.get('/privacy', (req, res) => {
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

// GET /terms - Terms of Service Page (bilingual RU/EN)
app.get('/terms', (req, res) => {
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

// Global error handler middleware
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  if (!res.destroyed && !res.headersSent) {
    res.status(500).json({ error: 'InternalServerError', errorMessage: err.message || 'An unexpected error occurred.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Auth server running on port ${PORT}`);
  try {
    const { initializeLuckPermsDB } = require('./luckperms');
    await initializeLuckPermsDB();
  } catch (err) {
    console.error('Failed to initialize LuckPerms database on startup:', err);
  }
});
