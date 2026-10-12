// JenAI - V & P desktop shell.
// Electron 22 = last release supporting Windows 7. Runs on Node 16 – no global fetch.
// Real local generation is done by stable-diffusion.cpp (sd-cli), built in CI and
// shipped in resources/bin. Models are downloaded on first use into userData/models.
'use strict';
const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { spawn } = require('child_process');

if (process.platform === 'linux') app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

const HF = 'https://huggingface.co';
// ---------------------------------------------------------------------------
// Model catalogue (image + video only). URLs can be overridden in Settings.
// ---------------------------------------------------------------------------
const FILES = {
  'klein-q2': { name: 'flux-2-klein-4b-Q2_K.gguf', size: 1.49e9, url: `${HF}/adithya-balaji/FLUX.2-klein-4B-GGUF/resolve/main/flux-2-klein-4b-Q2_K.gguf` },
  'klein-q4': { name: 'flux-2-klein-4b-Q4_K.gguf', size: 2.29e9, url: `${HF}/adithya-balaji/FLUX.2-klein-4B-GGUF/resolve/main/flux-2-klein-4b-Q4_K.gguf` },
  'flux2-vae': { name: 'flux2-vae.safetensors', size: 0.34e9, url: `${HF}/Comfy-Org/flux2-dev/resolve/main/split_files/vae/flux2-vae.safetensors` },
  'qwen3-4b': { name: 'Qwen3-4B-Q4_K_M.gguf', size: 2.5e9, url: `${HF}/unsloth/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf` },
  'wan-1.3b': { name: 'wan2.1_t2v_1.3B_fp16.safetensors', size: 2.84e9, url: `${HF}/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_t2v_1.3B_fp16.safetensors` },
  'wan-vae': { name: 'wan_2.1_vae.safetensors', size: 0.25e9, url: `${HF}/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors` },
  'umt5-q4': { name: 'umt5-xxl-encoder-Q4_K_M.gguf', size: 3.66e9, url: `${HF}/city96/umt5-xxl-encoder-gguf/resolve/main/umt5-xxl-encoder-Q4_K_M.gguf` }
};
const MODELS = {
  'flux2-klein-q2': { kind: 'image', label: 'FLUX.2 Klein 4B · Q2_K (smallest)', files: ['klein-q2', 'flux2-vae', 'qwen3-4b'] },
  'flux2-klein-q4': { kind: 'image', label: 'FLUX.2 Klein 4B · Q4_K (balanced)', files: ['klein-q4', 'flux2-vae', 'qwen3-4b'] },
  'wan21-1.3b': { kind: 'video', label: 'Wan 2.1 T2V 1.3B', files: ['wan-1.3b', 'wan-vae', 'umt5-q4'] }
};

let win = null;
let job = null; // running sd-cli process
const downloads = new Map(); // fileKey -> { req, cancelled }

const dataDir = () => path.join(app.getPath('userData'));
const settingsPath = () => path.join(dataDir(), 'settings.json');
function loadSettings() {
  const def = { modelDir: path.join(dataDir(), 'models'), outDir: path.join(app.getPath('pictures'), 'JenAI'), threads: Math.max(1, os.cpus().length - 1), urls: {} };
  try { return Object.assign(def, JSON.parse(fs.readFileSync(settingsPath(), 'utf8'))); } catch { return def; }
}
function saveSettings(s) { fs.mkdirSync(dataDir(), { recursive: true }); fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2)); }
let settings;

const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };
const filePath = key => path.join(settings.modelDir, FILES[key].name);
const fileUrl = key => settings.urls[key] || FILES[key].url;
const fileReady = key => { try { return fs.statSync(filePath(key)).size > 1e6; } catch { return false; } };

function modelStatus() {
  return Object.entries(MODELS).map(([id, m]) => ({
    id, kind: m.kind, label: m.label,
    files: m.files.map(k => ({ key: k, name: FILES[k].name, size: FILES[k].size, url: fileUrl(k), ready: fileReady(k), downloading: downloads.has(k) })),
    ready: m.files.every(fileReady)
  }));
}

// ---------------------------------------------------------------------------
// Resumable downloader with redirect support (HF redirects to a CDN).
// ---------------------------------------------------------------------------
function download(key) {
  if (downloads.has(key) || fileReady(key)) return Promise.resolve();
  fs.mkdirSync(settings.modelDir, { recursive: true });
  const dest = filePath(key), part = dest + '.part';
  const state = { req: null, cancelled: false };
  downloads.set(key, state);
  return new Promise((resolve, reject) => {
    const get = (url, hops) => {
      if (hops > 8) return fail(new Error('Too many redirects'));
      const have = fs.existsSync(part) ? fs.statSync(part).size : 0;
      const req = https.get(url, { headers: { 'User-Agent': 'JenAI-VP', ...(have ? { Range: `bytes=${have}-` } : {}) } }, res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) { res.resume(); return get(new URL(res.headers.location, url).toString(), hops + 1); }
        if (res.statusCode === 416) { res.resume(); fs.renameSync(part, dest); return done(); }
        if (res.statusCode !== 200 && res.statusCode !== 206) { res.resume(); return fail(new Error(`HTTP ${res.statusCode} for ${FILES[key].name}`)); }
        const append = res.statusCode === 206;
        const total = (append ? have : 0) + Number(res.headers['content-length'] || 0);
        let got = append ? have : 0, last = 0;
        const out = fs.createWriteStream(part, { flags: append ? 'a' : 'w' });
        res.on('data', c => {
          got += c.length;
          const now = Date.now();
          if (now - last > 250) { last = now; send('download-progress', { key, got, total }); }
        });
        res.pipe(out);
        out.on('finish', () => {
          if (state.cancelled) return fail(new Error('Cancelled'));
          if (total && got < total) return fail(new Error('Connection dropped – press download again to resume'));
          fs.renameSync(part, dest); done();
        });
        res.on('error', fail);
      });
      state.req = req;
      req.on('error', fail);
    };
    const done = () => { downloads.delete(key); send('download-progress', { key, done: true }); resolve(); };
    const fail = e => { downloads.delete(key); send('download-progress', { key, error: e.message }); reject(e); };
    get(fileUrl(key), 0);
  });
}

// ---------------------------------------------------------------------------
// Engine binary resolution: try AVX2 build, fall back to AVX build on SIGILL.
// ---------------------------------------------------------------------------
function binDir() { return app.isPackaged ? path.join(process.resourcesPath, 'bin') : path.join(__dirname, 'bin'); }
function engineCandidates() {
  const ext = process.platform === 'win32' ? '.exe' : '';
  return ['sd-cli-avx2', 'sd-cli-avx', 'sd-cli', 'sd'].map(n => path.join(binDir(), n + ext)).filter(p => fs.existsSync(p));
}
const isIllegalInstruction = (code, sig) => sig === 'SIGILL' || code === 3221225501 || code === -1073741795 || code === 132;

function runEngine(args, cwd) {
  const bins = engineCandidates();
  if (!bins.length) return Promise.reject(new Error('Engine binary missing. Reinstall the app (expected in resources/bin).'));
  const tryBin = i => new Promise((resolve, reject) => {
    const bin = bins[i];
    if (process.platform !== 'win32') { try { fs.chmodSync(bin, 0o755); } catch {} }
    send('gen-log', `▶ ${path.basename(bin)} ${args.map(a => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}\n`);
    const p = spawn(bin, args, { cwd, windowsHide: true });
    job = p;
    let tail = '';
    const onData = d => {
      const s = d.toString();
      tail = (tail + s).slice(-4000);
      send('gen-log', s);
      const m = s.match(/(\d+)\/(\d+)\s*-\s*[\d.]+(?:s\/it|it\/s)/g);
      if (m) { const [a, b] = m[m.length - 1].match(/(\d+)\/(\d+)/).slice(1).map(Number); send('gen-progress', { step: a, steps: b }); }
      if (/loading tensors|load .* using/i.test(s)) send('gen-progress', { phase: 'Loading model' });
      if (/decod/i.test(s)) send('gen-progress', { phase: 'Decoding' });
    };
    p.stdout.on('data', onData); p.stderr.on('data', onData);
    p.on('error', reject);
    p.on('close', (code, sig) => {
      job = null;
      if (code === 0) return resolve();
      if (isIllegalInstruction(code, sig) && i + 1 < bins.length) { send('gen-log', '\nCPU lacks AVX2 – retrying with compatibility engine…\n'); return resolve(tryBin(i + 1)); }
      if (sig === 'SIGTERM' || sig === 'SIGKILL' || p.killedByUser) return reject(new Error('Cancelled'));
      const hint = /out of memory|bad_alloc|failed to allocate/i.test(tail) ? ' (not enough RAM – try a smaller resolution or the Q2 model)' : '';
      reject(new Error(`Engine exited with code ${code}${hint}`));
    });
  });
  return tryBin(0);
}

async function generate(opts) {
  const m = MODELS[opts.model];
  if (!m) throw new Error('Unknown model');
  for (const k of m.files) if (!fileReady(k)) throw new Error(`Model file missing: ${FILES[k].name}. Download it in the Models tab.`);
  fs.mkdirSync(settings.outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const seed = Number.isFinite(opts.seed) && opts.seed >= 0 ? Math.floor(opts.seed) : Math.floor(Math.random() * 2 ** 31);
  const W = String(Math.round((opts.width || 512) / 16) * 16), H = String(Math.round((opts.height || 512) / 16) * 16);
  const common = ['-p', opts.prompt, '-W', W, '-H', H, '-s', String(seed), '-t', String(settings.threads), '--sampling-method', 'euler', '-v'];
  if (opts.negative) common.push('-n', opts.negative);
  let out, args;
  if (m.kind === 'image') {
    out = path.join(settings.outDir, `image-${stamp}.png`);
    args = ['--diffusion-model', filePath(m.files[0]), '--vae', filePath('flux2-vae'), '--llm', filePath('qwen3-4b'),
      ...common, '--cfg-scale', '1.0', '--steps', String(opts.steps || 4), '--diffusion-fa', '--vae-tiling', '-o', out];
    if (opts.refImage && fs.existsSync(opts.refImage)) args.push('-r', opts.refImage);
  } else {
    out = path.join(settings.outDir, `video-${stamp}.avi`);
    const frames = String(Math.max(5, Math.round(((opts.frames || 33) - 1) / 4) * 4 + 1)); // Wan needs 4n+1 frames
    args = ['-M', 'vid_gen', '--diffusion-model', filePath('wan-1.3b'), '--vae', filePath('wan-vae'), '--t5xxl', filePath('umt5-q4'),
      ...common, '--cfg-scale', String(opts.cfg || 6), '--steps', String(opts.steps || 20), '--video-frames', frames,
      '--flow-shift', '3.0', '--diffusion-fa', '--vae-tiling', '-o', out];
  }
  const before = new Set(fs.readdirSync(settings.outDir));
  const t0 = Date.now();
  await runEngine(args, settings.outDir);
  if (!fs.existsSync(out)) { // engine may pick its own extension
    const fresh = fs.readdirSync(settings.outDir).filter(f => !before.has(f)).map(f => path.join(settings.outDir, f));
    if (!fresh.length) throw new Error('Engine finished but produced no file');
    out = fresh[0];
  }
  return { file: out, seed, kind: m.kind, seconds: (Date.now() - t0) / 1000 };
}

// ---------------------------------------------------------------------------
ipcMain.handle('models:list', () => modelStatus());
ipcMain.handle('models:download', async (_e, id) => { for (const k of MODELS[id].files) await download(k); return modelStatus(); });
ipcMain.handle('models:cancel', (_e, id) => {
  for (const k of MODELS[id].files) { const d = downloads.get(k); if (d) { d.cancelled = true; d.req && d.req.destroy(new Error('Cancelled')); } }
  return true;
});
ipcMain.handle('models:delete', (_e, id) => {
  const shared = new Set(Object.entries(MODELS).filter(([o]) => o !== id).flatMap(([, m]) => m.files));
  for (const k of MODELS[id].files) if (!shared.has(k)) { try { fs.unlinkSync(filePath(k)); } catch {} }
  return modelStatus();
});
ipcMain.handle('gen:run', (_e, opts) => generate(opts));
ipcMain.handle('gen:cancel', () => { if (job) { job.killedByUser = true; job.kill(); } return true; });
ipcMain.handle('file:read', (_e, p) => fs.readFileSync(p));
ipcMain.handle('file:reveal', (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('file:saveBuffer', async (_e, { name, data }) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(settings.outDir, name) });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, Buffer.from(data)); return r.filePath;
});
ipcMain.handle('file:pickImage', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('file:pickDir', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('gallery:list', () => {
  try {
    return fs.readdirSync(settings.outDir).filter(f => /\.(png|jpe?g|webp|avi|webm|mp4)$/i.test(f))
      .map(f => { const p = path.join(settings.outDir, f); return { file: p, name: f, mtime: fs.statSync(p).mtimeMs }; })
      .sort((a, b) => b.mtime - a.mtime).slice(0, 200);
  } catch { return []; }
});
ipcMain.handle('settings:get', () => ({ ...settings, cpus: os.cpus().length, ramGB: Math.round(os.totalmem() / 1073741824), platform: `${os.type()} ${os.release()}`, engine: engineCandidates().map(p => path.basename(p)), version: app.getVersion() }));
ipcMain.handle('settings:set', (_e, s) => { settings = Object.assign(settings, s); saveSettings(settings); return settings; });

// ---------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

function create() {
  settings = loadSettings();
  win = new BrowserWindow({
    width: 1500, height: 920, minWidth: 1080, minHeight: 660,
    backgroundColor: '#0d0e10', title: 'JenAI - V & P', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false, spellcheck: false }
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => win.show());
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (input.control && input.shift && input.key.toLowerCase() === 'i') { win.webContents.toggleDevTools(); e.preventDefault(); }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.on('closed', () => { win = null; });
}

app.whenReady().then(create);
app.on('window-all-closed', () => { if (job) job.kill(); for (const d of downloads.values()) d.req && d.req.destroy(); app.quit(); });
