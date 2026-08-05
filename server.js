const express = require('express');
const cors = require('cors');
const path = require('path');
const { uploadsDir } = require('./config');

const pagesRouter = require('./routes/pages');
const yggdrasilRouter = require('./routes/yggdrasil');
const authRouter = require('./routes/auth');
const profileRouter = require('./routes/profile');
const skinsRouter = require('./routes/skins');
const adminRouter = require('./routes/admin');
const badgesRouter = require('./routes/badges');

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

// Static uploaded files serving
app.use('/uploads', express.static(uploadsDir));

// Mount Modular Routes
app.use(pagesRouter);
app.use(yggdrasilRouter);
app.use(authRouter);
app.use(profileRouter);
app.use(skinsRouter);
app.use(adminRouter);
app.use(badgesRouter);

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
