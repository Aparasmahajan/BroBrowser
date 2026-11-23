import { app, BrowserWindow, components } from 'electron';
import { MainWindow } from './window';
import { Browser } from './browser';
import { registerIpc } from './ipc';
import { buildMenu } from './menu';
import { initAutoUpdate } from './updater';

// Look like plain Chrome (as Brave does): sites such as Netflix and Google sign-in turn
// away user agents carrying "Electron/…" or an unknown app token.
app.userAgentFallback = app.userAgentFallback.replace(/ (Electron|bro-browser)\/\S+/g, '');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let mw: MainWindow | null = null;
  let browser: Browser | null = null;

  const boot = () => {
    const w = new MainWindow();
    const b = new Browser(w);
    mw = w;
    browser = b;
    registerIpc(w, b);
    buildMenu(b);
    b.shortcuts.onChange = () => buildMenu(b); // keep menu labels in sync with rebinding
    // macOS keeps running without a window; save + release hotkeys now so a
    // later re-boot starts clean.
    w.win.on('closed', () => {
      b.flush();
      if (browser === b) browser = null;
      if (mw === w) mw = null;
    });
  };

  app.on('second-instance', () => {
    if (mw) {
      if (!mw.win.isVisible()) mw.win.show(); // hidden by the boss key
      if (mw.win.isMinimized()) mw.win.restore();
      mw.win.focus();
    }
  });

  const widevine = () =>
    Promise.race([
      components.whenReady().then(
        () => undefined,
        (e: unknown) => console.warn('[bro] Widevine not available:', e),
      ),
      new Promise<void>((r) => setTimeout(r, 15_000)),
    ]);

  app.whenReady().then(async () => {
    await widevine();
    boot();
    initAutoUpdate();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) boot();
      else if (mw && !mw.win.isVisible()) mw.win.show(); // dock click after the boss key
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => {
    browser?.flush();
  });
}
