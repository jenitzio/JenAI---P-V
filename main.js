// JenAI - V & P desktop shell (Electron 22 = last version supporting Windows 7).
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

if (process.platform === 'linux') app.commandLine.appendSwitch('no-sandbox'); // AppImage cannot use SUID sandbox
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

let win = null;

// Only one JenAI - V & P window at a time; a second launch focuses the first.
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

function create() {
  win = new BrowserWindow({
    width: 1500, height: 920, minWidth: 1080, minHeight: 660,
    backgroundColor: '#0b0c0f', title: 'JenAI - V & P', show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // Keep rendering/recording at full speed while exporting in the background.
      backgroundThrottling: false,
      spellcheck: false
    }
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => win.show());
  // Dropped files must never navigate the window away from the editor.
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // F11 fullscreen, Ctrl+Shift+I devtools.
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (input.control && input.shift && input.key.toLowerCase() === 'i') { win.webContents.toggleDevTools(); e.preventDefault(); }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.on('closed', () => { win = null; });
}

app.whenReady().then(create);
app.on('window-all-closed', () => app.quit());
