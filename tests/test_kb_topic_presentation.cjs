'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const canonical = ['主导产业与产业链', '园区与承载条件', '链主与存量企业', '政策、规划与领导关注'];
const artwork = Object.freeze({
  research: '/fixtures/research.jpg', city: '/fixtures/city.jpg',
  collaboration: '/fixtures/collaboration.jpg', policy: '/fixtures/policy.png',
});

function boot(images = artwork) {
  const calls = {network: 0, writes: 0};
  const c = {
    console, HXZ_BRAND_IMAGES: images,
    _authEscape: value => String(value == null ? '' : value).replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character])),
    kbWorkspaceSessionsHtml: () => '<p>本地测试会话</p>',
    kbComposer: () => '<div class="test-composer"></div>',
    fetch() { calls.network++; throw new Error('Presentation must not request a backend'); },
    localStorage: {setItem() { calls.writes++; throw new Error('Presentation must not change saved data'); }},
  };
  c.window = c;
  vm.createContext(c);
  vm.runInContext(read('frontend/index/brand-icons.js'), c, {filename: 'brand-icons.js'});
  vm.runInContext(read('frontend/index/kb-presentation.js'), c, {filename: 'kb-presentation.js'});
  for (const name of ['kbTopicPresentation', 'kbTopicArtwork', 'kbTopicColumns']) assert.equal(typeof c[name], 'function', name + ' must be exported');
  const source = read('frontend/index/script-02-sections/12-tail.js');
  const start = source.indexOf('function kbPage('), end = source.indexOf('\nfunction settingsPage(', start);
  assert.ok(start >= 0 && end > start, 'Load the real kbPage without unrelated settings or business code');
  vm.runInContext(source.slice(start, end), c, {filename: 'kbPage.js'});
  return {c, calls};
}

function attributes(source) {
  const result = {};
  for (const match of source.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) result[match[1]] = match[2];
  return result;
}

function cards(html) {
  return [...html.matchAll(/<article\b([^>]*)>([\s\S]*?)<\/article>/g)]
    .filter(match => (attributes(match[1]).class || '').split(/\s+/).includes('kb-topic-card'))
    .map(match => ({attributes: attributes(match[1]), html: match[2]}));
}

function element(card, tag, className) {
  const regex = new RegExp('<' + tag + '\\b([^>]*)>([\\s\\S]*?)</' + tag + '>', 'g');
  for (const match of card.html.matchAll(regex)) {
    const attrs = attributes(match[1]);
    if ((attrs.class || '').split(/\s+/).includes(className)) return {attributes: attrs, text: match[2]};
  }
  throw new Error('Missing ' + className);
}

function assertPresentation(c, title) {
  const presentation = c.kbTopicPresentation(title);
  assert.ok(presentation && typeof presentation === 'object');
  assert.equal(typeof presentation.icon, 'string');
  assert.ok(c.hxzIcons.has(presentation.icon), 'Use a registered semantic icon: ' + presentation.icon);
  assert.ok(Object.hasOwn(artwork, presentation.art), 'Use a named approved artwork: ' + presentation.art);
  assert.equal(typeof presentation.theme, 'string');
  assert.match(presentation.theme, /^[a-z][a-z0-9-]*$/, 'Theme must be safe for a data attribute');
  assert.ok(Object.values(artwork).includes(c.kbTopicArtwork(title)), 'An actual image URL must always be returned');
  return presentation;
}

function project(titles) {
  return {
    city: '本地测试城市',
    kb: titles.map((title, index) => ({t: title, known: ['原始材料 ' + index], marker: 'do-not-change-' + index})),
  };
}

test('the four original topics keep semantic icon/artwork choices after reordering', () => {
  const {c, calls} = boot();
  const expected = [
    {icons: ['industry-chain'], art: 'research'},
    {icons: ['city', 'industrial-park'], art: 'city'},
    {icons: ['enterprise'], art: 'collaboration'},
    {icons: ['document'], art: 'policy'},
  ];
  const presentations = new Map(canonical.map((title, index) => {
    const result = assertPresentation(c, title);
    assert.ok(expected[index].icons.includes(result.icon), title + ': ' + result.icon);
    assert.equal(result.art, expected[index].art);
    return [title, JSON.stringify(result)];
  }));
  for (const titles of [canonical, [...canonical].reverse(), [canonical[2], canonical[0], canonical[3], canonical[1]]]) {
    const p = project(titles), before = JSON.stringify(p), rendered = cards(c.kbPage(p));
    assert.equal(rendered.length, titles.length);
    titles.forEach((title, index) => {
      const result = assertPresentation(c, title), card = rendered[index];
      assert.equal(JSON.stringify(result), presentations.get(title));
      assert.equal(card.attributes['data-kb-topic'], String(index), 'Business index remains positional');
      assert.equal(card.attributes['data-kb-icon'], result.icon);
      assert.equal(card.attributes['data-kb-theme'], result.theme);
      assert.equal(attributes(card.html.match(/<img\b([^>]*)>/)[1]).src, c.kbTopicArtwork(title));
    });
    assert.equal(JSON.stringify(p), before);
  }
  assert.equal(calls.network + calls.writes, 0);
});

for (const count of [4, 6, 9, 12, 20]) {
  test(count + ' topic cards all receive artwork/icons while keeping both original index callbacks', () => {
    const {c, calls} = boot();
    const base = canonical.concat(['科技创新与研发', '区位交通', '人才与团队', '营商环境', '自定义专题']);
    const titles = Array.from({length: count}, (_, index) => base[index % base.length] + (index >= base.length ? ' ' + index : ''));
    const p = project(titles), before = JSON.stringify(p), html = c.kbPage(p), rendered = cards(html);
    assert.equal(rendered.length, count);
    rendered.forEach((card, index) => {
      const presentation = assertPresentation(c, titles[index]);
      assert.equal(card.attributes['data-kb-topic'], String(index));
      assert.equal(card.attributes['data-kb-icon'], presentation.icon);
      assert.equal(card.attributes['data-kb-theme'], presentation.theme);
      const image = card.html.match(/<img\b([^>]*)>/);
      assert.ok(image, 'Every card has approved artwork, including card ' + (index + 1));
      const imageAttrs = attributes(image[1]);
      assert.equal(imageAttrs.src, c.kbTopicArtwork(titles[index]));
      assert.ok(Object.values(artwork).includes(imageAttrs.src));
      assert.equal(imageAttrs.alt, '', 'Card images remain decorative');
      assert.equal(element(card, 'button', 'kb-topic-material').attributes.onclick, 'kbClosePanels();kbDetail(' + index + ')');
      assert.equal(element(card, 'button', 'kb-topic-question').attributes.onclick, 'askAboutKb(' + index + ')');
      assert.equal(element(card, 'span', 'kb-topic-number').text, String(index + 1).padStart(2, '0'));
    });
    const columns = c.kbTopicColumns(count);
    assert.ok(Number.isInteger(columns) && columns >= 1 && columns <= 4);
    if (count === 6 || count === 9) assert.equal(columns, 3);
    const grid = [...html.matchAll(/<div\b([^>]*)>/g)].map(match => attributes(match[1])).find(attrs => (attrs.class || '').split(/\s+/).includes('kb-topic-grid'));
    assert.ok(grid, 'Keep the original topic grid');
    assert.match(grid.style || '', new RegExp('--kb-topic-columns\\s*:\\s*' + columns + '(?:\\s*;|\\s*$)'));
    assert.doesNotMatch(html, /src="(?:undefined|null|)"/);
    assert.equal(JSON.stringify(p), before, 'Presentation must not rewrite the knowledge records');
    assert.equal(calls.network + calls.writes, 0);
  });
}

test('unknown and empty titles always use a stable neutral fallback without an index dependency', () => {
  const {c, calls} = boot();
  for (const title of ['未分类专题 XQ-77', '', '   ', null, undefined]) {
    const first = assertPresentation(c, title);
    assert.equal(first.art, 'research');
    assert.equal(c.kbTopicArtwork(title), artwork.research);
    for (let i = 0; i < 3; i++) assert.equal(JSON.stringify(c.kbTopicPresentation(title)), JSON.stringify(first));
  }
  const result = cards(c.kbPage(project(['', '未分类专题 XQ-77', '', '   '])));
  assert.equal(result.length, 4);
  result.forEach(card => assert.ok(attributes(card.html.match(/<img\b([^>]*)>/)[1]).src));
  assert.equal(calls.network + calls.writes, 0);
});

test('a missing category image falls back to the existing research artwork', () => {
  const {c} = boot(Object.freeze({research: artwork.research}));
  for (const title of canonical) assert.equal(c.kbTopicArtwork(title), artwork.research);
});

test('topic titles remain escaped text and never become attributes, elements or executable callbacks', () => {
  const {c} = boot();
  const title = '专题 "><script>throw Error("injected")</script> & <img src=x onerror=boom()> + → ✅';
  const p = project([title]), before = JSON.stringify(p), html = c.kbPage(p), rendered = cards(html);
  assert.equal(rendered.length, 1);
  const heading = element(rendered[0], 'span', 'kb-topic-title');
  assert.equal(heading.text, c._authEscape(title));
  assert.doesNotMatch(html, /<script>|<img src=x|onerror=boom\(\)(?=[">])/);
  assert.equal(element(rendered[0], 'button', 'kb-topic-material').attributes.onclick, 'kbClosePanels();kbDetail(0)');
  assert.equal(element(rendered[0], 'button', 'kb-topic-question').attributes.onclick, 'askAboutKb(0)');
  assert.equal(JSON.stringify(p), before);
});

test('zero cards and column-count boundaries remain deterministic and usable', () => {
  const {c, calls} = boot();
  const p = project([]), before = JSON.stringify(p), html = c.kbPage(p);
  assert.equal(cards(html).length, 0);
  assert.doesNotMatch(html, /undefined|null|NaN|Infinity/);
  assert.match(html, /id="kbWorkspace"/);
  assert.match(html, /class="test-composer"/);
  for (let count = 0; count <= 30; count++) {
    const result = c.kbTopicColumns(count);
    assert.ok(Number.isInteger(result) && result >= 1 && result <= 4, 'Valid CSS column count for ' + count);
    assert.equal(c.kbTopicColumns(count), result);
  }
  assert.equal(JSON.stringify(p), before);
  assert.equal(calls.network + calls.writes, 0);
});
