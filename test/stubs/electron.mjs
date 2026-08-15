import { createRequire } from 'node:module';
const e = createRequire(import.meta.url)('./electron.cjs');

export const app = e.app;
export const BrowserWindow = e.BrowserWindow;
export const ipcMain = e.ipcMain;
export const shell = e.shell;
export const dialog = e.dialog;
export const Notification = e.Notification;
export const contextBridge = e.contextBridge;
export const ipcRenderer = e.ipcRenderer;
export const __test = e.__test;
export default e;
