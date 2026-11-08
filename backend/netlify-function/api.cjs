// Netlify Function wrapping the AgentProof Express backend (serverless-http).
// The backend's file store lives in /tmp here: writable, but only shared
// between requests that land on the same warm container. That is enough for
// a short judge demo (transfer -> verify seconds apart); a cold container
// starts with an empty action log, which the API reports honestly.
const { mkdirSync } = require('node:fs');

const DATA_DIR = process.env.AGENTPROOF_DATA_DIR || '/tmp/agentproof-data';
process.env.AGENTPROOF_DATA_DIR = DATA_DIR;
mkdirSync(DATA_DIR, { recursive: true });

const serverless = require('serverless-http');
const { createApp } = require('../dist/app.js');

module.exports.handler = serverless(createApp());
