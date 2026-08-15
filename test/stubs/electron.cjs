/** Electron 런타임 스텁 — 창을 띄우지 않고 메인 프로세스를 구동하기 위한 최소 구현. */
const handlers = new Map();
const sent = [];
const state = { windowOpts: null, loadedFile: null, notifications: [] };

class BrowserWindow {
  constructor(opts) {
    state.windowOpts = opts;
    this.webContents = {
      send: (ch, p) => sent.push({ ch, p }),
      setWindowOpenHandler: () => {},
    };
  }
  loadFile(f) {
    state.loadedFile = f;
  }
  static getAllWindows() {
    return [1];
  }
}

module.exports = {
  app: {
    _name: null,
    whenReady: () => Promise.resolve(),
    on() {},
    quit() {},
    setName(n) {
      this._name = n;
      state.appName = n;
    },
    getPath: () => process.env.TEST_USERDATA,
  },
  BrowserWindow,
  ipcMain: { handle: (ch, fn) => handlers.set(ch, fn) },
  shell: {
    openExternal() {},
    showItemInFolder(p) {
      state.revealed = p;
    },
  },
  dialog: {
    // 테스트가 state.pickResult 로 다음 선택 결과를 지정한다
    showOpenDialog: async () =>
      state.pickResult ?? { canceled: true, filePaths: [] },
  },
  Notification: Object.assign(
    class {
      constructor(o) {
        state.notifications.push(o);
      }
      show() {}
    },
    { isSupported: () => true },
  ),
  contextBridge: {
    exposeInMainWorld: (k, v) => {
      globalThis.__bridge = { key: k, value: v };
    },
  },
  ipcRenderer: {
    _l: [],
    invoke: async (ch, ...a) => {
      const h = handlers.get(ch);
      if (!h) throw new Error(`등록되지 않은 IPC 채널: ${ch}`);
      return h({}, ...a);
    },
    on(ch, fn) {
      this._l.push({ ch, fn });
    },
    removeListener(ch, fn) {
      this._l = this._l.filter((x) => x.fn !== fn);
    },
  },
  __test: { handlers, sent, state },
};
