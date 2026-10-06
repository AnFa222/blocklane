// Use Node's HTTPS streams directly. Electron's bundled fetch/Undici parser
// can throw an uncaught assert(!this.paused) when a download socket closes.
const https = require('node:https');
const { setTimeout: sleep } = require('node:timers/promises');
const launcherVersion = require('../package.json').version;

function open(url, signal, get = https.get) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let timer;
    const request = get(url, { signal, agent: false, headers: { 'User-Agent': `Blocklane/${launcherVersion} (https://github.com/AnFa222/blocklane)`, 'Accept-Encoding': 'identity' } }, response => {
      // Keep errors handled while the caller connects its pipeline.
      response.on('error', () => {});
      response.once('close', () => clearTimeout(timer));
      resolve(response);
    });
    request.on('error', error => { clearTimeout(timer); reject(error); });
    timer = setTimeout(() => {
      const error = new Error('Download timed out.'); error.code = 'ETIMEDOUT';
      request.destroy(error);
    }, 120000);
    timer.unref();
  });
}
function httpError(status, retryAfter) {
  const error = new Error(`Download failed (HTTP ${status}). Please retry the installation.`);
  error.status = status;
  if (retryAfter != null) {
    const seconds = Number(retryAfter);
    const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(delay)) error.retryAfterMs = Math.max(0, delay);
  }
  return error;
}
async function withRetries(operation, signal, wait = sleep) {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try { return await operation(); }
    catch (error) {
      signal?.throwIfAborted();
      const transient = [408, 429, 500, 502, 503, 504].includes(error.status) ||
        ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED', 'EPIPE', 'ERR_STREAM_PREMATURE_CLOSE', 'EINTEGRITY'].includes(error.code);
      if (!transient || attempt >= 3) throw error;
      const delay = Math.max(1000 * 2 ** attempt, error.retryAfterMs || 0);
      if (delay > 300000) throw new Error('The download server requested a longer pause. Please retry later.');
      await wait(delay, undefined, { signal });
    }
  }
}
module.exports = { open, httpError, withRetries };
