// AFLDB-ISSUE-265 offline-check preload (NODE_OPTIONS=--require <this file>).
// Refuses every TCP connect in this process and its children and records the attempt
// (host:port only; never a connection string) in I265_NETBLOCK_LOG. Local IPC (a pipe
// path) is allowed, so vitest's own worker channels keep working. It only blocks:
// it proves that a run made NO connection attempt when the log holds no BLOCKED line.
'use strict';
const net = require('node:net');
const fs = require('node:fs');

const logFile = process.env.I265_NETBLOCK_LOG;
const note = (line) => {
  if (!logFile) return;
  try { fs.appendFileSync(logFile, `${new Date().toISOString()} pid=${process.pid} ${line}\n`); } catch { /* best effort */ }
};

const original = net.Socket.prototype.connect;
net.Socket.prototype.connect = function blockedConnect(...args) {
  // net.connect() hands Socket#connect an already-normalised [options, cb] array.
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const isPipe = (typeof first === 'string' && !/^\d+$/.test(first))
    || (first !== null && typeof first === 'object' && typeof first.path === 'string');
  if (isPipe) return original.apply(this, args);
  let target;
  if (first !== null && typeof first === 'object') target = `${first.host ?? 'localhost'}:${first.port}`;
  else target = `${typeof args[1] === 'string' ? args[1] : 'localhost'}:${first}`;
  note(`BLOCKED tcp connect ${target}`);
  const error = Object.assign(new Error(`AFLDB-ISSUE-265 offline check: TCP connect to ${target} refused`), { code: 'ECONNREFUSED' });
  process.nextTick(() => this.destroy(error));
  return this;
};
note(`preload active (${process.argv.slice(1, 2).join(' ') || 'node'})`);
