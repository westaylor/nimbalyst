import type { BrowserWindow } from 'electron';
import { shell } from 'electron';

/**
 * Apply Electron's recommended renderer-navigation hardening to a window:
 *
 *   - `setWindowOpenHandler({ action: 'deny' })` -- block `window.open` and
 *     `target="_blank"`. External http(s) URLs are routed through the system
 *     browser via `shell.openExternal`; everything else is denied silently.
 *
 *   - `will-navigate` -- prevent the renderer from navigating away from the
 *     trusted origin. The initial document load is not a navigation event;
 *     allowed prefixes cover dev-server origins and local file:// loads.
 *
 * Apply to EVERY `new BrowserWindow(...)` so an injected payload in the
 * renderer cannot pivot the window to an attacker origin (which would
 * inherit the preload script and IPC surface).
 */
const ALLOWED_NAV_PREFIXES = [
  'file://',
  'http://localhost',
  'http://127.0.0.1',
  'about:blank',
];

export function applyWindowSecurityHardening(window: BrowserWindow): void {
  const wc = window.webContents;

  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  wc.on('will-navigate', (event, url) => {
    if (ALLOWED_NAV_PREFIXES.some((prefix) => url.startsWith(prefix))) {
      return;
    }
    event.preventDefault();
    if (/^https?:\/\//.test(url)) {
      void shell.openExternal(url);
    }
  });
}
