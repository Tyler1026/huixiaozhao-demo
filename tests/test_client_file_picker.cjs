'use strict';

// These are lifecycle tests against the actual client functions with a DOM double.
// They do not reproduce native WebKit file dialogs or prove a garbage-collection cause.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const base = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(base, file), 'utf8');
const tail = read('frontend/index/script-02-sections/14-tail.js');
const auth = read('frontend/index/script-02-sections/03.js');
const layout = read('frontend/index/script-02-sections/05.js');
function between(text, start, end) {
  const a = text.indexOf(start), b = text.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `actual function boundaries: ${start}`);
  return text.slice(a, b);
}
const implementation = [
  between(tail, 'var OWNED_FILE_PICKER=', '/* 编辑框附件上传'),
  between(tail, 'function editPickFile(', 'function editDropFile('),
  between(tail, 'function processEditFiles(', 'var kbEditSession='),
  between(tail, 'function kbEditorAuthorization(', 'function kbEditorChanged('),
  between(tail, 'function kbCancelEdit(', 'function kbKeepEditing('),
  between(tail, 'function pickLocalFile(', '/* ── 文件摄取'),
  between(tail, 'function doUpload(){', 'function uploadParsed('),
  between(auth, 'function _authResetView(){', 'function _authAccept('),
  between(layout, 'function render(){', '/* 顶栏角色切换按钮')
].join('\n');

function setup() {
  const nodes = new Map(), created = [], clicks = [], ingested = [], timers = [], events = [];
  const listeners = new Map();
  function element(tag = 'div') {
    let value = '', files = [];
    const classes = new Set();
    const node = {
      tagName: tag.toUpperCase(), children: [], parentNode: null, style: {}, attributes: {},
      classList: {
        add: name => classes.add(name), remove: name => classes.delete(name),
        toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }
      },
      setAttribute(name, data) { this.attributes[name] = data; },
      removeAttribute(name) { delete this.attributes[name]; },
      appendChild(child) {
        if (child.parentNode) child.parentNode.removeChild(child);
        this.children.push(child); child.parentNode = this;
        if (child.id) nodes.set(child.id, child);
        return child;
      },
      removeChild(child) {
        assert.ok(this.children.includes(child), 'removeChild must target a mounted node');
        this.children = this.children.filter(item => item !== child); child.parentNode = null;
        if (child.id) nodes.delete(child.id);
        events.push('remove:' + child.tagName);
        return child;
      },
      remove() { if (this.parentNode) this.parentNode.removeChild(this); },
      querySelector() { return null; },
      focus() { document.activeElement = this; },
      click() {
        clicks.push(this);
        assert.equal(this.type, 'file');
        assert.ok(this.parentNode, 'file input is mounted before native activation');
        assert.equal(this.parentNode.parentNode, document.body, 'picker host is attached to body');
        assert.equal(c.OWNED_FILE_PICKER.input, this, 'pending picker has a strong owner');
        assert.equal(this.parentNode.style.display, undefined);
        assert.doesNotMatch(this.parentNode.style.cssText, /display\s*:\s*none/i);
      }
    };
    Object.defineProperties(node, {
      files: { get() { events.push('read-files'); return files; }, set(list) { files = list; } },
      value: { get() { return value; }, set(next) { value = next; if (next === '') { events.push('clear-files'); files = []; } } },
      innerHTML: { get() { return this._html || ''; }, set(html) {
        this.children.slice().forEach(child => this.removeChild(child)); this._html = html;
      } }
    });
    created.push(node); return node;
  }
  const document = {createElement: element, getElementById: id => nodes.get(id) || null,
    querySelector: () => null, activeElement: null, body: null};
  document.body = element('body');
  const root = element(); root.id = 'root'; document.body.appendChild(root);
  const project = {topic: 'industry', kb: [{t: 'materials', known: []}]};
  const c = {
    console, Array, Object, String, Number, Math, Date, Promise, document,
    cur: 'a', view: 'knowledge', role: 'user', _authEpoch: 1, _authState: 'ready',
    AUTH: {user: 'owner', scope: 'project', role: 'owner', projKey: 'a', projectKeys: ['a', 'b']}, PROJECTS: {a: project}, RESET_GEN: 'fixture-generation',
    REPORTSTATE: {}, REPORT_HISTORY: {}, _scrollMemory: {key: 'a', tops: {}},
    _renderedScrollKey: 'a', detailOpen: false,
    localStorage: {removeItem() {}},
    originalUploadEpoch: () => c._authEpoch,
    originalUploadSessionCurrent: epoch => epoch === c._authEpoch,
    P: () => c.PROJECTS[c.cur],
    ingestFiles(files, topic) { ingested.push({files, topic, key: c.cur}); return Promise.resolve([]); },
    setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {},
    closeModal() {}, closeKbDetail() {}, kbEditorChanged() {}, toast() {},
    kbEditorHasChanges: () => false,
    _authWorkspaceOf: key => key, switchAuthWorkspace: key => { c.switchedWorkspace = key; },
    _captureChainExplorer: () => null, _restoreChainExplorer() {},
    _captureScroll() {}, _restoreScroll() {}, _viewScrollKey: () => c.cur,
    topbar: () => '<header></header>', sidebar: () => '', mainPane: () => '',
    detailPane: () => '', progressFooter: () => '', bind() {}, kbChatReplay() {},
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
    removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).filter(item => item !== fn)); },
    $: selector => selector === '#root' ? root : null
  };
  c.window = c; vm.createContext(c); vm.runInContext(implementation, c);
  c.render._routed = true; c.render._serverSynced = true;
  c.kbEditSession = {key: 'a', epoch: 1, authorization: c.kbEditorAuthorization(), resetGen: c.RESET_GEN, kbIdx: 0, itemIdx: 0, segmentVersion: 1,
    project, topic: project.kb[0], obscured: []};
  function open(name) { c[name](...(name === 'editPickFile' ? [0, 0] : name === 'pickLocalFile' ? [0] : [])); return c.OWNED_FILE_PICKER.input; }
  function drain() { while (timers.length) timers.shift()(); }
  function fire(type) { (listeners.get(type) || []).slice().forEach(fn => fn()); }
  return {c, document, root, created, clicks, ingested, timers, events, listeners, open, drain, fire};
}

const entries = ['pickLocalFile', 'doUpload', 'editPickFile'];
for (const name of entries) {
  test(`${name}: keeps the activated input mounted and owned`, () => {
    const h = setup(), input = h.open(name), host = h.c.OWNED_FILE_PICKER_HOST;
    assert.equal(h.clicks.length, 1); assert.equal(input.parentNode, host);
    assert.equal(host.id, 'clientFilePickerHost'); assert.equal(input.multiple, true);
    assert.equal(input.accept, '.pdf,.docx,.txt,.md,.csv,.json');
    assert.equal(input.tabIndex, -1); assert.equal(host.parentNode, h.document.body);
    assert.notEqual(host, h.root); assert.equal(h.c.OWNED_FILE_PICKER.input, input);
  });
  test(`${name}: one change ingests one snapshot and repeated callbacks do nothing`, async () => {
    const h = setup(), input = h.open(name), oldChange = input.onchange;
    const file = {name: 'actual.txt', size: 7}, fileList = [file]; input.files = fileList;
    oldChange(); oldChange(); h.drain(); await Promise.resolve();
    assert.equal(h.ingested.length, 1); assert.equal(h.ingested[0].files.length, 1);
    assert.equal(h.ingested[0].files[0], file); assert.notEqual(h.ingested[0].files, fileList);
    assert.equal(h.ingested[0].topic, name === 'doUpload' ? null : 0);
    assert.equal(input.parentNode, null); assert.equal(input.onchange, null);
    assert.equal(input.oncancel, null); assert.equal(h.c.OWNED_FILE_PICKER, null);
    assert.ok(h.events.indexOf('read-files') < h.events.indexOf('clear-files'));
  });
  test(`${name}: cancellation cleans up and ignores a captured late change`, () => {
    const h = setup(), input = h.open(name), oldChange = input.onchange, oldCancel = input.oncancel;
    input.files = [{name: 'must-not-upload.txt'}]; oldCancel(); oldCancel(); oldChange(); h.drain();
    assert.equal(h.ingested.length, 0); assert.equal(h.c.OWNED_FILE_PICKER, null);
    assert.equal(input.parentNode, null); assert.equal(input.onchange, null); assert.equal(input.oncancel, null);
  });
}

test('new entry replaces the prior input; its old callbacks cannot clear or submit the new picker', () => {
  const h = setup(), first = h.open('pickLocalFile'), change = first.onchange, cancel = first.oncancel;
  first.files = [{name: 'old.txt'}]; const second = h.open('doUpload');
  assert.equal(first.parentNode, null); assert.equal(first.onchange, null);
  change(); cancel(); h.drain();
  assert.equal(h.ingested.length, 0); assert.equal(h.c.OWNED_FILE_PICKER.input, second);
  second.files = [{name: 'new.txt'}]; second.onchange(); h.drain();
  assert.equal(h.ingested.length, 1); assert.equal(h.ingested[0].files[0].name, 'new.txt');
});

test('an empty change settles without ingesting and the stable host is reused', () => {
  const h = setup(), first = h.open('pickLocalFile'), host = h.c.OWNED_FILE_PICKER_HOST;
  first.onchange(); assert.equal(h.ingested.length, 0); assert.equal(h.c.OWNED_FILE_PICKER, null);
  const second = h.open('doUpload'); assert.notEqual(first, second);
  assert.equal(h.c.OWNED_FILE_PICKER_HOST, host); assert.equal(host.children.length, 1);
  assert.equal(h.document.body.children.filter(node => node.id === host.id).length, 1);
});

test('invalid initial context does not allocate or activate an input', () => {
  const h = setup(), count = h.created.length;
  assert.equal(h.c.openOwnedFilePicker({isCurrent: () => false, onFiles() { throw Error('unexpected'); }}), null);
  assert.equal(h.created.length, count); assert.equal(h.clicks.length, 0);
  h.c.kbEditSession = null; h.c.editPickFile(0, 0); assert.equal(h.clicks.length, 0);
});

test('activation failure clears the pending owner and handlers before rethrowing', () => {
  const h = setup(), create = h.document.createElement;
  h.document.createElement = tag => { const node = create(tag); if (tag === 'input') node.click = () => { throw Error('native activation rejected'); }; return node; };
  assert.throws(() => h.open('pickLocalFile'), /native activation rejected/);
  const input = h.created.find(node => node.tagName === 'INPUT');
  assert.equal(input.parentNode, null); assert.equal(input.onchange, null); assert.equal(h.c.OWNED_FILE_PICKER, null);
});

test('all entrypoints reject selection after workspace or authentication epoch changes', () => {
  for (const name of entries) for (const field of ['cur', '_authEpoch']) {
    const h = setup(), input = h.open(name), change = input.onchange;
    input.files = [{name: 'old-context.txt'}]; h.c[field] = field === 'cur' ? 'b' : 2;
    change(); h.drain(); assert.equal(h.ingested.length, 0, name + ':' + field);
    assert.equal(input.parentNode, null); assert.equal(h.c.OWNED_FILE_PICKER, null);
  }
});

test('doUpload rechecks context after its scheduled view transition', () => {
  for (const field of ['cur', '_authEpoch']) {
    const h = setup(), input = h.open('doUpload'); input.files = [{name: 'deferred.txt'}]; input.onchange();
    assert.equal(h.timers.length, 1); h.c[field] = field === 'cur' ? 'b' : 2; h.drain();
    assert.equal(h.ingested.length, 0, field);
  }
});

test('editor replacement and segment movement invalidate a pending attachment', () => {
  for (const changeContext of [h => { h.c.kbEditSession = {...h.c.kbEditSession}; }, h => { h.c.kbEditSession.segmentVersion++; }]) {
    const h = setup(), input = h.open('editPickFile'), change = input.onchange;
    input.files = [{name: 'old-editor.txt'}]; changeContext(h); change(); h.drain();
    assert.equal(h.ingested.length, 0); assert.equal(input.parentNode, null);
  }
});

test('actual editor context rejects replacement of the project or source section', () => {
  for (const changeContext of [h => { h.c.PROJECTS.a = {...h.c.PROJECTS.a}; }, h => { h.c.PROJECTS.a.kb[0] = {...h.c.PROJECTS.a.kb[0]}; }]) {
    const h = setup(), input = h.open('editPickFile'); input.files = [{name: 'replaced-source.txt'}];
    changeContext(h); h.c.cancelObsoleteFilePickers();
    assert.equal(h.c.OWNED_FILE_PICKER, null); assert.equal(input.parentNode, null); assert.equal(h.ingested.length, 0);
  }
});

test('actual cancel-edit success invalidates its pending picker', () => {
  const h = setup(), input = h.open('editPickFile'), change = input.onchange;
  input.files = [{name: 'cancelled-editor.txt'}]; assert.equal(h.c.kbCancelEdit(true), true); change(); h.drain();
  assert.equal(h.c.kbEditSession, null); assert.equal(h.c.OWNED_FILE_PICKER, null); assert.equal(h.ingested.length, 0);
});

test('a blocked cancel-edit keeps the active editor and its picker alive', () => {
  const h = setup(), input = h.open('editPickFile'), session = h.c.kbEditSession;
  session.saving = true; assert.equal(h.c.kbCancelEdit(false), false);
  assert.equal(h.c.kbEditSession, session); assert.equal(h.c.OWNED_FILE_PICKER.input, input);
});

test('actual auth-reset clears a pending picker before a captured callback can run', () => {
  for (const name of entries) {
    const h = setup(), input = h.open(name), change = input.onchange;
    input.files = [{name: 'prior-account.txt'}]; h.c._authResetView(); change(); h.drain();
    assert.equal(h.c.cur, null); assert.equal(h.c.view, 'login');
    assert.equal(input.parentNode, null); assert.equal(h.c.OWNED_FILE_PICKER, null); assert.equal(h.ingested.length, 0);
  }
});

test('actual render preserves a current picker while replacing the application root', () => {
  const h = setup(), child = h.document.createElement('article'); h.root.appendChild(child);
  const input = h.open('pickLocalFile'), host = h.c.OWNED_FILE_PICKER_HOST;
  h.c.render(); assert.equal(child.parentNode, null);
  assert.equal(host.parentNode, h.document.body); assert.equal(input.parentNode, host);
  assert.equal(h.c.OWNED_FILE_PICKER.input, input);
});

test('actual render clears obsolete workspace picker before switching authorization context', () => {
  const h = setup(), input = h.open('pickLocalFile'), change = input.onchange;
  h.c.cur = 'b'; h.c.render(); input.files = [{name: 'late.txt'}]; change(); h.drain();
  assert.equal(h.c.switchedWorkspace, 'b'); assert.equal(input.parentNode, null);
  assert.equal(h.c.OWNED_FILE_PICKER, null); assert.equal(h.ingested.length, 0);
});

test('window focus does not settle a still-current native picker', () => {
  const h = setup(), input = h.open('pickLocalFile'); h.fire('blur'); h.fire('focus');
  assert.equal(h.c.OWNED_FILE_PICKER.input, input); assert.equal(input.parentNode, h.c.OWNED_FILE_PICKER_HOST);
  assert.equal(h.listeners.get('focus')?.length || 0, 0);
  input.files = [{name: 'after-focus.txt'}]; input.onchange();
  assert.equal(h.ingested.length, 1);
});

test('one actual picker change reaches submitOriginalFile once and applies its synthetic durable receipt', async () => {
  const h = setup(), requests = [], c = h.c;
  c.UPLOADS = {}; c.KB_FILE_CHUNKS = {}; c.UPLOAD_TOMBS = {};
  c.Uint8Array = Uint8Array;
  c.crypto = {getRandomValues(bytes) { bytes.fill(42); return bytes; }};
  let readerCalls = 0, persistCalls = 0;
  c.FileReader = class {
    readAsDataURL(file) {
      readerCalls++; assert.equal(file.name, 'pipeline.txt');
      this.result = 'data:text/plain;base64,cmVhbCBwaXBlbGluZQ=='; this.onload();
    }
  };
  c.fetch = async (url, options) => {
    const body = JSON.parse(options.body); requests.push({url, options, body});
    return {json: async () => ({ok: true, original: {id: body.uploadId},
      upload: {originalId: body.uploadId, name: body.filename, size: 13},
      fileChunks: [{id: 'synthetic-chunk', text: 'real pipeline', cite: body.filename}]})};
  };
  c.persist = () => { persistCalls++; }; c.refreshKbProgress = () => {};
  h.document.querySelectorAll = () => [];
  // Load the real upload, receipt, ingest and finalize functions. Only the byte
  // reader and HTTP transport are synthetic; no production request is made.
  vm.runInContext(between(tail, 'function originalUploadEpoch(){', '/* 【2026-09-23 修复 T2】'), c);
  const realIngest = c.ingestFiles; let completion;
  c.ingestFiles = (...args) => (completion = realIngest(...args));
  const input = h.open('pickLocalFile'), change = input.onchange;
  input.files = [{name: 'pipeline.txt', size: 13}]; change(); change();
  const saved = await completion;
  assert.equal(readerCalls, 1); assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/upload-file'); assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.credentials, 'same-origin');
  assert.equal(requests[0].body.projectKey, 'a'); assert.equal(requests[0].body.kbIdx, 0);
  assert.equal(requests[0].body.filename, 'pipeline.txt');
  assert.equal(requests[0].body.fileB64, 'cmVhbCBwaXBlbGluZQ==');
  assert.equal(saved.length, 1); assert.equal(c.UPLOADS.a.length, 1); assert.equal(c.KB_FILE_CHUNKS.a.length, 1);
  assert.match(c.PROJECTS.a.kb[0].known[0], /pipeline\.txt/); assert.ok(persistCalls > 0);
  assert.equal(input.parentNode, null); assert.equal(c.OWNED_FILE_PICKER, null);
});
