const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const asyncHandler = require('../utils/asyncHandler');
const { stripUUID, getFullUrl } = require('../utils/totp');
const router = express.Router();

// Yggdrasil Auth Server Metadata
router.get(['/api/yggdrasil', '/api/yggdrasil/'], asyncHandler(async (req, res) => {
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
    signaturePublicKey: db.publicKey || ""
  });
}));

// Authenticate
router.post('/authserver/authenticate', asyncHandler(async (req, res) => {
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

// Refresh
router.post('/authserver/refresh', asyncHandler(async (req, res) => {
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

// Validate
router.post('/authserver/validate', asyncHandler(async (req, res) => {
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

// Join Server
router.post('/sessionserver/session/minecraft/join', asyncHandler(async (req, res) => {
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

// Has Joined Check
router.get('/sessionserver/session/minecraft/hasJoined', asyncHandler(async (req, res) => {
  const { username, serverId } = req.query;
  const db = await getDb();
  const user = await db.get('SELECT * FROM users WHERE username = ? AND server_id = ?', [username, serverId]);

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

// Profile by UUID
router.get('/sessionserver/session/minecraft/profile/:uuid', asyncHandler(async (req, res) => {
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

module.exports = router;
