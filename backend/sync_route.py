"""Legacy sync route with explicit persistence dependencies and unchanged merge rules."""
import json
from dataclasses import dataclass
from typing import Callable
from .sync_merge import _apply_kb_item_tombs, _clue_tombstoned, _merge_invite_codes, _merge_kb_item_tombs, _merge_map

@dataclass(frozen=True)
class SyncDependencies:
    use_database: bool
    read: Callable
    write: Callable
    file_path: str
    snapshot_file: Callable
    clean: Callable

def handle_sync(self, raw, deps):
    try:
        data_str = raw.decode('utf-8')
        incoming = json.loads(data_str)
        if not isinstance(incoming, dict):
            raise ValueError('sync payload must be an object')
        if deps.use_database:
            stored = deps.read()
            if stored is None:
                raise RuntimeError('storage read failed; write refused')
            existing = json.loads(stored)
        else:
            try:
                with open(deps.file_path, 'r', encoding='utf-8') as f2:
                    existing = json.loads(f2.read())
            except FileNotFoundError:
                existing = {}
        if not isinstance(existing, dict):
            raise ValueError('stored state must be an object')
        # -- 空 body 保护：整体为空或只有极少字段的写入直接拒绝 --
        # 防止未登录/初始化态的浏览器把空 localStorage 推上来清空全库。
        if isinstance(incoming, dict):
            _incoming_keys = set(k for k,v in incoming.items() if v not in (None, {}, [], ''))
            # 保底核心字段：只要 existing 有 PROJECTS/USER_PROFILES/OPS_ENT 之一，
            # 而 incoming 三个都为空，就判定为空写入并拒绝。
            _core_had = any(existing.get(k) for k in ('PROJECTS','USER_PROFILES','OPS_ENT'))
            _core_incoming = any(incoming.get(k) for k in ('PROJECTS','USER_PROFILES','OPS_ENT'))
            # 【2026-09-30】受保护字段的合法局部更新不算空写：check_requests.py 等
            # 调度脚本只 PUT {REPORT_REQUESTS, syncTs}，不带任何核心对象，被上面
            # 的判断误杀为"整库清空"（rejected: empty-payload），claim/fail 永远
            # 无法成功（第四次复现的已知阻塞）。只要 incoming 带了任一受保护字段
            # （下方 _protected 列表）且值非空，就说明这是一次真实的局部更新，
            # 不该被空写保护拦截；PROJECTS/USER_PROFILES/OPS_ENT 完全缺失时它们
            # 在下面的合并循环里也不会被裸覆盖（未出现的 key 不会被写入 existing）。
            _protected_incoming = any(incoming.get(k) for k in
                ('OPS_ENT','DEMANDS','KB_CHAT','PENDING_CONFIRMS','KB_CONFIRMS',
                 'REPORT_REQUESTS','CITY_ACCOUNTS','INVITE_CODES','CITY_BASE_PACKAGES'))
            if _core_had and not _core_incoming and not _protected_incoming:
                print('[sync] rejected empty write (keys=%r)' % (sorted(_incoming_keys),))
                resp = json.dumps({'ok': False, 'rejected': 'empty-payload'}).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(resp)))
                self.cors(); self.end_headers(); self.wfile.write(resp)
                return
        # -- RESET generation barrier --
        # admin-reset writes a new RESET_GEN. After that only clients carrying the
        # same RESET_GEN (sessions reloaded after the reset) may write; stale sessions
        # carrying an old/absent gen are rejected wholesale, so they cannot merge the
        # cleared Suizhou runtime data (aiTopics/customTopics/UPLOADS/KB_CHAT) back.
        _srv_gen = existing.get('RESET_GEN')
        if _srv_gen:
            _cli_gen = incoming.get('RESET_GEN')
            if _cli_gen != _srv_gen:
                print('[sync] rejected stale write (client gen=%r != server gen=%r)' % (_cli_gen, _srv_gen))
                resp = json.dumps({'ok': False, 'rejected': 'stale-generation', 'gen': _srv_gen}).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(resp)))
                self.cors(); self.end_headers(); self.wfile.write(resp)
                return
        # 合并：空列表/空字典不覆盖已有非空数据
        # ── 删除墓碑：政府端删除的项目 key 永久移除。_merge_map 只增不减，
        #    没有墓碑时"删除"永远会被合并复活（删了又回来）。──
        _tomb = set(existing.get('DELETED_PROJECTS') or []) | set(incoming.get('DELETED_PROJECTS') or [])
        # 企业线索墓碑 'projKey::clueId'：_merge_clues 会保留服务端独有线索，
        # 没有墓碑时政府端删掉的企业会被管理端旧快照合并复活。
        _ctomb = set(existing.get('DELETED_CLUES') or []) | set(incoming.get('DELETED_CLUES') or [])
        # 【2026-09-18】知识条目删除墓碑：两端合并，逐指纹取较新 ts。
        _itomb = _merge_kb_item_tombs(existing.get('KB_ITEM_TOMBS'),
                                      incoming.get('KB_ITEM_TOMBS'))
        # 关键：必须在 _merge_map 之前先把墓碑应用到 existing。
        # 否则 kb 的「条数 >= 旧值才接受」门槛会把删除后的新快照当成
        # 「材料更少」而直接丢弃，删除永远同步不上去。
        if _itomb:
            _apply_kb_item_tombs(existing.get('PROJECTS'), _itomb)
        # 【2026-09-29】INVITE_CODES 邀请码库同理需要空值保护——注册页/ops页在
        # 未加载完该变量前若先同步一次，空对象会把已生成的全部邀请码裸覆盖清空。
        # CITY_BASE_PACKAGES 同理：{城市名: 权威projKey} 的轻量指针表，未加载完时
        # 空对象也不能裸覆盖，否则所有城市瞬间失去基础包引用。
        _protected = ['OPS_ENT','DEMANDS','KB_CHAT','PENDING_CONFIRMS','KB_CONFIRMS','REPORT_REQUESTS','CITY_ACCOUNTS','INVITE_CODES','CITY_BASE_PACKAGES']
        # REPORT_REQUESTS 按 id 合并且状态只进不退（pending<running<done/failed）
        # 防止管理端旧快照 persist 把流水线已推进的状态倒改回 pending
        # 【2026-09-30】cancelled 排在最高：用户手动取消是终态决定，任何调度脚本
        # （claim/orchestrator/sync_to_kb 等）事后写回的旧状态更新都不能把它
        # 覆盖回 pending/running/failed/done——这正是"卡死任务允许用户手动取消"
        # 功能的服务端语义保证。
        _rr_rank = {'pending': 0, 'running': 1, 'failed': 2, 'done': 3, 'cancelled': 4}
        def _merge_rr(old_list, new_list):
            by_id = {r.get('id'): dict(r) for r in (old_list or []) if isinstance(r, dict)}
            for r in (new_list or []):
                if not isinstance(r, dict):
                    continue
                rid = r.get('id')
                ex = by_id.get(rid)
                if not ex:
                    by_id[rid] = r
                elif _rr_rank.get(r.get('status'), 0) >= _rr_rank.get(ex.get('status'), 0):
                    ex.update(r)
                # 否则丢弃倒退的状态更新，保留服务端已推进的记录
            return sorted(by_id.values(), key=lambda x: x.get('ts', 0))
        # KB_CHAT 会话级合并:同 city key 下的 sessions 按 id 择优(消息多的赢),不做整体覆盖
        # 防止某 tab 的空会话未同步内存 persist 上来把其它 tab 已同步的问答冲掉
        def _merge_kbchat(old_kbc, new_kbc, tombs=None):
            if not isinstance(old_kbc, dict): old_kbc = {}
            if not isinstance(new_kbc, dict): new_kbc = {}
            if not isinstance(tombs, dict): tombs = {}
            result = {}
            all_ck = set(old_kbc.keys()) | set(new_kbc.keys())
            for ck in all_ck:
                def _norm(st):
                    if isinstance(st, list):
                        return {'sessions': [{'id':'s_leg_'+ck,'title':'','ts':0,'messages': st}], 'activeId': None}
                    if isinstance(st, dict) and st.get('sessions') is not None:
                        return st
                    return {'sessions': [], 'activeId': None}
                A = _norm(old_kbc.get(ck))
                B = _norm(new_kbc.get(ck))
                by_sid = {}
                order = []
                def _take(se, by_sid=by_sid, order=order, ck=ck):
                    if not isinstance(se, dict) or not se.get('id'):
                        return
                    sid = se['id']
                    # 【2026-09-21】会话删除墓碑：政府端删掉的会话不得在服务端复活。
                    # 客户端墓碑拦不住这一层——合并发生在服务端存储里，任何客户端
                    # 下次 GET 拉到的都还是含已删会话的旧数据（删了又回来）。
                    if tombs.get('%s::%s' % (ck, sid)):
                        return
                    ex = by_sid.get(sid)
                    if not ex:
                        by_sid[sid] = se; order.append(sid); return
                    e_n = len(ex.get('messages') or [])
                    n_n = len(se.get('messages') or [])
                    e_t = ex.get('ts') or 0
                    n_t = se.get('ts') or 0
                    if n_n > e_n or (n_n == e_n and n_t > e_t):
                        by_sid[sid] = se
                for se in A['sessions']: _take(se)
                for se in B['sessions']: _take(se)
                sessions = [by_sid[i] for i in order]
                activeId = B.get('activeId') or A.get('activeId') or (sessions[-1]['id'] if sessions else None)
                result[ck] = {'sessions': sessions, 'activeId': activeId}
            return result
        # 【2026-09-21】问答会话删除墓碑：两端合并，逐 key 取较新 ts。
        # 与 KB_ITEM_TOMBS 同一套思路（见上方 _apply_kb_item_tombs 的说明）。
        def _merge_kbchat_tombs(a, b):
            out = {}
            for src in (a, b):
                if not isinstance(src, dict):
                    continue
                for tk, tv in src.items():
                    try:
                        tv = int(tv)
                    except (TypeError, ValueError):
                        continue
                    if tk not in out or tv > out[tk]:
                        out[tk] = tv
            return out
        _kbc_tomb = _merge_kbchat_tombs(existing.get('KB_CHAT_TOMBS'),
                                        incoming.get('KB_CHAT_TOMBS'))
        # 先剥掉 incoming.UPLOADS.dataUrl，避免服务端长期穏积 base64
        deps.clean(incoming)
        # ══ 文件记忆（UPLOADS / KB_FILE_CHUNKS）只增不减 + 墓碑 ══
        # 【2026-09-21】审计发现：这两个字段此前是裸覆盖，任一端送空值即整份清掉，
        # 与 KB_CHAT 归零同一条路径（管理端 persist 或旧标签页回灌都可能带空值）。
        # 文件记忆支持删除，所以不能单纯只增不减，需与 KB_CHAT 一样用墓碑区分
        # 「用户真的删了」和「某端恰好没有数据」。墓碑键：'projKey::fileName'。
        def _merge_file_tombs(a, b):
            out = {}
            for src in (a, b):
                if not isinstance(src, dict):
                    continue
                for tk, tv in src.items():
                    try:
                        tv = int(tv)
                    except (TypeError, ValueError):
                        continue
                    if tk not in out or tv > out[tk]:
                        out[tk] = tv
            return out
        _file_tomb = _merge_file_tombs(existing.get('UPLOAD_TOMBS'),
                                       incoming.get('UPLOAD_TOMBS'))

        def _merge_uploads(old_up, new_up, tombs):
            """按 projKey 并集；同 key 下按 name+ts 去重合并；墓碑命中的文件剔除。"""
            if not isinstance(old_up, dict): old_up = {}
            if not isinstance(new_up, dict): new_up = {}
            result = {}
            for pk in set(old_up.keys()) | set(new_up.keys()):
                seen, merged = {}, []
                for lst in (old_up.get(pk), new_up.get(pk)):
                    if not isinstance(lst, list):
                        continue
                    for it in lst:
                        if not isinstance(it, dict):
                            continue
                        name = it.get('name') or ''
                        if tombs.get('%s::%s' % (pk, name)):
                            continue
                        sig = '%s::%s' % (name, it.get('ts') or 0)
                        if sig in seen:
                            # 取信息更全的那份（解析出的 text 更长者胜）
                            ex = merged[seen[sig]]
                            if len(str(it.get('text') or '')) > len(str(ex.get('text') or '')):
                                merged[seen[sig]] = it
                            continue
                        seen[sig] = len(merged)
                        merged.append(it)
                result[pk] = merged
            return result

        def _merge_chunks(old_c, new_c, tombs):
            """知识片段按 projKey 并集；同 key 下按 chunk id 去重；墓碑按来源文件名剔除。"""
            if not isinstance(old_c, dict): old_c = {}
            if not isinstance(new_c, dict): new_c = {}
            result = {}
            for pk in set(old_c.keys()) | set(new_c.keys()):
                seen, merged = set(), []
                for lst in (old_c.get(pk), new_c.get(pk)):
                    if not isinstance(lst, list):
                        continue
                    for it in lst:
                        if not isinstance(it, dict):
                            continue
                        src_name = it.get('file') or it.get('source') or it.get('cite') or ''
                        if tombs.get('%s::%s' % (pk, src_name)):
                            continue
                        cid = it.get('id') or ('%s|%s' % (src_name, str(it.get('text'))[:40]))
                        if cid in seen:
                            continue
                        seen.add(cid)
                        merged.append(it)
                result[pk] = merged
            return result

        for k, v in incoming.items():
            # KB_CHAT 单独按会话合并,永不裸覆盖
            if k == 'KB_CHAT':
                existing[k] = _merge_kbchat(existing.get(k), v, _kbc_tomb)
                continue
            if k == 'KB_CHAT_TOMBS':
                # 墓碑本身只增不减，逐 key 取较新 ts
                existing[k] = _kbc_tomb
                continue
            if k == 'UPLOADS':
                existing[k] = _merge_uploads(existing.get(k), v, _file_tomb)
                continue
            if k == 'KB_FILE_CHUNKS':
                existing[k] = _merge_chunks(existing.get(k), v, _file_tomb)
                continue
            if k == 'UPLOAD_TOMBS':
                existing[k] = _file_tomb
                continue
            if k in _protected and not v and existing.get(k):
                continue
            if k == 'REPORT_REQUESTS':
                existing[k] = _merge_rr(existing.get(k), v)
                continue
            if k == 'INVITE_CODES':
                existing[k] = _merge_invite_codes(existing.get(k), v)
                continue
            if k in ('PROJECTS', 'REPORTSTATE', 'CITY_ACCOUNTS'):
                # 逐 key/逐字段合并，空值不覆盖非空——防止旧快照把已同步的 RAG/账号冲掉
                existing[k] = _merge_map(existing.get(k), v)
                continue
            existing[k] = v
        # 同理把文件墓碑应用到已存 UPLOADS / KB_FILE_CHUNKS
        if _file_tomb:
            if isinstance(existing.get('UPLOADS'), dict):
                existing['UPLOADS'] = _merge_uploads(existing['UPLOADS'], {}, _file_tomb)
            if isinstance(existing.get('KB_FILE_CHUNKS'), dict):
                existing['KB_FILE_CHUNKS'] = _merge_chunks(existing['KB_FILE_CHUNKS'], {}, _file_tomb)
            existing['UPLOAD_TOMBS'] = _file_tomb
        # 【2026-09-21】把会话墓碑应用到最终的 KB_CHAT：
        # incoming 可能根本不含 KB_CHAT（例如管理端 persist），此时上面的
        # _merge_kbchat 不会被调用，已删会话仍留在 existing 里。
        if _kbc_tomb and isinstance(existing.get('KB_CHAT'), dict):
            for _ck, _st in existing['KB_CHAT'].items():
                if not isinstance(_st, dict) or not isinstance(_st.get('sessions'), list):
                    continue
                _st['sessions'] = [
                    _se for _se in _st['sessions']
                    if not (isinstance(_se, dict) and _kbc_tomb.get('%s::%s' % (_ck, _se.get('id'))))
                ]
                if _st.get('activeId') and not any(
                        isinstance(_se, dict) and _se.get('id') == _st['activeId']
                        for _se in _st['sessions']):
                    _st['activeId'] = _st['sessions'][-1]['id'] if _st['sessions'] else None
            existing['KB_CHAT_TOMBS'] = _kbc_tomb
        # 应用删除墓碑：从 PROJECTS/REPORTSTATE 移除已删项目，并持久化墓碑列表
        if _tomb:
            existing['DELETED_PROJECTS'] = sorted(_tomb)
            for _dk in _tomb:
                for _sect in ('PROJECTS', 'REPORTSTATE', 'PENDING_CONFIRMS', 'UPLOADS', 'KB_FILE_CHUNKS'):
                    if isinstance(existing.get(_sect), dict):
                        existing[_sect].pop(_dk, None)
        # 应用企业线索墓碑：从 PROJECTS[pk].clues 里永久移除已删企业
        if _ctomb:
            existing['DELETED_CLUES'] = sorted(_ctomb)
            _projs = existing.get('PROJECTS')
            if isinstance(_projs, dict):
                for _pk, _pv in _projs.items():
                    if not isinstance(_pv, dict):
                        continue
                    _cl = _pv.get('clues')
                    if not isinstance(_cl, list) or not _cl:
                        continue
                    _pv['clues'] = [
                        _c for _c in _cl
                        if not (isinstance(_c, dict) and _clue_tombstoned(_pk, _c, _ctomb))
                    ]
        # 【2026-09-18】再应用一次条目墓碑：incoming 可能带回已删条目；
        # 并持久化墓碑本体，使任何客户端下次 GET 都拉不到已删条目。
        if _itomb:
            existing['KB_ITEM_TOMBS'] = _itomb
            _n_rm = _apply_kb_item_tombs(existing.get('PROJECTS'), _itomb)
            if _n_rm:
                print('[sync] kb item tombs removed %d entrie(s)' % _n_rm)
        data_str = json.dumps(existing, ensure_ascii=False)
    except Exception as e:
        print(f"[sync] merge error: {e}")
        resp = json.dumps({'ok': False, 'error': 'sync validation or storage read failed'}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(resp)))
        self.cors(); self.end_headers(); self.wfile.write(resp)
        return
    if deps.use_database:
        ok = deps.write(data_str)
        resp = json.dumps({'ok': ok}).encode()
    else:
        try:
            deps.snapshot_file()
            with open(deps.file_path, 'w', encoding='utf-8') as f:
                f.write(data_str)
            resp = json.dumps({'ok': True}).encode()
        except Exception as e:
            resp = json.dumps({'ok': False, 'error': str(e)}).encode()
    self.send_response(200)
    self.send_header('Content-Type', 'application/json')
    self.send_header('Content-Length', str(len(resp)))
    self.cors(); self.end_headers(); self.wfile.write(resp)
    return
