// Supergateway 4 has no bind-host flag. Force all of this process's TCP
// listeners to loopback before loading its unmodified published CLI.
const net = require('node:net');
const original = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
  if (typeof args[0] === 'object' && args[0] !== null && 'port' in args[0]) {
    args[0] = { ...args[0], host: '127.0.0.1' };
  } else if (typeof args[0] === 'number' || /^\d+$/.test(String(args[0]))) {
    const cb = args.find(a => typeof a === 'function');
    args = [{ port: Number(args[0]), host: '127.0.0.1' }, ...(cb ? [cb] : [])];
  } else {
    throw new Error('Only loopback TCP listeners are permitted');
  }
  return original.apply(this, args);
};
