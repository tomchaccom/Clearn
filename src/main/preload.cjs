const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld('api', {
  settings: { get: invoke('settings:get'), set: invoke('settings:set') },
  onboarding: { complete: invoke('onboarding:complete') },
  ladder: invoke('meta:ladder'),
  narrowRequest: invoke('meta:narrowRequest'),
  health: invoke('health:check'),
  abort: invoke('agent:abort'),

  session: {
    list: invoke('session:list'),
    get: invoke('session:get'),
    create: invoke('session:create'),
    hint: invoke('session:hint'),
    send: invoke('session:send'),
  },

  data: { info: invoke('data:info'), backup: invoke('data:backup'), reveal: invoke('data:reveal') },

  project: {
    pick: invoke('project:pick'),
  },

  obsidian: {
    check: invoke('obsidian:check'),
    pick: invoke('obsidian:pick'),
    export: invoke('obsidian:export'),
    exportSession: invoke('obsidian:exportSession'),
    reveal: invoke('obsidian:reveal'),
    buildDag: invoke('obsidian:buildDag'),
    buildConceptNote: invoke('obsidian:buildConceptNote'),
  },

  explain: { grade: invoke('explain:grade'), list: invoke('explain:list') },

  cards: {
    generate: invoke('cards:generate'),
    due: invoke('cards:due'),
    all: invoke('cards:all'),
    answer: invoke('cards:answer'),
    delete: invoke('cards:delete'),
  },

  stats: { get: invoke('stats:get'), coach: invoke('stats:coach') },
  forgetting: { status: invoke('forgetting:status') },
  claude: { version: invoke('claude:version') },
  usage: { reset: invoke('usage:reset') },

  onDelta: (cb) => {
    const fn = (_e, payload) => cb(payload);
    ipcRenderer.on('stream:delta', fn);
    return () => ipcRenderer.removeListener('stream:delta', fn);
  },
});
