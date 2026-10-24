/* Integrated presentation layer. Authentication, synchronization and workflow handlers remain authoritative. */
(function () {
  'use strict';
  var esc = window._authEscape;
  var icon = function (name, size) { return window.opsIcon(name, size || 18); };
  var button = function (label, handler, primary) {
    return '<button type="button" class="ops-ui-button' + (primary ? ' is-primary' : '') + '" onclick="' + esc(handler) + '">' + label + '</button>';
  };

  function submittedDemandKeys() {
    return Object.keys(PROJECTS || {}).filter(function (key) {
      return typeof opsIsSubmittedDemand === 'function' && opsIsSubmittedDemand(key, PROJECTS[key]);
    });
  }

  window.opsBrandMark = function () { return '<img class="hxz-ops-avatar" src="/static/skin/brand-girl.png" alt="慧小招">'; };
  window.opsBrandImage = function (kind) { return '/static/skin/illustration-' + (kind === 'collaboration' ? 'connect' : kind === 'research' ? 'report' : 'match') + '.svg'; };

  window.opsTopbarV2 = function () {
    return '<header class="ops-ui-topbar"><a class="ops-ui-brand" href="/" aria-label="慧小招首页">' + opsBrandMark() + '<span>慧小招<span class="ops-ui-brand-caption">城市招商管理工作台</span></span></a>' +
      '<div class="ops-ui-breadcrumb">管理工作台 <span>/</span> <strong>' + esc(opsNavItem(opsTab).label) + '</strong></div>' +
      '<div class="ops-ui-topbar-actions"><a class="hxz-top-link" href="/app">客户工作台 ' + icon('external', 14) + '</a><label class="ops-ui-operator" title="材料上传时的署名；操作权限由当前管理员账号决定">操作人<input id="opsOperatorInput" value="' + esc(getOpsOperator()) + '" placeholder="填写署名" onchange="setOpsOperator(this.value)"></label><button type="button" class="hxz-logout" onclick="logout()" aria-label="退出登录" title="退出登录">' + icon('logout', 18) + '</button></div></header>';
  };

  window.opsTabBar = function () {
    var groups = [
      { label: '工作重点', items: ['overview', 'demands', 'enterprises'] },
      { label: '城市研究', items: ['reports', 'profile', 'rag'] },
      { label: '地区与团队', items: ['invitations', 'users'] }
    ];
    var labels = { demands: '招商项目', enterprises: '企业资源库', invitations: '地区与邀请码' };
    var waiting = submittedDemandKeys().filter(function (k) { return opsIntakeStatus(PROJECTS[k]) === 'submitted'; }).length;
    return '<nav class="ops-ui-sidebar" aria-label="管理端导航"><div class="hxz-sidebar-top"><span class="hxz-sidebar-kicker">招商协同</span><strong>管理工作台</strong></div><div class="hxz-sidebar-scroll">' + groups.map(function (group) {
      return '<div class="ops-ui-nav-group"><div class="ops-ui-nav-label">' + group.label + '</div>' + group.items.map(function (id) {
        var item = opsNavItem(id), active = opsTab === id;
        return '<button class="ops-ui-nav-button' + (active ? ' is-active' : '') + '"' + (active ? ' aria-current="page"' : '') + ' onclick="' + opsHandler('opsGo', id) + '"><span class="ops-ui-nav-icon" aria-hidden="true">' + icon(item.icon, 19) + '</span><span>' + (labels[id] || item.label) + '</span>' + (id === 'demands' && waiting ? '<small class="hxz-nav-count">' + waiting + '</small>' : '') + '</button>';
      }).join('') + '</div>';
    }).join('') + '</div><div class="hxz-sidebar-bottom"><div class="hxz-team-note">' + icon('collaborate', 19) + '<div><strong>AI 匹配 · 真人推进</strong><p>筛选、核验、建联与反馈</p></div></div><a href="/">' + icon('back', 16) + ' 返回慧小招首页</a></div></nav>';
  };

  var modalFocus = [], modalSequence = 0;
  var originalOpenModal = window.openModal, originalCloseModal = window.closeModal;
  window.openModal = function () {
    var returnTo = document.activeElement;
    originalOpenModal.apply(this, arguments);
    var layers = document.querySelectorAll('.modal-layer'), layer = layers[layers.length - 1];
    if (!layer) return;
    var dialog = layer.querySelector('.modal'), title = dialog && dialog.querySelector('header h2');
    if (!dialog) return;
    var titleId = 'hxzModalTitle' + Date.now() + '-' + (++modalSequence);
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('tabindex', '-1');
    if (title) { title.id = titleId; dialog.setAttribute('aria-labelledby', titleId); }
    var close = dialog.querySelector('header>button'); if (close) close.setAttribute('aria-label', '关闭弹窗');
    modalFocus.push({ layer: layer, returnTo: returnTo });
    dialog.focus({ preventScroll: true });
    layer.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { event.preventDefault(); window.closeModal(); return; }
      if (event.key !== 'Tab') return;
      var nodes = Array.from(dialog.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')).filter(function (node) { return node.getClientRects().length; });
      if (!nodes.length) { event.preventDefault(); return; }
      var first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
  };
  window.closeModal = function () {
    var layers = document.querySelectorAll('.modal-layer'), layer = layers[layers.length - 1];
    originalCloseModal();
    var item = modalFocus.pop();
    if (item && item.layer === layer && item.returnTo && item.returnTo.isConnected) item.returnTo.focus({ preventScroll: true });
  };

  // The report reader uses its own dialog instead of openModal. Keep its real
  // document, citations and close action while making keyboard navigation work.
  var originalCityReport = window.opsViewCityReport;
  window.opsViewCityReport = function () {
    var existing = Array.from(document.querySelectorAll('body > [role="dialog"]'));
    var returnTo = document.activeElement;
    var result = originalCityReport.apply(this, arguments);
    var layer = Array.from(document.querySelectorAll('body > [role="dialog"]')).filter(function (node) { return existing.indexOf(node) < 0; }).pop();
    if (!layer) return result;
    var card = layer.firstElementChild, close = layer.querySelector('button[aria-label="关闭报告"]');
    if (!card || !close) return result;
    layer.classList.add('hxz-report-layer'); card.classList.add('hxz-report-dialog');
    card.setAttribute('tabindex', '-1');
    var body = card.querySelector('.report-document');
    if (body && body.parentElement) {
      body.parentElement.setAttribute('tabindex', '0');
      body.parentElement.setAttribute('aria-label', '产业研判报告正文');
    }
    card.focus({ preventScroll: true });
    function restoreFocus() {
      if (!layer.isConnected && returnTo && returnTo.isConnected) returnTo.focus({ preventScroll: true });
    }
    layer.addEventListener('click', restoreFocus);
    layer.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { event.preventDefault(); close.click(); return; }
      if (event.key !== 'Tab') return;
      var nodes = Array.from(card.querySelectorAll('button:not([disabled]),a[href],[tabindex="0"]')).filter(function (node) { return node.getClientRects().length; });
      var first = nodes[0], last = nodes[nodes.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === card)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    return result;
  };

  window.hxzOpsOpenDemand = function (key) {
    var project = PROJECTS[key];
    if (!project || !opsIsSubmittedDemand(key, project)) return;
    window.__opsProjOpen = window.__opsProjOpen || Object.create(null);
    window.__opsCityOpen = window.__opsCityOpen || Object.create(null);
    window.__opsProjOpen[key] = true;
    window.__opsCityOpen[project.city] = true;
    OPS_UI.demands.query = ''; OPS_UI.demands.city = ''; OPS_UI.demands.status = 'all';
    window.opsGo('demands');
  };

  window.opsOverview = function () {
    var projects = submittedDemandKeys();
    var reports = opsReportRows(), statuses = { submitted: 0, processing: 0, needs_info: 0, feedback: 0 }, checks = 0;
    projects.forEach(function (k) { statuses[opsIntakeStatus(PROJECTS[k])]++; checks += opsVerificationRequests(PROJECTS[k]).filter(function (c) { return c.verificationRequest.status !== 'completed'; }).length; });
    var attention = reports.filter(function (r) { return r.submissionBlocked || ['failed', 'blocked', 'cancelled', 'paused'].indexOf(r.status) !== -1; });
    var running = reports.filter(function (r) { return !r.submissionBlocked && ['pending', 'running', 'pause_requested'].indexOf(r.status) !== -1; }).length;
    var firstDemand = projects.filter(function (k) { return opsIntakeStatus(PROJECTS[k]) === 'submitted'; })[0];
    var hero = '<section class="hxz-ops-hero"><div><span class="hxz-section-kicker">从产业研判，到项目对接</span><h2>把匹配线索，<br>推进成清楚的下一步。</h2><p>AI 辅助匹配产业链企业，真人招商团队跟进核验、建联与落地协调。</p><div class="hxz-hero-actions">' + button('处理招商项目 ' + icon('next', 16), "opsGo('demands')", true) + '<span>需求有承办 · 进度有反馈</span></div></div><div class="hxz-ops-hero-art"><img src="/static/skin/illustration-connect.svg" alt="城市与企业协作示意"><span>城市需求 × 企业资源 × 专业团队</span></div></section>';
    var stats = [['待受理需求', statuses.submitted, '及时明确承办人', 'demands', 'demand'], ['待处理企业核验', checks, '核对适配与依据', 'demands', 'verification-pending'], ['报告进行中', running, attention.length + ' 项报告需处理', 'reports', 'report'], ['企业资源', OPS_ENT.length, '按具体需求筛选匹配', 'enterprises', 'enterprise']];
    var metrics = '<div class="ops-ui-stats">' + stats.map(function (m) { return '<button class="ops-ui-stat" onclick="' + opsHandler('opsGo', m[3]) + '"><span class="ops-brand-stat-label">' + icon(m[4], 18) + m[0] + '</span><strong class="ops-ui-stat-value">' + m[1] + '<small>' + (m[3] === 'enterprises' ? '家' : '项') + '</small></strong><span class="ops-ui-muted">' + m[2] + '</span></button>'; }).join('') + '</div>';
    var tasks = [];
    if (firstDemand) tasks.push({ tone: 'is-amber', tag: '待受理', title: PROJECTS[firstDemand].demandTitle || PROJECTS[firstDemand].topic, detail: PROJECTS[firstDemand].city + ' · 明确负责人、下一步与回复', run: "hxzOpsOpenDemand(" + JSON.stringify(firstDemand) + ")" });
    if (checks) tasks.push({ tone: 'is-blue', tag: '待核验', title: checks + ' 家企业等待资料核验', detail: '逐家核对产品适配、合作条件与来源依据', run: "opsGo('demands')" });
    if (attention.length) tasks.push({ tone: 'is-rose', tag: '需处理', title: (attention[0].city || '城市') + '的报告任务待处理', detail: attention[0].status === 'paused' ? '报告已暂停，可查看进度后继续生成' : attention[0].failReason || '检查资料与任务状态后继续处理', run: "opsGo('reports')" });
    var todo = '<section class="ops-ui-card hxz-todo-card"><div class="ops-ui-card-head"><div><span class="hxz-section-kicker">先处理这些事</span><h2>重点待办</h2></div><span class="hxz-count-pill">' + tasks.length + ' 类事项</span></div><div class="hxz-todo-list">' + (tasks.length ? tasks.map(function (t) { return '<button class="hxz-todo-row" onclick="' + esc(t.run) + '"><span class="hxz-task-tag ' + t.tone + '">' + t.tag + '</span><span class="hxz-todo-copy"><strong>' + esc(t.title) + '</strong><small>' + esc(t.detail) + '</small></span>' + icon('next', 17) + '</button>'; }).join('') : opsEmpty('当前没有待处理事项', '可继续完善城市材料与企业资料。')) + '</div></section>';
    var stages = [['submitted', '待受理', '接收需求'], ['processing', '处理中', '匹配与核验'], ['needs_info', '待客户补充', '补足条件'], ['feedback', '已反馈', '沟通下一步']];
    var progress = '<section class="ops-ui-card hxz-stage-card"><div class="ops-ui-card-head"><div><span class="hxz-section-kicker">项目推进</span><h2>让每一步都有着落</h2></div></div><div class="hxz-stage-list">' + stages.map(function (s, i) { return '<button class="hxz-stage-row" onclick="opsGo(\'demands\');opsSetReceivingFilter(\'' + s[0] + '\')"><i>' + (i + 1) + '</i><span><strong>' + s[1] + '</strong><small>' + s[2] + '</small></span><b>' + statuses[s[0]] + '</b></button>'; }).join('') + '</div></section>';
    var latest = reports.slice().sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); }).slice(0, 4);
    var reportList = '<section class="ops-ui-card hxz-latest-reports"><div class="ops-ui-card-head"><div><span class="hxz-section-kicker">研究与底稿</span><h2>近期报告任务</h2></div>' + button('查看全部 ' + icon('next', 14), "opsGo('reports')") + '</div><div class="ops-ui-recent">' + (latest.length ? latest.map(function (r) { return '<button class="ops-ui-recent-row" onclick="opsGo(\'reports\')"><span><strong>' + esc(r.city) + '</strong><small>' + esc(r.id) + ' · ' + opsDate(r.ts) + '</small></span><span class="ops-ui-badge ' + (opsReportLabel(r) === '需处理' ? 'is-danger' : r.status === 'done' ? 'is-on' : 'is-muted') + '">' + opsReportLabel(r) + '</span></button>'; }).join('') : opsEmpty('暂无报告任务', '在报告任务中选择城市并提交申请。')) + '</div></section>';
    var steps = [['rag', 'report', '城市有底稿', '把材料、事实与来源整理清楚'], ['enterprises', 'match', 'AI 辅助匹配', '结合产业链方向筛选候选企业'], ['demands', 'connect', '真人推进对接', '核验、建联与落地协调持续跟进']];
    var flow = '<div class="hxz-ops-flow">' + steps.map(function (s, i) { return '<button onclick="' + opsHandler('opsGo', s[0]) + '"><img src="/static/skin/illustration-' + s[1] + '.svg" alt=""><span><small>0' + (i + 1) + '</small><strong>' + s[2] + '</strong><p>' + s[3] + '</p></span>' + icon('next', 16) + '</button>'; }).join('') + '</div>';
    return '<div class="ops-ui-page hxz-overview">' + opsPageHead('运营总览', '聚焦待办、分清责任，让城市需求与企业资源持续协同。', '<span class="hxz-workspace-state"><i></i> 团队协同工作区</span>') + hero + metrics + '<div class="hxz-overview-grid">' + todo + progress + '</div>' + reportList + flow + '</div>';
  };

  var originalReceiving = window.opsReceivingPanel;
  window.opsReceivingPanel = function () {
    var html = originalReceiving.apply(this, arguments), template = document.createElement('template');
    if (!template.content) return html;
    template.innerHTML = html;
    var panel = template.content.querySelector('.ops-receiving-panel');
    if (!panel) return template.innerHTML;
    var grid = document.createElement('div'), context = document.createElement('section'), action = document.createElement('section');
    grid.className = 'hxz-receiving-grid'; context.className = 'hxz-receiving-context'; action.className = 'hxz-receiving-action';
    context.innerHTML = '<h4 class="hxz-detail-step"><span>01</span> 核对需求与当前进度</h4>';
    action.innerHTML = '<h4 class="hxz-detail-step"><span>02</span> 安排承办与下一步</h4>';
    Array.from(panel.children).forEach(function (node) {
      if (node.classList.contains('ops-receiving-head')) return;
      (node.matches('.ops-receiving-form,.ops-receiving-submit') ? action : context).appendChild(node);
    });
    grid.append(context, action); panel.appendChild(grid);
    return template.innerHTML;
  };

  var originalEntList = window.opsEntListV2;
  window.opsEntListV2 = function () {
    var html = originalEntList.apply(this, arguments), template = document.createElement('template');
    if (!template.content) return html;
    template.innerHTML = html;
    var grid = template.content.firstElementChild;
    if (!grid) return template.innerHTML;
    grid.className = 'hxz-enterprise-grid'; grid.removeAttribute('style');
    Array.from(grid.children).forEach(function (card) {
      card.classList.add('hxz-enterprise-card'); card.removeAttribute('style');
      var actions = card.lastElementChild; if (!actions) return; actions.className = 'hxz-enterprise-actions'; actions.removeAttribute('style');
      var primary = actions.querySelector('[onclick^="opsEntManualPushModal"]');
      if (primary) { primary.className = 'ops-ui-button is-primary'; primary.removeAttribute('style'); actions.prepend(primary); }
      Array.from(actions.querySelectorAll('button')).forEach(function (b) {
        if (b === primary) return;
        b.removeAttribute('style'); b.className = 'ops-ui-button' + ((b.getAttribute('onclick') || '').indexOf('opsEntDelete') === 0 ? ' hxz-danger-text' : '');
      });
    });
    return template.innerHTML;
  };

  var originalDemandResults = window.opsDemandResults;
  window.opsDemandResults = function () {
    var html = originalDemandResults.apply(this, arguments), template = document.createElement('template');
    if (!template.content) return html;
    template.innerHTML = html;
    template.content.querySelectorAll('[onclick^="toggleOpsCity("]').forEach(function (node) { node.classList.add('hxz-city-group-head'); });
    template.content.querySelectorAll('[onclick^="toggleOpsProj("]').forEach(function (node) { node.classList.add('hxz-project-head'); });
    return template.innerHTML;
  };

  window.opsEmpty = function (title, note, scene) {
    return '<div class="ops-ui-empty"><img class="hxz-empty-art" src="/static/skin/illustration-' + (scene === 'collaboration' ? 'connect' : 'report') + '.svg" alt=""><strong>' + esc(title) + '</strong><p>' + esc(note || '') + '</p></div>';
  };

  // This is a display alias for the standard classification. Option values,
  // stored topic keys, source documents and report bodies retain their identity.
  var legacyPolicyTopic = '政策、规划与领导关注';
  var policyTopicLabel = '政策、规划与国家战略';
  function aliasTopicOptions(root, selector) {
    root.querySelectorAll(selector).forEach(function (option) {
      if (option.value === legacyPolicyTopic) option.textContent = policyTopicLabel;
    });
  }
  var originalBaseLayout = window.ragBaseVsSupportLayout;
  window.ragBaseVsSupportLayout = function () {
    var html = originalBaseLayout.apply(this, arguments), template = document.createElement('template');
    if (!template.content) return html;
    template.innerHTML = html;
    template.content.querySelectorAll('div[style*="max-height:420px"] > div > div > span:nth-child(2)').forEach(function (label) {
      if (label.textContent === legacyPolicyTopic) label.textContent = policyTopicLabel;
    });
    return template.innerHTML;
  };
  var originalUploadPanel = window.ragUploadPanel;
  window.ragUploadPanel = function () {
    var html = originalUploadPanel.apply(this, arguments), template = document.createElement('template');
    if (!template.content) return html;
    template.innerHTML = html;
    aliasTopicOptions(template.content, '#ragUpTopic option');
    return template.innerHTML;
  };
  var originalCommitModal = window.ragCommitModal;
  window.ragCommitModal = function () {
    var result = originalCommitModal.apply(this, arguments);
    aliasTopicOptions(document, '#ragCmTopic option');
    return result;
  };

  window.opsLoginPage = function () {
    return '<main class="ops-login-shell" aria-label="管理端登录"><div class="ops-login-layout"><aside class="ops-login-brand"><a class="ops-login-brandline" href="/">' + opsBrandMark() + '<div><strong>慧小招</strong><span>城市招商 · 产业协同</span></div></a><div class="ops-login-intro"><p class="ops-login-eyebrow">AI 匹配 · 真人推进</p><p class="ops-login-title">让每一条招商线索，<br>都有清楚的下一步。</p><p class="ops-login-description">产业研判、企业匹配与团队协同，<br>一起服务城市招商的日常工作。</p></div><img class="ops-login-visual" src="/static/skin/illustration-connect.svg" alt="城市与企业资源协作示意"><div class="ops-login-brandfoot">城市需求 · 企业资源 · 专业团队</div></aside><section class="ops-login-panel" aria-labelledby="opsLoginTitle"><div class="ops-login-form"><span class="ops-login-badge">' + icon('security', 15) + '管理工作台</span><h1 id="opsLoginTitle">欢迎回来</h1><p class="ops-login-subtitle">登录后，继续处理报告、企业核验与项目协作。</p><div class="ops-login-fields"><label class="ops-login-field" for="opsLoginUser"><span>管理员账号</span><input id="opsLoginUser" type="text" autocapitalize="none" spellcheck="false" autocomplete="username" placeholder="输入管理员账号" aria-describedby="opsLoginError"></label><label class="ops-login-field" for="opsLoginPwd"><span>登录密码</span><input id="opsLoginPwd" type="password" autocomplete="current-password" placeholder="输入密码" aria-describedby="opsLoginError" onkeydown="if(event.key===&quot;Enter&quot;)opsLogin()"></label></div><p id="opsLoginError" class="ops-login-error" role="alert" aria-live="polite"></p><button type="button" class="ops-login-submit" onclick="opsLogin()"><span>进入管理工作台</span>' + icon('next', 18) + '</button><div class="ops-login-switch"><span>政府 / 园区团队</span><a href="/app">前往客户工作台 ' + icon('next', 15) + '</a></div><a class="hxz-login-home" href="/">返回慧小招首页</a><p class="ops-login-footnote">本入口面向已授权的管理人员。</p></div></section></div></main>';
  };

})();
