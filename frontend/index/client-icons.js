/*
 * Qingxu client icon adapter. Load brand-icons.js before this file.
 * The adapter changes decoration only: controls, handlers, labels and layout
 * containers remain the ones rendered by the original client.
 */
(function () {
  'use strict';

  if (window.hxzClientIcons || typeof window.hxzIcon !== 'function' ||
      !window.hxzIcons || typeof window.hxzIcons.has !== 'function' ||
      typeof window.MutationObserver !== 'function' || typeof window.requestAnimationFrame !== 'function') return;

  var observer;
  var frame = 0;
  var applying = false;
  var observedRoot;
  var contentSelector = '.industry-prose, #reportContent, [id^="hrpt-body-"], ' +
    '.industry-confirm-text, .chain-node-drawer-content, .kb-detail-richtext, #kbConv';
  var navIcons = {
    knowledge: 'city-library',
    report: 'industry-analysis',
    home: 'investment-docking',
    docking: 'investment-docking',
    settings: 'settings'
  };
  var glyphIcons = {
    '📚': 'city-library', '📝': 'report', '🏙': 'city', '🏛': 'public-service',
    '🏢': 'enterprise', '👤': 'account', '💰': 'funding', '📄': 'document',
    '📊': 'industry-analysis', '📋': 'demand', '📎': 'attachment',
    '📤': 'download', '📥': 'upload', '🔄': 'refresh', '🔎': 'search',
    '🔍': 'search', '🔑': 'permissions', '🔒': 'permissions',
    '🔔': 'notification', '🔗': 'citation', '🕒': 'traceability',
    '🗄': 'resource', '🛰': 'citation', '🤝': 'investment-docking',
    '🧩': 'matching', '🧭': 'target', '🧾': 'report', '🎯': 'target',
    '🚀': 'next', '📌': 'favorites', '✨': 'analysis', '⚙': 'settings',
    '⚠': 'warning', 'ℹ': 'info', '✍': 'edit', '✎': 'edit',
    '✅': 'success', '✓': 'success', '✔': 'success', '◔': 'loading',
    '➕': 'add', '+': 'add', '＋': 'add', '➜': 'next', '➤': 'next',
    '→': 'next', '←': 'back', '↗': 'external', '↪': 'logout', '↑': 'collapse',
    '↓': 'expand', '‹': 'back', '›': 'next', '⋮': 'more',
    '⌂': 'workspace', '▤': 'evidence', '×': 'error', '✕': 'error',
    '⬇': 'download', 'ⓘ': 'info', '▶': 'next', '▼': 'expand',
    '▾': 'expand', '▴': 'collapse', '🏭': 'industry', '🚗': 'transportation',
    '🚘': 'transportation', '⚡': 'technology', '🔬': 'research',
    '🧪': 'research', '💻': 'technology', '🌾': 'industry', '🌱': 'industry',
    '🍄': 'industry', '🔧': 'capability', '✈': 'transportation', '💡': 'opportunity'
  };

  function normalizedGlyph(value) {
    return String(value || '').replace(/[\uFE0E\uFE0F]/g, '').trim();
  }

  function iconNode(key, size) {
    if (!window.hxzIcons.has(key)) return null;
    var box = document.createElement('span');
    box.innerHTML = window.hxzIcon(key, {
      size: size || 18,
      strokeWidth: 1.75,
      className: 'client-brand-icon'
    });
    return box.firstElementChild;
  }

  function fillIcon(host, key, size) {
    if (!host) return;
    host.setAttribute('data-client-icon-host', '');
    var existing = host.querySelector('svg[data-hxz-icon]');
    if (existing && existing.getAttribute('data-hxz-icon') === key) return;
    var svg = iconNode(key, size);
    if (!svg) return;
    host.replaceChildren(svg);
  }

  // Only trim a leading/trailing UI glyph in a selected control. User content,
  // rendered answers and arbitrary text are never searched or rewritten.
  function trimControlGlyphs(control) {
    Array.from(control.childNodes).forEach(function (node) {
      if (node.nodeType !== Node.TEXT_NODE) return;
      var text = node.nodeValue;
      var characters = Array.from(text);
      var leading = text.match(/^\s*/)[0].length;
      var content = text.slice(leading);
      var first = Array.from(content)[0];
      if (first && glyphIcons[normalizedGlyph(first)]) {
        content = content.slice(first.length).replace(/^[\uFE0E\uFE0F]/, '');
        text = text.slice(0, leading) + content;
      }
      characters = Array.from(text.trimEnd());
      var last = characters[characters.length - 1];
      if (last && glyphIcons[normalizedGlyph(last)]) {
        text = text.trimEnd().slice(0, -last.length);
      }
      if (text !== node.nodeValue) node.nodeValue = text;
    });
  }

  function actionIcon(control, key, label, size, preserveText) {
    if (!control) return;
    var direct = Array.from(control.children);
    var host = direct.find(function (child) { return child.matches('i.i'); });
    if (host) {
      fillIcon(host, key, size);
    } else {
      var placeholder = direct.find(function (child) {
        return child.matches('span[aria-hidden="true"]') &&
          (child.hasAttribute('data-client-icon-host') ||
            glyphIcons[normalizedGlyph(child.textContent)]);
      });
      if (placeholder) {
        fillIcon(placeholder, key, size);
      } else {
        var previous = direct.find(function (child) {
          return child.matches('svg[data-client-action-icon]');
        });
        if (previous && previous.getAttribute('data-hxz-icon') === key) return;
        var svg = iconNode(key, size);
        if (!svg) return;
        svg.setAttribute('data-client-action-icon', '');
        if (previous) previous.replaceWith(svg);
        else control.prepend(svg);
      }
      if (!preserveText) trimControlGlyphs(control);
    }
    // The original aria-label is authoritative. Add one only for controls that
    // originally relied entirely on a visible glyph (for example send/close).
    if (label && !control.hasAttribute('aria-label')) {
      control.setAttribute('aria-label', label);
    }
  }

  function decoration(host, key, size, className) {
    if (!host) return;
    var existing = Array.from(host.children).find(function (node) {
      return node.matches('svg[data-client-decoration]');
    });
    if (existing && existing.getAttribute('data-hxz-icon') === key) return;
    var svg = iconNode(key, size || 16);
    if (!svg) return;
    svg.classList.add('client-ui-icon');
    if (className) svg.classList.add(className);
    svg.setAttribute('data-client-decoration', '');
    if (existing) existing.replaceWith(svg);
    else host.prepend(svg);
  }

  function actionMap(scope, keys) {
    if (!scope) return;
    scope.querySelectorAll('button[onclick], [role="button"][onclick]').forEach(function (control) {
      if (control.matches('.industry-topic-card')) return;
      if (control.closest(contentSelector)) return;
      var calls = control.getAttribute('onclick').match(/\b[A-Za-z_$][\w$]*\s*\(/g) || [];
      var name = calls.map(function (call) { return call.replace(/\s*\($/, ''); }).reverse().find(function (call) { return keys[call]; });
      // Attachment labels contain the user's exact filename, including symbols.
      if (name) actionIcon(control, keys[name], null, 16, name === 'dockingDownloadEventFile');
    });
  }

  function externalLinkIcon(link) {
    if (!link) return;
    // Only the exact trailing marker emitted by the source-link renderer is
    // removed. Source names (including any emoji they contain) stay unchanged.
    var last = link.lastChild;
    if (last && last.nodeType === Node.TEXT_NODE && / ↗$/.test(last.nodeValue)) {
      last.nodeValue = last.nodeValue.replace(/ ↗$/, '');
    }
    decoration(link, 'external', 13);
  }

  function decorateIndustry() {
    var page = document.querySelector('.industry-page');
    if (!page) return;
    var actions = {
      addCustomTopic: 'add', startAiInterview: 'analysis', triggerReport: 'report',
      viewCurrentReport: 'report', downloadReport: 'download', doUpload: 'attachment',
      chooseIndustryDemand: 'investment-docking', openIndustryDemandComposer: 'investment-docking',
      viewPartialReport: 'document', toggleHistShowAll: 'filter', deleteHistoryReport: 'delete',
      selectTopic: 'target', requestChainGeneration: 'industry-chain', setChainExplorerMode: 'industry-chain',
      closeChainLayoutNode: 'error', cfmItem: 'success', uncfmItem: 'back',
      ciShowEdit: 'edit', ciSave: 'save', ciCancelEdit: 'back',
      interviewNext: 'next', interviewPrev: 'back', interviewSkip: 'next', interviewDone: 'analysis', interviewFinish: 'report',
      finishInterview: 'report', skipInterview: 'next'
    };
    actionMap(page, actions);
    actionMap(document.querySelector('.industry-detail'), actions);
    page.querySelectorAll('.industry-readiness button[onclick^="go("], #topicCardGrid button[onclick^="go("]').forEach(function (button) {
      actionIcon(button, 'city-library', null, 16);
    });
    page.querySelectorAll('.industry-topic-card').forEach(function (card) {
      var slot = Array.from(card.children).find(function (node) {
        return node.matches('span:not([data-del])');
      });
      if (slot) {
        var svg = slot.querySelector('svg[data-hxz-icon]');
        var key = svg ? svg.getAttribute('data-hxz-icon') : glyphIcons[normalizedGlyph(slot.textContent)] || 'industry';
        slot.classList.add('client-direction-icon');
        fillIcon(slot, key, 22);
      }
      var remove = card.querySelector('[data-del][onclick]');
      if (remove) { fillIcon(remove, 'error', 13); if (!remove.hasAttribute('aria-label')) remove.setAttribute('aria-label', '删除该自定义方向'); }
    });
    page.querySelectorAll('.industry-empty > div:first-child, #topicCardGrid > div > div:first-child').forEach(function (slot) {
      if (slot.querySelector('svg') || !glyphIcons[normalizedGlyph(slot.textContent)]) return;
      fillIcon(slot, slot.closest('.industry-empty') ? 'report' : 'city-library', 32);
      slot.classList.add('client-empty-icon');
    });
    page.querySelectorAll('.industry-empty > div').forEach(function (slot) {
      Array.from(slot.childNodes).forEach(function (node) {
        if (node.nodeType === Node.TEXT_NODE && node.nodeValue.indexOf('「🔍 产业智能分析」') >= 0) {
          node.nodeValue = node.nodeValue.replace('「🔍 产业智能分析」', '「产业智能分析」');
        }
      });
    });
    var tip = page.querySelector('.industry-readiness span[title]');
    if (tip) { trimControlGlyphs(tip); decoration(tip, 'info', 12); }
    var readiness = page.querySelector('.industry-readiness > span');
    if (readiness && /^✓/.test(readiness.textContent.trim())) { trimControlGlyphs(readiness); decoration(readiness, 'success', 14); }
    page.querySelectorAll('.industry-report-head .industry-report-title').forEach(function (title) { decoration(title, 'report', 16); });
    page.querySelectorAll('.industry-sources > summary, .industry-chain-sources > summary, .industry-priority-card > details > summary').forEach(function (summary) { decoration(summary, 'evidence', 14); });
    page.querySelectorAll('.industry-source-heading > a').forEach(externalLinkIcon);
    page.querySelectorAll('.chain-layout-source > a').forEach(externalLinkIcon);
    page.querySelectorAll('.chain-view-switch [data-chain-mode-button="assessment"]').forEach(function (button) { actionIcon(button, 'analysis', null, 16); });
    page.querySelectorAll('.chain-explorer-title > h2').forEach(function (title) { decoration(title, 'industry-chain', 20); });
    page.querySelectorAll('.chain-lane-heading').forEach(function (heading, index) { decoration(heading, ['upstream', 'industry', 'downstream'][index % 3], 16); });
    page.querySelectorAll('.chain-node-drawer-close').forEach(function (button) { actionIcon(button, 'error', '关闭环节详情', 16); });
    page.querySelectorAll('.chain-layout-evidence > span[aria-hidden]').forEach(function (slot) { fillIcon(slot, 'external', 13); });
    page.querySelectorAll('.industry-interview-head > div:first-child').forEach(function (slot) {
      if (slot.textContent.trim() === 'AI') fillIcon(slot, 'analysis', 22);
    });
    var detail = document.querySelector('.industry-detail');
    if (detail) {
      detail.querySelectorAll('.check-list > li:nth-child(2) > i.i').forEach(function (slot) { fillIcon(slot, 'target', 16); });
      detail.querySelectorAll('.check-list > li:nth-child(3) > i.i').forEach(function (slot) { fillIcon(slot, 'schedule', 16); });
      detail.querySelectorAll('.source-list > li > i.i').forEach(function (slot) { fillIcon(slot, 'document', 16); });
    }
    page.querySelectorAll('.industry-confirm-row.is-done > span:first-child, .industry-confirm-row.is-pending > div:first-child > div:first-child > span:first-child').forEach(function (slot) {
      if (slot.closest('.industry-confirm-row.is-done')) fillIcon(slot, 'success', 17);
      else fillIcon(slot, 'warning', 14);
    });
    page.querySelectorAll('.industry-confirm-head > span:first-child').forEach(function (slot) { fillIcon(slot, 'review', 18); });
    page.querySelectorAll('[id^="hrpt-ico-"]').forEach(function (slot) {
      var glyph = normalizedGlyph(slot.textContent);
      if (glyph === '▶' || glyph === '▼' || glyph === '▾') fillIcon(slot, glyph === '▶' ? 'next' : 'expand', 12);
    });
    page.querySelectorAll('[id^="cp-caret-"]').forEach(function (slot) {
      if (!slot.querySelector('svg')) fillIcon(slot, 'expand', 14);
    });
    page.querySelectorAll('[id^="ci-file-hint-"]').forEach(function (slot) {
      if (slot.textContent.trim().indexOf('📎 上传附件') !== 0) return;
      trimControlGlyphs(slot); decoration(slot, 'attachment', 15);
    });
  }

  function decorateDocking() {
    var page = document.getElementById('dockingWorkspace');
    if (!page) return;
    actionMap(page, {
      openDirectDemandComposer: 'add', openDockingLog: 'edit', openDockingSupplement: 'attachment',
      dockingOpenReport: 'report', addClueManual: 'enterprise', requestVerify: 'verification-request',
      showContactCard: 'contact', editClue: 'edit', dockingDownloadEventFile: 'download',
      dockingClearFilters: 'filter'
    });
    page.querySelectorAll('.docking-header-actions [onclick^="go("]').forEach(function (button) { actionIcon(button, 'industry-analysis', null, 16); });
    page.querySelectorAll('.docking-header-actions span[aria-hidden]').forEach(function (slot) {
      if (glyphIcons[normalizedGlyph(slot.textContent)]) slot.remove();
    });
    page.querySelectorAll('.docking-empty, .docking-inline-empty').forEach(function (empty) { decoration(empty, 'empty', 28, 'client-empty-icon'); });
    page.querySelectorAll('.docking-clue-card > header > div').forEach(function (header) { decoration(header, 'enterprise', 22, 'client-enterprise-icon'); });
    page.querySelectorAll('.docking-clue-evidence > details > summary, .docking-block > details > summary').forEach(function (summary) { decoration(summary, 'evidence', 14); });
    page.querySelectorAll('.docking-evidence-link').forEach(externalLinkIcon);
    page.querySelectorAll('.docking-receiving h3').forEach(function (title) { decoration(title, 'progress', 18); });
    page.querySelectorAll('.docking-verification-reply > strong').forEach(function (title) { decoration(title, 'review', 15); });
    page.querySelectorAll('.docking-section-head h3').forEach(function (title) { decoration(title, title.closest('.docking-candidates') ? 'enterprise' : 'traceability', 17); });
    page.querySelectorAll('.docking-overview-grid > .docking-block').forEach(function (block, index) { decoration(block.querySelector('h3'), index === 0 ? 'target' : 'source', 16); });
    // Labels below are application-owned status strings, not model answers or
    // company content. A completed review does not imply verification passed.
    var statuses = {
      '待受理': 'verification-pending', '处理中': 'loading', '待补充资料': 'warning',
      '已反馈': 'comment', '已补充 · 待复核': 'review', '待核验': 'verification-pending',
      '核验处理中': 'verification-pending', '核验需补充资料': 'warning',
      '建议进一步对接': 'investment-docking', '本次需求不适配': 'info', '依据仍不足': 'warning',
      '已反馈核验结果': 'review', '已申请核验': 'verification-request',
      '已记录跟进': 'comment', '已核对产品适配': 'review', '历史状态待复核': 'review'
    };
    page.querySelectorAll('.docking-badge').forEach(function (badge) { var key = statuses[badge.textContent.trim()]; if (key) decoration(badge, key, 12); });
    var kinds = {
      '申请核验': 'verification-request', '管理端受理反馈': 'comment', '客户补充资料': 'attachment',
      '企业核验反馈': 'review', '管理端阶段更新': 'progress', '电话沟通': 'contact',
      '拜访交流': 'investment-docking', '邮件沟通': 'comment', '材料往来': 'document',
      '跟进备注': 'edit', '历史记录': 'traceability'
    };
    page.querySelectorAll('.docking-event-kind').forEach(function (label) { decoration(label, kinds[label.textContent.trim()] || 'traceability', 14); });
    var modal = document.querySelector('#modalLayer');
    if (modal && modal.querySelector('.docking-log-form, .docking-contact-material, .docking-action-form')) {
      actionMap(modal, { closeModal: 'error', openDockingLog: 'edit', saveDockingLog: 'save', submitDockingLog: 'save',
        saveDockingClue: 'save', submitDockingClue: 'save', dockingRemoveLogFile: 'delete',
        dockingRemoveClueFile: 'delete' });
    }
  }

  function settingsDecoration(host, key, size, rowIcon) {
    if (!host) return;
    decoration(host, key, size || 18, rowIcon ? 'client-settings-row-icon' : 'client-settings-icon');
  }

  function settingsAction(control, key, size) {
    if (!control) return;
    actionIcon(control, key, null, size || 16);
    var svg = control.querySelector('svg[data-hxz-icon]');
    if (svg) svg.classList.add('client-settings-row-icon');
  }

  function decorateSettings() {
    var scroll = document.querySelector('.settings-scroll');
    var profileKeys = ['industrial-park', 'land', 'enterprise', 'industry', 'funding'];
    if (scroll) {
      var page = scroll.closest('.page');
      if (page) {
        page.classList.add('client-settings-page');
        settingsDecoration(page.querySelector('.page-header h1'), 'settings', 25);
      }
      scroll.querySelectorAll(':scope > .settings-section').forEach(function (section) {
        var heading = section.querySelector(':scope > h2, :scope > h3');
        var workspace = section.querySelector('select[onchange^="switchAuthWorkspace("]');
        var identity = section.querySelector('.form-grid input[disabled]');
        var profile = section.querySelector('button[onclick="editOnboarding()"]');
        var reminders = section.querySelector('.toggle-row');
        var system = section.querySelector('.plain-list');
        var key = workspace ? 'workspace' : identity ? 'account' : profile ? 'target' : reminders ? 'notification' : system ? 'settings' : null;
        if (key) settingsDecoration(heading, key, 19);
        if (workspace) settingsAction(section.querySelector('button[onclick="openJoinWorkspace()"]'), 'login');
        if (identity) {
          var fields = ['organization', 'account', 'location', 'permissions'];
          section.querySelectorAll('.form-grid > label').forEach(function (label, index) {
            if (!label.querySelector('input[disabled]') || !fields[index]) return;
            settingsDecoration(label, fields[index], 16, true);
          });
        }
        if (profile) {
          settingsAction(profile, 'edit');
          // Each profile row has its own fixed, first-child icon slot. The
          // second child contains the saved answer and is never rewritten.
          Array.from(section.children).filter(function (row) {
            return row.matches('div:not(.boundary-note)') && row.firstElementChild && row.firstElementChild.tagName === 'SPAN';
          }).forEach(function (row, index) {
            if (!profileKeys[index]) return;
            var slot = row.firstElementChild;
            fillIcon(slot, profileKeys[index], 20);
            slot.classList.add('client-settings-profile-slot');
            var svg = slot.querySelector('svg');
            if (svg) svg.classList.add('client-settings-row-icon');
          });
        }
        if (reminders) {
          section.querySelectorAll('.toggle-row').forEach(function (row) {
            var input = row.querySelector('input[type="checkbox"]');
            var label = row.querySelector('strong');
            var name = label && label.textContent.trim();
            if (input && name && !input.hasAttribute('aria-label') && !input.hasAttribute('aria-labelledby')) {
              input.setAttribute('aria-label', name);
            }
          });
          section.querySelectorAll('.toggle-row > span').forEach(function (label, index) {
            settingsDecoration(label, ['notification', 'schedule', 'report'][index] || 'notification', 19, true);
          });
          settingsAction(section.querySelector('.settings-save'), 'save');
        }
        if (system) {
          section.querySelectorAll('.plain-list > li').forEach(function (item, index) {
            settingsDecoration(item, ['workspace', 'industry-analysis', 'schedule'][index] || 'settings', 15, true);
          });
        }
      });
      // The detail pane uses application-owned headings. Scope it to the
      // settings page so similarly named headings in reports stay untouched.
      var detail = document.querySelector('.detail-pane');
      if (detail) {
        settingsDecoration(detail.querySelector('.detail-header h2'), 'account', 20);
        var headings = { '身份': 'account', '数据权限': 'permissions', '安全边界': 'security', '组织成员': 'team' };
        detail.querySelectorAll('.detail-block > h3').forEach(function (heading) {
          var text = Array.from(heading.childNodes).filter(function (node) { return node.nodeType === Node.TEXT_NODE; }).map(function (node) { return node.nodeValue; }).join('').trim();
          if (headings[text]) settingsDecoration(heading, headings[text], 16);
          if (text === '身份') {
            var list = heading.parentElement.querySelector('.check-list');
            if (list) list.querySelectorAll(':scope > li > i.i').forEach(function (slot, index) { fillIcon(slot, index === 0 ? 'organization' : 'account', 16); });
          }
        });
        detail.querySelectorAll('button[onclick^="removeOrgMember("]').forEach(function (button) { settingsAction(button, 'delete', 13); });
      }
    }

    var joinInput = document.getElementById('joinInviteCode');
    if (joinInput) {
      var joinModal = joinInput.closest('.modal');
      if (joinModal) {
        settingsDecoration(joinModal.querySelector('header h2'), 'workspace', 21);
        settingsAction(joinModal.querySelector('button[onclick="joinWorkspace()"]'), 'login');
        joinModal.querySelectorAll('button[onclick="closeModal()"]').forEach(function (button) {
          settingsAction(button, 'error');
        });
      }
    }
    var modal = document.getElementById('onbModalHost');
    if (!modal) return;
    modal.classList.add('client-settings-questionnaire');
    settingsDecoration(modal.querySelector('.modal > header h2'), 'target', 21);
    settingsAction(modal.querySelector('button[onclick="closeOnboarding()"]'), 'error');
    settingsAction(modal.querySelector('#onbSubmitBtn'), 'save');
    var questionGlyphs = ['🏢', '🏗️', '📊', '🏭', '💰'];
    modal.querySelectorAll('#onbBody > div').forEach(function (group, index) {
      if (!profileKeys[index]) return;
      var heading = group.querySelector(':scope > div:first-child');
      if (!heading) return;
      // Replace only the exact prefix emitted for a known questionnaire row.
      // The question, hint, chosen option labels and user text remain intact.
      var first = heading.firstChild;
      if (first && first.nodeType === Node.TEXT_NODE && first.nodeValue.indexOf(questionGlyphs[index] + ' ') === 0) {
        first.nodeValue = first.nodeValue.slice(questionGlyphs[index].length + 1);
        settingsDecoration(heading, profileKeys[index], 19, true);
      }
    });
    modal.querySelectorAll('button[onclick^="toggleOnb("]').forEach(function (button) {
      var first = button.firstChild;
      if (button.style.fontWeight === '650' && first && first.nodeType === Node.TEXT_NODE && first.nodeValue.indexOf('✓ ') === 0) {
        first.nodeValue = first.nodeValue.slice(2);
        settingsDecoration(button, 'success', 13, true);
      }
      button.querySelectorAll('span[title="AI 结合本地推荐"]').forEach(function (slot) {
        fillIcon(slot, 'opportunity', 13);
        var svg = slot.querySelector('svg');
        if (svg) svg.classList.add('client-settings-row-icon');
      });
    });
  }

  function brandMark() {
    document.querySelectorAll('.topbar .brand-block > img:not([data-brand-mark])').forEach(function (image) {
      var holder = document.createElement('span');
      holder.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34" class="client-brand-icon client-brand-mark" data-hxz-icon="qingxu-brand-mark" data-brand-mark="qingxu" aria-hidden="true" focusable="false" style="flex:0 0 34px">' +
        '<rect x="3" y="3" width="12" height="12" rx="1" fill="#16594c"/>' +
        '<rect x="18" y="3" width="12" height="12" rx="1" fill="#16594c" opacity=".38"/>' +
        '<rect x="3" y="18" width="12" height="12" rx="1" fill="#ad6039"/>' +
        '<rect x="18" y="18" width="12" height="12" rx="1" fill="#16594c"/></svg>';
      image.replaceWith(holder.firstElementChild);
    });
  }

  function decorate() {
    // This bundle belongs to the government/client preview, not the admin UI.
    if (!document.querySelector('.sidebar .nav-item[onclick^="go("]')) return;
    brandMark();

    document.querySelectorAll('.sidebar .nav-item[onclick^="go("]').forEach(function (button) {
      var match = button.getAttribute('onclick').match(/^go\(['"]([^'"]+)['"]/);
      if (match && navIcons[match[1]]) fillIcon(button.querySelector('i.i'), navIcons[match[1]], 20);
      var label = button.querySelector('.nav-copy strong');
      if (label && !button.hasAttribute('aria-label')) button.setAttribute('aria-label', label.textContent.trim());
    });
    fillIcon(document.querySelector('.topbar .org-block > i.i'), 'public-service', 18);
    var meta = document.querySelector('.topbar .top-meta');
    if (meta) {
      fillIcon(meta.querySelector(':scope > span:first-child > i.i'), 'citation', 16);
      fillIcon(meta.querySelector(':scope > span:nth-child(2) > i.i'), 'traceability', 16);
      fillIcon(meta.querySelector('[onclick^="toggleNotif"] > i.i'), 'notification', 18);
      actionIcon(meta.querySelector('button[onclick="logout()"]'), 'logout', '退出登录', 16);
    }

    // Actions are selected by the original function/element identity, never by
    // admin-side copy or a guessed text label.
    var actions = [
      ['.kb-toolbar #kbToggle-topics', 'comment'],
      ['.kb-toolbar [onclick="uploadHint()"]', 'upload'],
      ['.kb-toolbar [onclick="openMemoryBank()"]', 'resource'],
      ['.kb-toolbar [onclick="showDownloadReport()"]', 'download'],
      ['.kb-toolbar #kbToggle-sources', 'evidence'],
      ['.kb-new-conversation', 'add'],
      ['.composer-tools [onclick="uploadHint()"]', 'upload'],
      ['.composer-tools [onclick="clearKbActiveTopic()"]', 'workspace'],
      ['.composer-tools [onclick="go(\'knowledge\')"]', 'city-library'],
      ['.composer-wrap .send-button', 'next', '发送问题', 20],
      ['#kbTopBtn', 'collapse', '回到对话顶部'],
      ['.kb-panel-close, .kb-detail-close, .collapse-detail', 'error', '关闭'],
      ['.composer-wrap [onclick="clearKbActiveTopic()"][title="取消"]', 'error', '取消'],
      ['.kb-detail-edit', 'edit'],
      ['.kb-detail-block-edit', 'edit'],
      ['.kb-request-progress-cancel', 'error'],
      ['.kb-answer-retry', 'refresh'],
      ['.kb-detail-confirm', 'success'],
      ['.kb-detail-manage .is-danger', 'delete'],
      ['.kb-detail-footer [onclick^="addKbItem"]', 'add'],
      ['.kb-detail-footer [onclick^="pickLocalFile"]', 'upload'],
      ['.kb-detail-footer .kb-detail-ask', 'next'],
      ['#kbEditorTabEdit', 'edit'],
      ['#kbEditorTabPreview', 'document'],
      ['#kbEditorSave', 'success'],
      ['.kb-editor-attachments button', 'attachment'],
      ['.kb-editor-whole', 'document'],
      ['.kb-editor-footer .kb-detail-secondary', 'back'],
      ['.kb-detail-article-actions > .kb-detail-secondary', 'refresh'],
      ['.kb-scope-bar [onclick="clearKbActiveTopic()"]', 'refresh']
    ];
    actions.forEach(function (entry) {
      document.querySelectorAll(entry[0]).forEach(function (control) {
        actionIcon(control, entry[1], entry[2], entry[3]);
      });
    });
    document.querySelectorAll('.kb-detail-topic-icon').forEach(function(host){
      var key=host.getAttribute('data-kb-icon')||'knowledge-library';
      fillIcon(host,window.hxzIcons.has(key)?key:'knowledge-library',32);
    });
    var overview = document.getElementById('kbOverviewToggle');
    if (overview) actionIcon(overview, overview.getAttribute('aria-expanded') === 'true' ? 'collapse' : 'expand');

    document.querySelectorAll('.kb-topic-card[data-kb-topic] .kb-topic-number').forEach(function (number) {
      var card = number.closest('.kb-topic-card');
      var key = card.getAttribute('data-kb-icon') || 'knowledge-library';
      if (!window.hxzIcons.has(key)) key = 'knowledge-library';
      var existing = number.parentElement.querySelector(':scope > .client-topic-icon');
      if (existing && existing.getAttribute('data-hxz-icon') === key) return;
      var svg = iconNode(key, 16);
      svg.classList.add('client-topic-icon');
      if (existing) existing.replaceWith(svg);
      else number.before(svg);
    });

    // These existing, dedicated icon spans are safe to replace without touching
    // card labels, card actions, or chat/report content.
    document.querySelectorAll('.kb-topic-read > span[aria-hidden], .kb-topic-question > span[aria-hidden], .kb-global-scope > span[aria-hidden], .kb-sources-empty > span[aria-hidden]').forEach(function (host) {
      if (host.querySelector('svg')) return;
      var key = glyphIcons[normalizedGlyph(host.textContent)];
      if (key) fillIcon(host, key, host.closest('.kb-sources-empty') ? 28 : 16);
    });

    // Cover original secondary-page icons while leaving custom content intact.
    document.querySelectorAll('#root i.i').forEach(function (host) {
      if (host.closest(contentSelector)) return;
      if (host.querySelector('svg')) return;
      var key = glyphIcons[normalizedGlyph(host.textContent)];
      if (key) fillIcon(host, key, 18);
    });
    document.querySelectorAll('.sidebar .nav-item > span:not(.nav-copy)').forEach(function (host) {
      if (normalizedGlyph(host.textContent) === '🔒') fillIcon(host, 'permissions', 12);
    });
    decorateIndustry();
    decorateDocking();
    decorateSettings();
  }

  function observe() {
    if (observer && observedRoot) observer.observe(observedRoot, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ['aria-expanded']
    });
  }

  function apply() {
    frame = 0;
    if (applying) return;
    applying = true;
    if (observer) observer.disconnect();
    try { decorate(); }
    finally { applying = false; observe(); }
  }

  function queue() {
    if (!frame && !applying) frame = window.requestAnimationFrame(apply);
  }

  function start() {
    observedRoot = document.body;
    observer = new MutationObserver(function (records) {
      // Streaming report/answer text is content, not a new UI icon surface.
      if (records.some(function (record) {
        var target = record.target.nodeType === Node.TEXT_NODE ? record.target.parentElement : record.target;
        return !target || !target.closest(contentSelector);
      })) queue();
    });
    apply();
  }

  window.hxzClientIcons = Object.freeze({
    refresh: queue,
    source: 'frontend/index/brand-icons.js'
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}());
