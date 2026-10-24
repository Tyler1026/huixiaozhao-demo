/* Production presentation adapter. Authentication, storage, AI, citations and
 * demand submission continue to use the existing client implementations. */
(function () {
  'use strict';
  if (window.hxzClientSkin) return;
  // This is a progressive DOM enhancement. Keep the original application
  // available in hosts without HTML template support (including headless
  // state-only consumers); never install partially functional renderers.
  if (typeof document === 'undefined' || typeof document.createElement !== 'function' || !document.createElement('template').content) return;
  var legacy = {
    mainPane: window.mainPane, loginPage: window.loginPage,
    registerPage: window.registerPage, setupPage: window.setupPage,
    openModal: window.openModal, render: window.render
  };
  var registeredStep = 0;
  var initialAuthScreen = new URLSearchParams(location.search).get('screen');
  var moduleNames = {
    home: '需求与建联', docking: '企业对接', report: 'AI 匹配研判',
    knowledge: '城市智库', settings: '账号与协作', subwork: '项目推进'
  };

  function escape(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function fragment(html) {
    var template = document.createElement('template');
    template.innerHTML = html;
    return template;
  }
  function textAt(root, selector, text) {
    var element = root.querySelector(selector);
    if (element) element.textContent = text;
  }
  var topicLabelSelector = '.kb-topic-title, #kbDetailTitle, #kbScopeLabel, #kbTopicHintText';
  function applyTopicLabels(root) {
    // This is a display alias for the existing category. Stored topic keys,
    // material titles, citations and report/chat body text remain untouched.
    var oldLabel = '政策、规划与领导关注', newLabel = '政策、规划与国家战略';
    var labels = Array.from(root.querySelectorAll(topicLabelSelector));
    if (root.matches && root.matches(topicLabelSelector)) labels.unshift(root);
    labels.forEach(function (label) {
      Array.from(label.childNodes).forEach(function (node) {
        if (node.nodeType === 3 && node.nodeValue.trim() === oldLabel) node.nodeValue = node.nodeValue.replace(oldLabel, newLabel);
      });
    });
    root.querySelectorAll('.kb-topic-material[aria-label], .kb-topic-question[aria-label]').forEach(function (button) {
      var label = button.getAttribute('aria-label');
      if (label === '查看' + oldLabel + '资料') button.setAttribute('aria-label', '查看' + newLabel + '资料');
      if (label === '围绕' + oldLabel + '提问') button.setAttribute('aria-label', '围绕' + newLabel + '提问');
    });
  }
  function avatar(size) {
    return '<img src="/static/skin/brand-girl.png" data-brand-mark="huixiaozhao" alt="" width="' + size + '" height="' + size + '">';
  }
  function icon(name) {
    return typeof window.hxzIcon === 'function' && window.hxzIcons && window.hxzIcons.has(name)
      ? window.hxzIcon(name, { size: 19, strokeWidth: 1.75, className: 'client-brand-icon' })
      : '<span class="client-nav-dot" aria-hidden="true"></span>';
  }
  function pathMarkup(active) {
    return '<nav class="client-workflow" aria-label="招商工作路径">' + [
      ['knowledge', '01', '城市智库'], ['report', '02', 'AI 匹配研判'], ['home', '03', '需求与建联']
    ].map(function (item) {
      return '<button type="button"' + (item[0] === active ? ' aria-current="step"' : '') +
        ' onclick="go(\'' + item[0] + '\')"><span>' + item[1] + '</span>' + item[2] + '</button>';
    }).join('<i aria-hidden="true">→</i>') + '</nav>';
  }

  window.brandLogo = function () { return '/static/skin/brand-girl.png'; };
  window.topbar = function (p) {
    var identity=currentAccountIdentity();
    var label = moduleNames[window.view] || '招商工作区';
    var topic = window.view === 'home' || window.view === 'docking' ? '招商对接工作区' : p.topic;
    return '<header class="topbar client-topbar"><a class="brand-block" href="/" aria-label="慧小招首页">' + avatar(40) +
      '<div><strong>慧小招</strong><span>AI 匹配 · 真人落地</span></div></a>' +
      '<div class="client-context"><span>招商工作区</span><i>/</i><strong>' + escape(label) +
      '</strong><small title="' + escape(p.org) + '">' + escape(p.city) + ' · <span id="topbarTopic">' + escape(topic) + '</span></small></div>' +
      '<div class="client-top-actions"><a href="/">首页</a><a href="/ops">运营端</a>' +
      '<div class="client-notification"><button class="client-icon-button" type="button" onclick="toggleNotif(event)" aria-label="通知中心">' +
      icon('notification') + '<b id="reminderUnreadBadge"'+(unreadCount()?'':' hidden')+'>' + unreadCount() + '</b></button>' +
      '<div id="notifPanel" class="client-notification-panel" style="display:none" onclick="event.stopPropagation()">' + notifList() + '</div></div>' +
      '<button class="client-account" type="button" onclick="go(\'settings\')" title="' + escape(identity.user+' · '+identity.roleLabel) + '">' +
      escape(identity.name) + '</button><button class="client-logout" type="button" onclick="logout()">退出</button></div></header>';
  };
  window.sidebar = function () {
    var readiness = kbReadiness();
    function item(id, title, description, symbol) {
      var active = window.view === id || (id === 'home' && window.view === 'docking');
      return '<button type="button" class="nav-item' + (active ? ' active' : '') + '"' +
        (active ? ' aria-current="page"' : '') + ' onclick="go(\'' + id + '\')">' + icon(symbol) +
        '<span class="nav-copy"><strong>' + title + '</strong><small>' + description + '</small></span>' +
        (isLocked(id) ? '<span class="client-lock" title="请先完善工作区资料">待完善</span>' : '') + '</button>';
    }
    return '<aside class="sidebar client-sidebar" aria-label="客户侧导航">' +
      '<nav class="nav-list client-navigation"><div class="client-nav-group"><p>招商工作流程</p>' +
      item('knowledge', '城市智库', '读懂城市 · 完善研判依据', 'knowledge-library') +
      item('report', 'AI 匹配研判', '分析缺口 · 明确招引方向', 'industry-analysis') +
      item('home', '需求与建联', '提交需求 · 真人建联跟进', 'investment-docking') + '</div>' +
      '<div class="client-nav-group"><p>账号与协作</p>' + item('settings', '账号与协作', '工作区 · 偏好 · 提醒', 'settings') + '</div></nav>' +
      '<button type="button" class="client-create-demand" onclick="openDirectDemandComposer()"><span aria-hidden="true">＋</span> 已有需求？直接提交</button>' +
      '<div class="client-sidebar-bottom"><div id="kbProgressBox">' + kbProgressInner(readiness) + '</div>' +
      '<div class="client-service-note"><strong>AI 研发 × 招商落地</strong><p>匹配有依据，建联有人跟进。</p></div>' +
      '<div class="system-status"><span></span>资料与进度以当前工作区为准</div></div></aside>';
  };

  window.mainPane = function (p) {
    var template = fragment(legacy.mainPane.apply(this, arguments)), content = template.content;
    var active = window.view === 'docking' ? 'home' : window.view;
    var header = content.querySelector('.kb-workbench-header, .industry-header, .docking-header, .page-header');
    if (header) {
      header.classList.add('client-page-header');
      if (active !== 'settings') header.insertAdjacentHTML('afterend', pathMarkup(active));
    }
    if (active === 'knowledge') {
      textAt(content, '.kb-heading .eyebrow', p.city + ' · 城市智库');
      textAt(content, '.kb-heading h1', '城市智库');
      textAt(content, '#kbOverviewTitle', '城市知识全景');
      textAt(content, '.brand-slogan-lead', '读懂城市，');
      textAt(content, '.brand-slogan-result', '让招引更有方向。');
      textAt(content, '[data-kb-topic="0"] .kb-topic-material p', '整合产业链结构、关键环节与招引需求');
      textAt(content, '#kbWelcome h2', '把城市资料，变成研判依据。');
      textAt(content, '#kbWelcome p', '先查阅、补充城市资料，围绕产业与园区条件提问；再进入 AI 匹配研判，分析缺口并明确招引方向。');
      var welcome = content.querySelector('#kbWelcome');
      if (welcome) {
        welcome.insertAdjacentHTML('afterbegin', '<img class="client-welcome-art" src="/static/skin/illustration-match.svg" alt="" width="148" height="104">');
        welcome.insertAdjacentHTML('beforeend', '<button type="button" class="docking-button is-quiet" onclick="go(\'report\')">下一步：AI 匹配研判 →</button>');
      }
    } else if (active === 'report') {
      textAt(content, '.industry-kicker', '基于城市智库 · 明确招引方向');
      textAt(content, '.industry-heading', 'AI 匹配研判');
      textAt(content, '.industry-header p', '基于城市智库研判产业链缺口、招引方向与目标企业，选择合适的建议形成招商需求。');
      var mark = content.querySelector('.industry-header-mark');
      if (mark) {
        mark.className = 'client-header-art';
        mark.innerHTML = '<img src="/static/skin/illustration-report.svg" alt="" width="122" height="82">';
      }
    } else if (active === 'home') {
      textAt(content, '.docking-header .docking-kicker', '需求受理 · 企业核验 · 建联跟进');
      textAt(content, '.docking-header h1', '需求与建联');
      textAt(content, '.docking-header p', '把研判方向转为具体需求，查看受理反馈与候选企业，由慧小招招商团队推进建联与落地。');
      textAt(content, '.docking-header-actions .is-quiet', '查看 AI 匹配研判 ↗');
      var filters = content.querySelector('.docking-filters');
      if (filters) [['verification', '待核验'], ['followed', '有跟进']].forEach(function (filter) {
        if (filters.querySelector('[data-filter="' + filter[0] + '"]')) return;
        var button = document.createElement('button');
        button.type = 'button'; button.dataset.filter = filter[0]; button.textContent = filter[1];
        button.setAttribute('onclick', "dockingSetFilter('" + filter[0] + "')");
        button.setAttribute('aria-pressed', String(dockingViewState().filter === filter[0]));
        if (dockingViewState().filter === filter[0]) button.className = 'is-active';
        filters.appendChild(button);
      });
      content.querySelectorAll('.docking-empty').forEach(function (empty) {
        var firstDemand = empty.matches('#dockingWorkspace > .docking-empty');
        if (firstDemand) {
          empty.classList.add('client-demand-empty');
          textAt(empty, '.docking-kicker', 'AI 研判 → 提交需求 → 真人建联');
          textAt(empty, 'h2', '把研判方向，推进为招商需求');
          textAt(empty, 'p', '先在 AI 匹配研判中选择招引方向并形成需求；已有明确诉求，也可直接提交。提交后，在这里查看受理反馈与建联进度。');
          var primary = empty.querySelector('button[onclick="openDirectDemandComposer()"]');
          if (primary) {
            primary.textContent = '查看 AI 匹配研判 →';
            primary.setAttribute('onclick', "go('report')");
            primary.insertAdjacentHTML('afterend', '<button type="button" class="docking-button is-quiet" onclick="openDirectDemandComposer()">已有需求，直接提交</button>');
          }
        }
        empty.insertAdjacentHTML('afterbegin', firstDemand
          ? '<img class="client-demand-empty-art" src="/static/skin/auth-city-connect.png" alt="" width="280" height="210">'
          : '<img class="client-empty-art" src="/static/skin/illustration-connect.svg" alt="" width="190" height="130">');
      });
    } else if (active === 'settings') {
      textAt(content, '.page-header .eyebrow', '工作区与成员协作');
      textAt(content, '.page-header h1', '账号与协作');
      textAt(content, '.page-header p', '核对账号与工作区信息，维护招商偏好及进度提醒。');
      content.querySelectorAll('.settings-section').forEach(function (section, index) {
        section.dataset.section = String(index + 1).padStart(2, '0');
      });
    }
    applyTopicLabels(content);
    return template.innerHTML;
  };

  function authShell(kind, form) {
    var register = kind === 'register';
    return '<main class="client-auth"><section class="client-auth-story"><a class="client-auth-brand" href="/">' + avatar(48) +
      '<strong>慧小招</strong><span>AI 招商匹配 · 落地服务</span></a>' +
      '<div class="client-auth-intro"><p class="client-eyebrow">AI 研发团队 × 慧小招招商团队</p><h1>AI 精准招商，<br>真人建联落地。</h1>' +
      '<p>先通过城市智库读懂本地产业与园区条件，再由 AI 匹配研判明确招引方向。形成招商需求后，慧小招招商团队跟进企业建联与落地。</p>' +
      '<img class="client-auth-art" src="/static/skin/auth-city-connect.png" alt="" width="1448" height="1086">' +
      '<div class="client-auth-proof"><span>公网企业与人员关系数据</span><span>十多年积累 · 上万家企业数据</span></div></div><a class="client-back-home" href="/">← 返回首页</a></section>' +
      '<section class="client-auth-panel"><div class="client-auth-card"><p class="client-eyebrow">' + (register ? '加入你的招商团队' : '欢迎回到招商工作区') +
      '</p><h2>' + (register ? '注册并加入团队' : '登录慧小招') + '</h2><p class="client-auth-desc">' +
      (register ? '使用邀请码关联城市工作区，再完善账号与成员信息。' : '使用账号和密码登录。首次加入团队，请使用邀请码注册。') +
      '</p>' + form + '<a class="client-ops-login" href="/ops">进入运营端登录</a></div></section></main>';
  }
  window.loginPage = function () {
    var template = fragment(legacy.loginPage.apply(this, arguments));
    var input = template.content.querySelector('#loginUser');
    if (!input || !input.closest('label')) return template.innerHTML;
    var form = input.closest('label').parentElement;
    form.className = 'client-auth-fields'; form.removeAttribute('style');
    textAt(form, 'button[onclick="doLogin()"]', '登录工作区');
    input.placeholder = '输入登录账号';
    return authShell('login', form.outerHTML);
  };
  window.registerPage = function () {
    registeredStep = 0;
    var template = fragment(legacy.registerPage.apply(this, arguments));
    function field(id) {
      var input = template.content.querySelector('#' + id);
      return input && input.closest('label');
    }
    var groups = [
      ['邀请与工作区', ['regInviteCode', 'regCity']],
      ['登录账号', ['regUser', 'regPwd']],
      ['成员信息', ['regName', 'regPhone', 'regWechat', 'regOrg', 'regDept', 'regTitle']]
    ];
    if (!groups.every(function (group) { return group[1].every(field); })) return template.innerHTML;
    var form = '<nav class="client-form-steps" aria-label="注册步骤">' + groups.map(function (group, index) {
      return '<button type="button" data-register-tab="' + index + '"' + (index === 0 ? ' aria-current="step"' : '') +
        ' onclick="hxzClientSkin.registerStep(' + index + ')"><b>' + (index + 1) + '</b>' + group[0] + '</button>';
    }).join('') + '</nav><div class="client-auth-fields client-register-fields">' + groups.map(function (group, index) {
      var hint = template.content.querySelector('#regInviteHint');
      return '<fieldset data-register-step="' + index + '"' + (index ? ' hidden' : '') + '><legend>' + group[0] +
        '</legend><div class="client-form-grid">' + group[1].map(function (id) { return field(id).outerHTML; }).join('') +
        '</div>' + (index === 0 && hint ? hint.outerHTML : '') + '</fieldset>';
    }).join('') + template.content.querySelector('#regErr').outerHTML +
      '<div class="client-form-actions"><button id="clientRegisterPrevious" type="button" class="secondary-button" onclick="hxzClientSkin.registerStep(hxzClientSkin.currentRegisterStep()-1)" hidden>上一步</button>' +
      '<button id="clientRegisterNext" type="button" class="primary-button" onclick="hxzClientSkin.registerStep(hxzClientSkin.currentRegisterStep()+1)">下一步</button>' +
      '<button id="clientRegisterSubmit" type="button" class="primary-button" onclick="doRegister()" hidden>注册并进入工作区</button></div>' +
      '<button class="client-text-button" type="button" onclick="regBack()">已有账号？返回登录</button></div>';
    return authShell('register', form);
  };
  window.setupPage = function () {
    var template = fragment(legacy.setupPage.apply(this, arguments));
    var wrap = template.content.querySelector('#onboardingWrap');
    if (!wrap) return template.innerHTML;
    wrap.classList.add('client-setup');
    var heading = wrap.querySelector('h1'), mark = heading && heading.previousElementSibling;
    if (mark) { mark.removeAttribute('style'); mark.className = 'client-setup-avatar'; mark.innerHTML = avatar(64); }
    wrap.insertAdjacentHTML('afterbegin', '<a class="client-setup-home" href="/">← 慧小招首页</a>');
    return template.innerHTML;
  };

  function enhanceModal() {
    applyTopicLabels(document);
    document.querySelectorAll('.modal').forEach(function (modal) {
      modal.classList.add('client-modal');
      var body = modal.querySelector('.modal-body');
      if (body && body.querySelector('#directDemandTitle, #industryDemandTitle') && !body.querySelector('.client-demand-steps')) {
        body.insertAdjacentHTML('afterbegin', '<div class="client-demand-steps"><span class="is-current">1 说明需求</span><i>→</i><span>2 提交受理</span><i>→</i><span>3 查看进度</span></div>');
        var condition = body.querySelector('label[for="directDemandConditions"], label[for="industryDemandConditions"]');
        if (condition) condition.insertAdjacentHTML('beforebegin', '<h3 class="client-form-section-title">承接条件与联系信息</h3>');
      }
    });
    document.querySelectorAll('[title="显示/隐藏密码"]').forEach(function (element) {
      element.tabIndex = 0; element.setAttribute('role', 'button'); element.setAttribute('aria-label', '显示或隐藏密码');
      element.onkeydown = function (event) {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); element.click(); }
      };
    });
  }
  window.openModal = function () {
    var result = legacy.openModal.apply(this, arguments);
    enhanceModal();
    return result;
  };
  window.render = function () {
    // Only the two public authentication entry points affect an unauthenticated
    // view. A confirmed session always retains the existing application route.
    if (initialAuthScreen && (window._authState === 'anonymous' || window._authState === 'ready')) {
      if (!window.AUTH && (initialAuthScreen === 'login' || initialAuthScreen === 'register')) window.view = initialAuthScreen;
      initialAuthScreen = null;
    }
    var result = legacy.render.apply(this, arguments);
    enhanceModal();
    return result;
  };
  Object.keys(legacy.render).forEach(function (key) { window.render[key] = legacy.render[key]; });

  window.hxzClientSkin = Object.freeze({
    currentRegisterStep: function () { return registeredStep; },
    registerStep: function (next) {
      next = Math.max(0, Math.min(2, registeredStep + 1, Number(next)));
      if (!Number.isInteger(next)) return;
      var current = document.querySelector('[data-register-step="' + registeredStep + '"]');
      if (!current) return;
      if (next > registeredStep) {
        var empty = Array.from(current.querySelectorAll('input:not(:disabled)')).find(function (input) { return !input.value.trim(); });
        if (empty) { regErr('请先填写当前步骤的信息。'); empty.focus(); return; }
      }
      regErr(''); registeredStep = next;
      document.querySelectorAll('[data-register-step]').forEach(function (section) { section.hidden = Number(section.dataset.registerStep) !== next; });
      document.querySelectorAll('[data-register-tab]').forEach(function (button) {
        if (Number(button.dataset.registerTab) === next) button.setAttribute('aria-current', 'step');
        else button.removeAttribute('aria-current');
      });
      document.getElementById('clientRegisterPrevious').hidden = next === 0;
      document.getElementById('clientRegisterNext').hidden = next === 2;
      document.getElementById('clientRegisterSubmit').hidden = next !== 2;
      var input = document.querySelector('[data-register-step="' + next + '"] input:not(:disabled)');
      if (input) input.focus();
    }
  });
  document.documentElement.classList.add('client-enhanced');
  if (typeof MutationObserver === 'function') {
    var presentationSelector = '.modal, .kb-detail-overlay, .kb-topic-card, ' + topicLabelSelector;
    new MutationObserver(function (records) {
      var relevant = records.some(function (record) {
        if (record.target.matches && record.target.matches(topicLabelSelector)) return true;
        return Array.from(record.addedNodes).some(function (node) {
          return node.nodeType === 1 && ((node.matches && node.matches(presentationSelector)) || (node.querySelector && node.querySelector(presentationSelector)));
        });
      });
      if (relevant) enhanceModal();
    }).observe(document.body, { childList: true, subtree: true });
  }
  // The original bootstrap has already rendered before this adapter is loaded.
  // Re-enter its own renderer once; all authentication and stream guards remain
  // active, and subsequent renders keep their normal cache/state semantics.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { window.render(); }, { once: true });
  else window.render();
}());
