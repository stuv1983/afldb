// Proposal validation only: TCP/UDP denied; allow tsx's exact per-user local IPC directory.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const audit = process.env.ISSUE316_NETWORK_AUDIT;
const record = (event, extra = {}) => { if (audit) fs.appendFileSync(audit, JSON.stringify({ runtime: 'node', pid: process.pid, event, ...extra }) + '\n'); };
record('guard-loaded');
const original = require('node:net').Socket.prototype.connect;
require('node:net').Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const local = typeof first === 'string' ? first : first?.path;
  const ipcDir = path.join(os.tmpdir(), `tsx-${process.geteuid ? process.geteuid() : os.userInfo().username}`);
  const prefix = process.platform === 'win32' ? '\\\\?\\pipe\\' + ipcDir + path.sep : ipcDir + path.sep;
  if (typeof local === 'string' && local.startsWith(prefix) && /^\d+\.pipe$/.test(local.slice(prefix.length))) {
    record('tsx-local-ipc-permitted');
    return original.apply(this, args);
  }
  record('connection-refused', { transport: typeof local === 'string' ? 'other-local-path' : 'tcp-or-unspecified' });
  throw Error('ISSUE-316 restatement validation forbids network connections');
};
const deny = () => { record('connection-refused', { transport: 'udp' }); throw Error('ISSUE-316 restatement validation forbids network connections'); };
require('node:dgram').Socket.prototype.connect = deny;
require('node:dgram').Socket.prototype.send = deny;
