'use strict';

// No browser, npm DOM package, network, or business server is required. This
// deliberately small DOM implements only the APIs used by the icon adapter.
// These are behavioral DOM-mutation checks, not CSS/layout/browser tests.
// Default: node --test tests/test_client_brand_dom.cjs
// An explicit HXZ_CLIENT_ICON_SCRIPT path may be used while preparing a preview.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const adapterPath = process.env.HXZ_CLIENT_ICON_SCRIPT
  ? path.resolve(process.env.HXZ_CLIENT_ICON_SCRIPT)
  : path.join(root, 'frontend/index/client-icons.js');

function splitOutside(value, separator) {
  const parts = []; let start = 0, brackets = 0, parens = 0, quote = '';
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (quote) { if (c === quote && value[i - 1] !== '\\') quote = ''; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '[') brackets++; else if (c === ']') brackets--;
    if (c === '(') parens++; else if (c === ')') parens--;
    if (!brackets && !parens && separator(c)) {
      if (value.slice(start, i).trim()) parts.push(value.slice(start, i).trim());
      parts.push(c); start = i + 1;
    }
  }
  if (value.slice(start).trim()) parts.push(value.slice(start).trim());
  return parts;
}

function selectorGroups(selector) {
  return splitOutside(selector, c => c === ',').filter(s => s !== ',');
}

function selectorParts(selector) {
  const tokens = splitOutside(selector.trim(), c => /\s/.test(c) || c === '>');
  const parts = []; let relationship = null;
  for (const token of tokens) {
    if (/^\s$/.test(token)) { if (parts.length && relationship !== '>') relationship = ' '; }
    else if (token === '>') relationship = '>';
    else { parts.push({simple: token, relationship}); relationship = null; }
  }
  return parts;
}

function simpleMatches(element, simple, scope) {
  if (!element || element.nodeType !== 1) return false;
  let remaining = simple;
  const negate = [];
  remaining = remaining.replace(/:not\(([^()]*)\)/g, (_, inner) => { negate.push(inner); return ''; });
  if (negate.some(inner => matches(element, inner, scope))) return false;
  if (remaining.includes(':scope')) {
    if (element !== scope) return false;
    remaining = remaining.replace(/:scope/g, '');
  }
  const siblings = element.parentElement ? element.parentElement.children : [element];
  let positional = true;
  remaining = remaining.replace(/:(first-child|last-child|first-of-type|nth-child\((\d+)\))/g, (_, kind, number) => {
    if (kind === 'first-child') positional = positional && siblings[0] === element;
    else if (kind === 'last-child') positional = positional && siblings.at(-1) === element;
    else if (kind === 'first-of-type') positional = positional && siblings.find(n => n.tagName === element.tagName) === element;
    else positional = positional && siblings[Number(number) - 1] === element;
    return '';
  });
  if (!positional) return false;
  const attrs = [];
  remaining = remaining.replace(/\[([^\]]+)\]/g, (_, attr) => { attrs.push(attr); return ''; });
  for (const attr of attrs) {
    const match = attr.match(/^([\w-]+)\s*(?:(\^=|\$=|\*=|=)\s*(.*))?$/);
    assert.ok(match, 'Unsupported attribute selector: ' + attr);
    const actual = element.getAttribute(match[1]);
    if (actual == null) return false;
    if (match[2]) {
      const expected = match[3].replace(/^(["'])([\s\S]*)\1$/, '$2');
      if (match[2] === '=' && actual !== expected) return false;
      if (match[2] === '^=' && !actual.startsWith(expected)) return false;
      if (match[2] === '$=' && !actual.endsWith(expected)) return false;
      if (match[2] === '*=' && !actual.includes(expected)) return false;
    }
  }
  const id = remaining.match(/#([\w-]+)/);
  if (id && element.id !== id[1]) return false;
  for (const name of remaining.matchAll(/\.([\w-]+)/g)) if (!element.classList.contains(name[1])) return false;
  const tag = remaining.match(/^([A-Za-z][\w-]*|\*)/);
  if (tag && tag[1] !== '*' && element.tagName !== tag[1].toUpperCase()) return false;
  remaining = remaining.replace(/^([A-Za-z][\w-]*|\*)/, '').replace(/[#.]([\w-]+)/g, '');
  assert.equal(remaining, '', 'Unsupported selector in minimal DOM: ' + simple);
  return true;
}

function matches(element, selector, scope = element) {
  return selectorGroups(selector).some(group => {
    const parts = selectorParts(group);
    function at(node, index) {
      if (!simpleMatches(node, parts[index].simple, scope)) return false;
      if (!index) return true;
      if (parts[index].relationship === '>') return at(node.parentElement, index - 1);
      for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) if (at(ancestor, index - 1)) return true;
      return false;
    }
    return parts.length > 0 && at(element, parts.length - 1);
  });
}

function escapeAttribute(value) { return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }
function decode(value) { return value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }

class Text {
  constructor(value, document) { this.nodeType = 3; this.nodeValue = String(value); this.ownerDocument = document; this.parentNode = null; }
  get parentElement() { return this.parentNode; }
  get textContent() { return this.nodeValue; }
  set textContent(value) { this.nodeValue = String(value); }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
}

class Element {
  constructor(tag, document) {
    this.nodeType = 1; this.tagName = tag.toUpperCase(); this.localName = tag.toLowerCase(); this.ownerDocument = document;
    this.attributes = new Map(); this.childNodes = []; this.parentNode = null; this.style = {};
    this.value = ''; this.checked = false; this.disabled = false; this.selectionStart = 0; this.selectionEnd = 0;
    this.onclick = null; this.onchange = null; this._listeners = new Map();
    this.classList = {
      contains: name => this.className.split(/\s+/).includes(name),
      add: (...names) => { this.className = [...new Set(this.className.split(/\s+/).filter(Boolean).concat(names))].join(' '); },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter(x => !names.includes(x)).join(' '); },
      toggle: (name, force) => { const add = force === undefined ? !this.classList.contains(name) : force; this.classList[add ? 'add' : 'remove'](name); return add; },
    };
    this.dataset = new Proxy({}, {
      get: (_, key) => this.getAttribute('data-' + String(key).replace(/[A-Z]/g, c => '-' + c.toLowerCase())),
      set: (_, key, value) => { this.setAttribute('data-' + String(key).replace(/[A-Z]/g, c => '-' + c.toLowerCase()), value); return true; },
    });
  }
  get parentElement() { return this.parentNode; }
  get children() { return this.childNodes.filter(node => node.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes.at(-1) || null; }
  get firstElementChild() { return this.children[0] || null; }
  get id() { return this.getAttribute('id') || ''; }
  set id(value) { this.setAttribute('id', value); }
  get className() { return this.getAttribute('class') || ''; }
  set className(value) { this.setAttribute('class', value); }
  get textContent() { return this.childNodes.map(node => node.textContent).join(''); }
  set textContent(value) { this.replaceChildren(new Text(value, this.ownerDocument)); }
  get innerHTML() { return this.childNodes.map(node => node.nodeType === 3 ? node.nodeValue : node.outerHTML).join(''); }
  get outerHTML() { return '<' + this.localName + [...this.attributes].map(([key, value]) => ' ' + key + '="' + escapeAttribute(value) + '"').join('') + '>' + this.innerHTML + '</' + this.localName + '>'; }
  set innerHTML(html) {
    this.replaceChildren();
    const stack = [this];
    for (const token of String(html).match(/<[^>]+>|[^<]+/g) || []) {
      if (token.startsWith('</')) { stack.pop(); continue; }
      if (!token.startsWith('<')) { stack.at(-1).appendChild(new Text(decode(token), this.ownerDocument)); continue; }
      const tag = token.match(/^<([\w-]+)/); assert.ok(tag, 'Minimal DOM received unsupported markup');
      const element = this.ownerDocument.createElement(tag[1]);
      const attrText = token.slice(tag[0].length).replace(/\/?\s*>$/, '');
      for (const attr of attrText.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+)))?/g)) element.setAttribute(attr[1], decode(attr[2] ?? attr[3] ?? attr[4] ?? ''));
      stack.at(-1).appendChild(element);
      if (!/\/>$/.test(token) && !['input', 'img', 'br', 'meta', 'link'].includes(tag[1])) stack.push(element);
    }
  }
  hasAttribute(name) { return this.attributes.has(name); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) {
    const oldValue = this.getAttribute(name); this.attributes.set(name, String(value));
    if (name === 'value') this.value = String(value);
    if (name === 'checked') this.checked = true;
    if (name === 'disabled') this.disabled = true;
    if (name === 'style') for (const item of String(value).split(';')) { const index = item.indexOf(':'); if (index >= 0) this.style[item.slice(0, index).trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = item.slice(index + 1).trim(); }
    this.ownerDocument?._mutation({type: 'attributes', target: this, attributeName: name, oldValue});
  }
  removeAttribute(name) { this.attributes.delete(name); }
  appendChild(node) { if (node.parentNode) node.parentNode.removeChild(node); node.parentNode = this; this.childNodes.push(node); this.ownerDocument?._mutation({type: 'childList', target: this, addedNodes: [node], removedNodes: []}); return node; }
  append(...nodes) { nodes.forEach(node => this.appendChild(typeof node === 'string' ? new Text(node, this.ownerDocument) : node)); }
  insertBefore(node, before) { if (node.parentNode) node.parentNode.removeChild(node); const index = this.childNodes.indexOf(before); node.parentNode = this; this.childNodes.splice(index < 0 ? this.childNodes.length : index, 0, node); this.ownerDocument?._mutation({type: 'childList', target: this, addedNodes: [node], removedNodes: []}); return node; }
  prepend(node) { return this.insertBefore(node, this.firstChild); }
  before(node) { if (this.parentNode) this.parentNode.insertBefore(node, this); }
  removeChild(node) { const index = this.childNodes.indexOf(node); if (index >= 0) { this.childNodes.splice(index, 1); node.parentNode = null; this.ownerDocument?._mutation({type: 'childList', target: this, addedNodes: [], removedNodes: [node]}); } return node; }
  replaceChildren(...nodes) { this.childNodes.slice().forEach(node => this.removeChild(node)); this.append(...nodes); }
  replaceWith(node) { if (this.parentNode) { this.before(node); this.remove(); } }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  contains(node) { for (let current = node; current; current = current.parentNode) if (current === this) return true; return false; }
  matches(selector) { return matches(this, selector); }
  closest(selector) { for (let node = this; node; node = node.parentElement) if (matches(node, selector)) return node; return null; }
  querySelectorAll(selector) { const result = []; const walk = node => { for (const child of node.children) { if (matches(child, selector, this)) result.push(child); walk(child); } }; walk(this); return result; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(name, fn) { const list = this._listeners.get(name) || []; list.push(fn); this._listeners.set(name, list); }
  removeEventListener(name, fn) { this._listeners.set(name, (this._listeners.get(name) || []).filter(item => item !== fn)); }
  focus() { this.ownerDocument.activeElement = this; }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
}

function harness() {
  const observers = [], frames = [], calls = {network: 0, writes: 0};
  const document = {
    readyState: 'complete', activeElement: null,
    createElement: tag => new Element(tag, document), createElementNS: (_, tag) => new Element(tag, document),
    createTextNode: value => new Text(value, document),
    querySelector: selector => document.documentElement.querySelector(selector),
    querySelectorAll: selector => document.documentElement.querySelectorAll(selector),
    getElementById: id => document.querySelector('#' + id),
    addEventListener() {}, removeEventListener() {},
    _mutation(record) { for (const observer of observers) { const {target, options} = observer; if (!target || !target.contains(record.target)) continue; if (record.type === 'attributes' && (!options.attributes || options.attributeFilter && !options.attributeFilter.includes(record.attributeName))) continue; if (record.type === 'childList' && !options.childList) continue; observer.callback([record], observer); } },
  };
  document.documentElement = document.createElement('html');
  document.head = document.documentElement.appendChild(document.createElement('head'));
  document.body = document.documentElement.appendChild(document.createElement('body'));
  const e = (tag, attributes = {}, children = []) => {
    const element = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    element.append(...(Array.isArray(children) ? children : [children])); return element;
  };
  const app = document.body.appendChild(e('div', {id: 'root'}));
  app.append(e('aside', {class: 'sidebar'}, [e('button', {class: 'nav-item', onclick: "go('home')"}, [e('i', {class: 'i'}, '🤝'), e('span', {class: 'nav-copy'}, [e('strong', {}, '招商对接')])])]));
  const c = {
    document, console, Node: {ELEMENT_NODE: 1, TEXT_NODE: 3}, Element,
    requestAnimationFrame: callback => { frames.push(callback); return frames.length; }, cancelAnimationFrame() {},
    MutationObserver: class { constructor(callback) { this.callback = callback; this.target = null; observers.push(this); } observe(target, options) { this.target = target; this.options = options; } disconnect() { this.target = null; } },
    hxzIcons: {has: key => /^[a-z][a-z-]+$/.test(key)},
    // Geometry is intentionally a stub; the test runs the production adapter,
    // while the separately maintained real icon library owns SVG path tests.
    hxzIcon: (key, options = {}) => '<svg class="hxz-icon ' + (options.className || '') + '" data-hxz-icon="' + key + '" aria-hidden="true"><path d="M1 1h1"/></svg>',
    fetch() { calls.network++; throw new Error('Icon decoration must not access a backend'); },
    localStorage: {getItem() { return null; }, setItem() { calls.writes++; throw new Error('Icon decoration must not persist data'); }, removeItem() { calls.writes++; throw new Error('Icon decoration must not persist data'); }},
  };
  c.window = c; vm.createContext(c);
  function flush() { let runs = 0; while (frames.length) { assert.ok(runs++ < 100, 'Decoration must not cause an observer loop'); frames.shift()(0); } }
  function run() { assert.ok(fs.existsSync(adapterPath), 'Production icon adapter is required at ' + adapterPath); vm.runInContext(fs.readFileSync(adapterPath, 'utf8'), c, {filename: adapterPath}); flush(); }
  function refresh() { assert.equal(typeof c.hxzClientIcons?.refresh, 'function'); c.hxzClientIcons.refresh(); flush(); }
  return {c, document, e, app, calls, run, refresh, flush};
}

function copyWithoutIcons(node) {
  if (node.nodeType === 3) return node.nodeValue;
  if (node.tagName === 'SVG') return '';
  return node.childNodes.map(copyWithoutIcons).join('');
}

test('client icon adapter keeps dynamic attachment filenames including terminal symbols', () => {
  const h = harness(), {e} = h;
  const workspace = h.app.appendChild(e('section', {id: 'dockingWorkspace'}));
  const names = ['预算表+', '目录→', '客户资料✅', '企业📎资料+.pdf'];
  const buttons = names.map((name, index) => workspace.appendChild(e('button', {
    class: 'docking-button is-quiet', onclick: "dockingDownloadEventFile('workspace','event',123," + index + ')',
  }, '附件 · ' + name)));
  const labels = buttons.map(copyWithoutIcons), handlers = buttons.map(button => button.getAttribute('onclick'));
  h.run();
  buttons.forEach((button, index) => {
    assert.equal(copyWithoutIcons(button), labels[index], 'Filename is content, not a removable UI glyph: ' + names[index]);
    assert.equal(button.getAttribute('onclick'), handlers[index]);
    assert.equal(button.querySelectorAll('svg').length, 1, 'The original download action is still decorated');
  });
  assert.equal(h.calls.network + h.calls.writes, 0);
});

test('client icon adapter never decorates i.i inside report, chat or source content', () => {
  const h = harness(), {e} = h;
  const wrappers = [
    {class: 'industry-prose'}, {id: 'reportContent'}, {id: 'hrpt-body-saved-1'},
    {id: 'kbConv'}, {class: 'kb-detail-richtext'}, {class: 'industry-confirm-text'},
    {class: 'chain-node-drawer-content'},
  ].map(attributes => h.app.appendChild(e('div', attributes, [e('p', {}, ['原始内容 + → ✅ ', e('i', {class: 'i'}, '⚠'), ' 原文保持。'])])));
  const before = wrappers.map(node => node.innerHTML);
  h.run(); h.refresh();
  wrappers.forEach((node, index) => assert.equal(node.innerHTML, before[index], JSON.stringify(wrappers[index].attributes)));
  assert.equal(h.app.querySelectorAll('.sidebar svg').length, 1, 'Real UI decoration must still occur');
});

test('client icon adapter preserves form node identity, field state, focus and event handlers', () => {
  const h = harness(), {e} = h;
  const text = e('input', {id: 'kept-text', value: '用户填写 + → ✅'}), checked = e('input', {type: 'checkbox', checked: ''}), unchecked = e('input', {type: 'checkbox'});
  const readonly = e('input', {disabled: '', value: '只读机构'});
  const rows = [checked, unchecked].map((input, index) => e('div', {class: 'toggle-row'}, [e('span', {}, [e('strong', {}, index ? '超时提醒' : '状态变化通知'), e('small', {}, '原始说明')]), input]));
  const button = e('button', {class: 'settings-save', onclick: "toast('提醒偏好已保存')"}, '保存偏好');
  const page = e('div', {class: 'page'}, [e('div', {class: 'settings-scroll'}, [e('section', {class: 'settings-section'}, [e('h2', {}, '提醒偏好（可自行调整）'), ...rows, text, readonly, button])])]);
  h.app.append(page);
  let clicked = 0, changed = 0;
  button.onclick = () => clicked++; text.onchange = () => changed++;
  text.focus(); text.setSelectionRange(3, 8);
  const nodes = [text, checked, unchecked, readonly];
  const state = nodes.map(node => ({node, value: node.value, checked: node.checked, disabled: node.disabled, onchange: node.onchange}));
  const onclick = button.onclick, attr = button.getAttribute('onclick');
  h.run(); for (let i = 0; i < 5; i++) h.refresh();
  state.forEach(saved => {
    assert.ok(h.document.body.contains(saved.node));
    assert.equal(saved.node.value, saved.value); assert.equal(saved.node.checked, saved.checked);
    assert.equal(saved.node.disabled, saved.disabled); assert.equal(saved.node.onchange, saved.onchange);
  });
  assert.equal(h.document.activeElement, text); assert.equal(text.selectionStart, 3); assert.equal(text.selectionEnd, 8);
  assert.equal(button.onclick, onclick); assert.equal(button.getAttribute('onclick'), attr);
  assert.equal(copyWithoutIcons(button), '保存偏好'); assert.equal(clicked + changed, 0);
  assert.equal(checked.getAttribute('aria-label'), '状态变化通知'); assert.equal(unchecked.getAttribute('aria-label'), '超时提醒');
  assert.equal(h.calls.network + h.calls.writes, 0);
});

test('client icon decoration stays idempotent across repeated refresh and one native rerender', () => {
  const h = harness(), {e} = h;
  const workspace = h.app.appendChild(e('section', {id: 'dockingWorkspace'}));
  const button = workspace.appendChild(e('button', {onclick: "openDockingLog('workspace','clue')"}, '记录跟进'));
  h.run();
  const initial = h.app.querySelectorAll('svg').length;
  assert.ok(initial >= 2, 'Navigation and the action must be decorated');
  for (let i = 0; i < 8; i++) h.refresh();
  assert.equal(h.app.querySelectorAll('svg').length, initial);
  assert.equal(button.querySelectorAll('svg').length, 1);
  const replacement = e('button', {onclick: "openDockingLog('workspace','clue')"}, '记录跟进');
  button.replaceWith(replacement); h.flush(); h.refresh();
  assert.equal(replacement.querySelectorAll('svg').length, 1);
  assert.equal(copyWithoutIcons(replacement), '记录跟进');
  assert.equal(h.app.querySelectorAll('svg').length, initial);
  assert.equal(h.calls.network + h.calls.writes, 0);
});

for (const count of [6, 9]) {
  test(count + ' semantic topic icons survive reordering and refresh and update when a topic changes', () => {
    const h = harness(), {e} = h;
    vm.runInContext(fs.readFileSync(path.join(root, 'frontend/index/kb-presentation.js'), 'utf8'), h.c, {filename: 'kb-presentation.js'});
    const titles = ['主导产业与产业链', '园区与承载条件', '链主与存量企业', '政策、规划与领导关注', '科技创新', '区位交通', '人才与团队', '产业基金', '未分类专题'];
    const grid = h.app.appendChild(e('div', {class: 'kb-topic-grid'}));
    const entries = titles.slice(0, count).map((title, index) => {
      const presentation = h.c.kbTopicPresentation(title);
      const number = e('span', {class: 'kb-topic-number', 'aria-hidden': 'true'}, String(index + 1).padStart(2, '0'));
      const heading = e('span', {class: 'kb-topic-title'}, title);
      const material = e('button', {class: 'kb-topic-material', onclick: 'kbClosePanels();kbDetail(' + index + ')'}, [number, heading]);
      const question = e('button', {class: 'kb-topic-question', onclick: 'askAboutKb(' + index + ')'}, '围绕此板块提问');
      const card = grid.appendChild(e('article', {class: 'kb-topic-card', 'data-kb-topic': String(index), 'data-kb-icon': presentation.icon, 'data-kb-theme': presentation.theme}, [material, question]));
      return {card, number, heading, material, question, index, icon: presentation.icon};
    });
    const assertCards = () => entries.forEach(entry => {
      const icons = entry.card.querySelectorAll('svg.client-topic-icon');
      assert.equal(icons.length, 1, 'Exactly one semantic icon for original card ' + entry.index);
      assert.equal(icons[0].getAttribute('data-hxz-icon'), entry.icon);
      assert.equal(entry.card.getAttribute('data-kb-topic'), String(entry.index));
      assert.equal(entry.number.textContent, String(entry.index + 1).padStart(2, '0'));
      assert.equal(entry.material.getAttribute('onclick'), 'kbClosePanels();kbDetail(' + entry.index + ')');
      assert.equal(entry.question.getAttribute('onclick'), 'askAboutKb(' + entry.index + ')');
    });
    h.run(); assertCards();
    const initialCount = h.app.querySelectorAll('svg').length;
    for (let i = 0; i < 5; i++) h.refresh();
    assertCards(); assert.equal(h.app.querySelectorAll('svg').length, initialCount);

    // Move the existing cards, retaining their business identity and callbacks.
    entries.slice().reverse().forEach(entry => grid.appendChild(entry.card));
    h.flush(); h.refresh(); assertCards();
    assert.equal(h.app.querySelectorAll('svg').length, initialCount);

    const changed = entries.at(-1), oldIcon = changed.card.querySelector('.client-topic-icon');
    const next = h.c.kbTopicPresentation('产业金融与基金');
    assert.notEqual(next.icon, changed.icon, 'The fixture must require a real icon replacement');
    changed.heading.textContent = '产业金融与基金';
    changed.card.setAttribute('data-kb-icon', next.icon);
    changed.card.setAttribute('data-kb-theme', next.theme);
    changed.icon = next.icon;
    h.flush(); h.refresh(); assertCards();
    assert.notEqual(changed.card.querySelector('.client-topic-icon'), oldIcon, 'Replace the stale icon when semantics change');
    assert.equal(h.app.querySelectorAll('svg').length, initialCount);
    assert.equal(h.calls.network + h.calls.writes, 0);
  });
}
