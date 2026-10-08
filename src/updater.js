const https = require('node:https');
const CURRENT = require('../package.json').version;
const API = 'https://api.github.com/repos/AnFa222/blocklane/releases/latest';
const RELEASES_API = 'https://api.github.com/repos/AnFa222/blocklane/releases?per_page=20';

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': `Blocklane/${CURRENT}`, Accept: 'application/vnd.github+json' } }, res => {
      const chunks = []; let bytes = 0;
      res.on('data', chunk => { bytes += chunk.length; if (bytes <= 2 * 1024 * 1024) chunks.push(chunk); });
      res.on('error', reject);
      res.on('end', () => { if (res.statusCode !== 200) return reject(new Error(`GitHub update check failed (HTTP ${res.statusCode}).`)); try { resolve(JSON.parse(Buffer.concat(chunks))); } catch { reject(new Error('GitHub returned invalid release data.')); } });
    });
    req.setTimeout(15000, () => req.destroy(new Error('GitHub update check timed out.')));
    req.on('error', reject);
  });
}
function versionParts(value) { const match = String(value || '').replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/); return match ? match.slice(1).map(Number) : [0, 0, 0]; }
function newer(a, b) {
  const x = versionParts(a), y = versionParts(b);
  for (let i = 0; i < 3; i += 1) {
    if (x[i] !== y[i]) return x[i] > y[i];
  }
  return false;
}
async function check(channel = 'stable') { let release; if (channel === 'stable') release = await requestJson(API); else { const releases = await requestJson(RELEASES_API); release = releases.find(item => !item.draft && (channel === 'development' || item.prerelease)) || releases.find(item => !item.draft); } if (!release) throw new Error('No release is available for this update channel.'); const latest = String(release.tag_name || '').replace(/^v/i, ''); const installer = (release.assets || []).find(asset => /Blocklane-.*-Setup\.exe$/i.test(asset.name)); return { current: CURRENT, latest, available: newer(latest, CURRENT), name: release.name || `Blocklane ${latest}`, notes: String(release.body || '').slice(0, 4000), releaseUrl: release.html_url, installerUrl: installer?.browser_download_url || null, publishedAt: release.published_at || null }; }
module.exports = { API, RELEASES_API, check, newer, versionParts };
