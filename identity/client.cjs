/* Standalone browser/Node client. Not yet wired into legacy production HTML. */
(function (root) {
  'use strict';
  function createClient(fetcher) {
    let csrf = null;
    let version = 0;
    async function request(path, method, body) {
      const headers = {'Content-Type': 'application/json'};
      if (csrf) headers['X-CSRF-Token'] = csrf;
      const response = await fetcher(path, {
        method, headers, credentials: 'same-origin',
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      if (response.status === 401) { csrf = null; version = 0; }
      const result = await response.json();
      if (!response.ok || result.ok === false) {
        throw new Error(result.error || ('HTTP ' + response.status));
      }
      return result;
    }
    return {
      async login(login, password) {
        csrf = null; version = 0;
        const result = await request('/auth/login', 'POST', {login, password});
        if (typeof result.csrf !== 'string' || !result.csrf) throw new Error('invalid login response');
        csrf = result.csrf;
      },
      async resume() {
        const result = await request('/auth/session', 'GET');
        if (typeof result.csrf !== 'string' || !result.csrf || !result.principal) throw new Error('invalid session response');
        csrf = result.csrf;
        return result.principal;
      },
      async load() {
        const result = await request('/api/sync', 'GET');
        if (!Number.isInteger(result._version) || result._version < 0) throw new Error('invalid state version');
        version = result._version;
        return result;
      },
      async save(data) {
        if (!csrf) throw new Error('login required');
        const result = await request('/api/sync', 'POST', Object.assign({}, data, {_version: version}));
        if (result.ok !== true || !Number.isInteger(result._version)) throw new Error('save not confirmed');
        version = result._version;
        return result;
      },
      async knowledge(project) {
        if (!/^[a-zA-Z0-9_-]+$/.test(project)) throw new Error('invalid project');
        return request('/api/projects/' + project + '/knowledge', 'GET');
      },
      async saveKnowledge(project, kb, displayedVersion) {
        if (!csrf) throw new Error('login required');
        if (!/^[a-zA-Z0-9_-]+$/.test(project)) throw new Error('invalid project');
        return request('/api/projects/' + project + '/knowledge', 'PUT', {kb, version: displayedVersion});
      },
      async report(project) {
        if (!/^[a-zA-Z0-9_-]+$/.test(project)) throw new Error('invalid project');
        return request('/api/projects/' + project + '/report', 'GET');
      },
      async logout() {
        // Retain CSRF on network failure so the caller can retry actual server logout.
        await request('/auth/logout', 'POST', {});
        csrf = null; version = 0;
      }
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {createClient};
  else root.HxzIdentity = {createClient};
})(typeof globalThis !== 'undefined' ? globalThis : this);
