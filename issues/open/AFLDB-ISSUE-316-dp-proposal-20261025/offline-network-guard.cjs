// Validation-process instrumentation only. No product module is changed.
'use strict';
const fs = require('node:fs');
const log = process.env.ISSUE316_NETWORK_AUDIT;
const record = (event, transport) => { if (log) fs.appendFileSync(log, JSON.stringify({ runtime: 'node', pid: process.pid, event, ...(transport ? { transport } : {}) }) + '\n'); };
record('guard-loaded');
const deny = (...args) => {
  let first = args[0];
  if (Array.isArray(first)) first = first[0];
  const localPath = typeof first === 'string' ? first : first?.path;
  record('connection-refused', typeof localPath === 'string' ? 'local-path' : 'tcp-or-unspecified');
  throw Error('ISSUE-316 offline validation forbids network connections');
};
require('node:net').Socket.prototype.connect = deny;
require('node:dgram').Socket.prototype.connect = deny;
require('node:dgram').Socket.prototype.send = deny;
