"""Pure snapshot merge rules, relocated without semantic changes."""
def _keep_nonempty(existing_val, incoming_val):
    """入参为空（None/空串/空 list/dict）时不覆盖已有非空值——防止旧快照把刚同步的数据冲掉。"""
    if incoming_val is None:
        return existing_val
    if isinstance(incoming_val, (list, dict, str)) and len(incoming_val) == 0:
        return existing_val
    return incoming_val

def _kb_item_fp(text):
    """与前端 _kbItemFp 完全一致：剥空白与 ✅/⚠ 前缀，取前 80 字符。
    前端 index.html / ops.html 用的是同一套规则，两边必须一致否则墓碑对不上。"""
    if isinstance(text, dict):
        t = text.get("text") or ""
    elif isinstance(text, str):
        t = text
    else:
        t = ""
    t = "".join(t.split())
    while t[:1] in ("✅", "⚠", "️"):
        t = t[1:]
    return t[:80]


def _apply_kb_item_tombs(projects, itombs):
    """把「知识条目删除墓碑」应用到 PROJECTS：按内容指纹移除 kb[i].known 的条目。

    为什么服务端必须做这件事（2026-09-18）：
    _merge_map 对 kb 的规则是「材料条数 >= 旧值才接受」，本意是防止旧快照(0 材料)
    冲掉刚推送的 RAG。但删除会让条数变少，于是删除后的快照被服务端直接判负丢弃
    —— 客户端墓碑再完善也没用，因为覆盖发生在服务端存储里，任何客户端下次 GET
    拉到的都还是含已删条目的旧数据（表现为「删了又自己回来」）。
    解法：合并前先把墓碑应用到 existing，旧值条数已扣除，原门槛逻辑无需改动。
    itombs 结构：{projKey: {kbIdx(str): {fp: ts}}}
    返回实际移除条数。"""
    if not isinstance(projects, dict) or not isinstance(itombs, dict):
        return 0
    removed = 0
    for pk, sec_map in itombs.items():
        proj = projects.get(pk)
        if not isinstance(proj, dict) or not isinstance(sec_map, dict):
            continue
        kb = proj.get("kb")
        if not isinstance(kb, list):
            continue
        for ki, fp_map in sec_map.items():
            try:
                idx = int(ki)
            except (TypeError, ValueError):
                continue
            if idx < 0 or idx >= len(kb):
                continue
            sect = kb[idx]
            if not isinstance(sect, dict):
                continue
            known = sect.get("known")
            if not isinstance(known, list) or not known:
                continue
            if not isinstance(fp_map, dict) or not fp_map:
                continue
            kept = [x for x in known if _kb_item_fp(x) not in fp_map]
            removed += len(known) - len(kept)
            sect["known"] = kept
    return removed


def _merge_kb_item_tombs(old, new):
    """合并两端墓碑，逐指纹取较新 ts。"""
    out = {}
    for src in (old, new):
        if not isinstance(src, dict):
            continue
        for pk, sec_map in src.items():
            if not isinstance(sec_map, dict):
                continue
            out.setdefault(pk, {})
            for ki, fp_map in sec_map.items():
                if not isinstance(fp_map, dict):
                    continue
                bucket = out[pk].setdefault(str(ki), {})
                for fp_key, ts in fp_map.items():
                    try:
                        tsi = int(ts)
                    except (TypeError, ValueError):
                        tsi = 0
                    try:
                        prev = int(bucket.get(fp_key) or 0)
                    except (TypeError, ValueError):
                        prev = 0
                    if tsi >= prev:
                        bucket[fp_key] = tsi
    return out


def _kb_material_count(kb):
    """统计一个 project.kb 的累计材料条数（4 主题 known[] 之和）。"""
    if not isinstance(kb, list):
        return 0
    n = 0
    for t in kb:
        if isinstance(t, dict):
            n += len(t.get("known") or [])
    return n

_CLUE_TONE_RANK = {"slate": 1, "amber": 2, "teal": 3}

import re as _re_clue

# 【2026-09-22 修复 P0】clue 墓碑按企业名匹配，不按 clue.id。
# AI 漏斗 id 曾是 'f_<projKey>_<下标>'，下标随每次重跑重新分配，同一 id 跨两次
# 漏斗指向不同企业。旧实现按 id 匹配，导致上一批删除的企业留下的墓碑在下一批把
# 排到同一下标的新企业静默删掉（实测诺唯赞生物 88 分被吞）。
# 因此位置型 id 的旧墓碑一律不再生效，只认企业名；手工录入的
# clue_manual_<时间戳> 唯一不复用，legacy 键继续兼容。
_REUSABLE_CLUE_ID = _re_clue.compile(r"^f_.+_\d+$")
_CLUE_NAME_SUFFIX = _re_clue.compile(r"[\uff08(][^\uff09)]*[\uff09)]\s*$")


def _clue_name_key(name):
    # 与 index.html / ops.html 的 _clueNameKey 同口径
    if name is None:
        return ""
    s = _CLUE_NAME_SUFFIX.sub("", str(name))
    return _re_clue.sub(r"\s+", "", s).strip()


def _clue_tombstoned(proj_key, clue, tombs):
    if not tombs or not isinstance(clue, dict):
        return False
    nk = _clue_name_key(clue.get("name"))
    if nk and ("%s::@%s" % (proj_key, nk)) in tombs:
        return True
    cid = clue.get("id")
    if cid is not None and not _REUSABLE_CLUE_ID.match(str(cid)):
        if ("%s::%s" % (proj_key, cid)) in tombs:
            return True
    return False


def _merge_stage_by_topic(old_sbt, new_sbt):
    """方向级进度只进不退：逐 topic 取较大值。"""
    if not isinstance(old_sbt, dict):
        return new_sbt
    if not isinstance(new_sbt, dict):
        return old_sbt
    out = dict(old_sbt)
    for t, nv in new_sbt.items():
        try:
            nvi = int(nv)
        except (TypeError, ValueError):
            continue
        try:
            ovi = int(out.get(t) or 0)
        except (TypeError, ValueError):
            ovi = 0
        out[t] = nvi if nvi > ovi else ovi
    return out


def _merge_clues(old_clues, new_clues):
    """线索核验状态只进不退（tone: slate < amber < teal），按 id 对齐。
    incoming 独有的线索并入，服务端独有的保留。
    旧实现是整表覆盖：任何持旧快照的标签页 POST 都会把已核验的 amber/teal 打回 slate，
    连带 nextStepGuide 判断的\"核验中\"提示一起消失。"""
    if not isinstance(old_clues, list) or not old_clues:
        return new_clues
    if not isinstance(new_clues, list) or not new_clues:
        return old_clues
    by_id, order = {}, []
    for c in old_clues:
        if isinstance(c, dict) and c.get("id") is not None:
            by_id[c["id"]] = dict(c)
            order.append(c["id"])
    if not by_id:
        return new_clues
    for c in new_clues:
        if not isinstance(c, dict) or c.get("id") is None:
            continue
        cid = c["id"]
        ex = by_id.get(cid)
        if ex is None:
            by_id[cid] = dict(c)
            order.append(cid)
            continue
        merged_c = dict(ex)
        merged_c.update(c)
        # tone/status 只进不退：incoming 更弱时保留服务端已推进的核验状态
        if _CLUE_TONE_RANK.get(c.get("tone"), 0) < _CLUE_TONE_RANK.get(ex.get("tone"), 0):
            merged_c["tone"] = ex.get("tone")
            merged_c["status"] = ex.get("status")
        by_id[cid] = merged_c
    return [by_id[i] for i in order]


import json as _chain_json
import math as _chain_math
import time as _chain_time

_CHAIN_MAPS = ("chainByTopic", "chainEvidenceByTopic", "chainStatusByTopic")


def _chain_source_matches(meta, topic, report, projects, key):
    if not isinstance(projects, dict) or not isinstance(projects.get(key), dict):
        return False
    project = projects[key]
    root = project.get('workspaceId') or key
    if not isinstance(root, str) or not root:
        return False
    keys = [key] if root == key else [root, key]
    if any(not isinstance(projects.get(item), dict) for item in keys):
        return False
    try:
        supplied = _chain_json.loads(meta['sourceIdentity'], parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
    except (ValueError, TypeError, KeyError):
        return False
    if not isinstance(supplied, dict):
        return False
    texts = report.get('aiReportByTopic') or {}
    if not isinstance(texts, dict):
        return False
    expected = {'workspace': root, 'city': project.get('city') or '', 'topic': topic,
                'selectedTopic': project.get('topic') or '',
                'requestId': project.get('reportRequestId') or report.get('reportRequestId') or '',
                'kb': [(projects.get(item) or {}).get('kb') or [] for item in keys],
                'onboarding': project.get('onboarding') or {},
                'report': texts.get(topic) or (report.get('text') if report.get('topic') == topic else '') or ''}
    # Parsed equality permits JSON's equivalent 1/1.0 and Unicode/key ordering,
    # while booleans remain distinct from numbers, as in JavaScript.
    def equal(left, right):
        if isinstance(left, bool) or isinstance(right, bool):
            return type(left) is type(right) and left == right
        if isinstance(left, (int, float)) and isinstance(right, (int, float)):
            if any(isinstance(value, float) and not _chain_math.isfinite(value) for value in (left, right)):
                return False
            return left == right
        if type(left) is not type(right):
            return False
        if isinstance(left, dict):
            return left.keys() == right.keys() and all(equal(left[k], right[k]) for k in left)
        if isinstance(left, list):
            return len(left) == len(right) and all(equal(a, b) for a, b in zip(left, right))
        return left == right
    return meta.get('requestId') == (project.get('reportRequestId') or '') and equal(supplied, expected)


def _chain_bundle(record, topic, report, projects=None, key=None):
    """Validate a complete saved graph; this is provenance, not a fact verdict."""
    if not isinstance(record, dict) or not isinstance(report, dict):
        return None
    chain = (record.get("chainByTopic") or {}).get(topic) if isinstance(record.get("chainByTopic"), dict) else None
    meta = (record.get("chainEvidenceByTopic") or {}).get(topic) if isinstance(record.get("chainEvidenceByTopic"), dict) else None
    status = (record.get("chainStatusByTopic") or {}).get(topic) if isinstance(record.get("chainStatusByTopic"), dict) else None
    texts = report.get("aiReportByTopic")
    text = texts.get(topic) if isinstance(texts, dict) else None
    if not text and report.get("topic") == topic:
        text = report.get("text")
    if not isinstance(meta, dict) or not isinstance(text, str) or not text:
        return None
    version = meta.get("generatedAt")
    if (meta.get("contract") != "saved-excerpts-v1" or meta.get("scope") != "current-topic-v1"
            or meta.get("topic") != topic or meta.get("reportText") != text
            or not isinstance(meta.get("requestId"), str)
            or not isinstance(meta.get("sourceIdentity"), str) or not meta["sourceIdentity"]
            or isinstance(version, bool) or not isinstance(version, int)
            or version <= 0 or version > int(_chain_time.time() * 1000) + 300000
            or status != "ready" or not isinstance(chain, list) or len(chain) != 3):
        return None
    if [segment.get("seg") if isinstance(segment, dict) else None for segment in chain] != ["上游", "中游", "下游"]:
        return None
    if any(not isinstance(segment.get("nodes"), list) for segment in chain):
        return None
    if not _chain_source_matches(meta, topic, report, projects, key):
        return None
    return chain, meta, status, version


def _merge_chain_maps(existing, incoming, report, projects=None, key=None):
    """Merge graph/node/provenance/status atomically per topic, never whole maps.

    Legacy caches are retained but cannot displace a versioned current-topic
    graph. Invalid/partial/stale writes do not change any of the three fields.
    Graphs cannot create report text or revive a removed project/topic.
    """
    result = {field: dict(existing.get(field) or {}) if isinstance(existing.get(field), dict) else {}
              for field in _CHAIN_MAPS}
    topics = set()
    for field in _CHAIN_MAPS:
        if isinstance(incoming.get(field), dict):
            topics.update(incoming[field])
    for topic in topics:
        if not isinstance(topic, str) or not topic:
            continue
        new = _chain_bundle(incoming, topic, report, projects, key)
        if new is None:
            continue
        old = _chain_bundle(existing, topic, report, projects, key)
        # Equal versions keep the saved bundle, even if a late tab changes it.
        if old is not None and new[3] <= old[3]:
            continue
        # Even if the report has changed, an older page must not replace a
        # newer saved graph; its old graph remains non-renderable by identity.
        old_meta = result["chainEvidenceByTopic"].get(topic)
        old_version = old_meta.get("generatedAt") if isinstance(old_meta, dict) else None
        if (isinstance(old_version, int) and not isinstance(old_version, bool)
                and 0 < old_version <= int(_chain_time.time() * 1000) + 300000
                and old_version >= new[3]):
            continue
        for field, value in zip(_CHAIN_MAPS, new[:3]):
            result[field][topic] = value
    return result


def _merge_map(old, new, *, chain_projects=None):
    """按 key 合并 dict-of-dict（PROJECTS / REPORTSTATE / CITY_ACCOUNTS）：
    - 逐字段保留非空值；新增 key 直接并入。
    - kb 字段特判：非空列表也可能是「4 空主题」的占位骨架，按累计材料条数比较，
      材料更多的一方胜出——防止旧快照(0 材料)冲掉刚推送的 RAG。
    - REPORTSTATE 的 text 同理：更长的正文胜出。
    - 【2026-09-17 修复】stage / stageByTopic / clues 只进不退：
      旧实现走 _keep_nonempty，即「后写者胜」。任一持旧快照的标签页（多开政府端+管理端，
      或 5 秒 persist 防抖窗口内的同一页面）POST 上来，就把服务端已推进的 stage=4
      直接压回 3，表现为「点到资源匹配后又退回确认需求」。
      浏览器侧的只进不退拦不住这一层——覆盖发生在服务端存储里，
      任何客户端下次 GET 拉到的就已经是退化后的值。"""
    merged = {k: (dict(v) if isinstance(v, dict) else v) for k, v in (old or {}).items()}
    for k, v in (new or {}).items():
        if not isinstance(v, dict):
            merged[k] = v; continue
        base = merged.get(k)
        if not isinstance(base, dict):
            merged[k] = dict(v)
            if any(field in v for field in _CHAIN_MAPS):
                bundles = _merge_chain_maps({}, v, merged[k], chain_projects, k)
                for field in _CHAIN_MAPS:
                    merged[k].pop(field, None)
                    if bundles[field]:
                        merged[k][field] = bundles[field]
            continue
        previous = dict(base)
        chain_fields = any(field in v for field in _CHAIN_MAPS)
        for fk, fv in v.items():
            if fk in _CHAIN_MAPS:
                continue
            if fk == "kb":
                # 材料多的一方胜出（相等时接受新值，允许内容更新）
                if _kb_material_count(fv) >= _kb_material_count(base.get("kb")):
                    base[fk] = fv
                continue
            if fk == "text":
                if len(fv or "") >= len(base.get("text") or ""):
                    base[fk] = fv
                continue
            if fk == "stage":
                try:
                    _nv = int(fv)
                except (TypeError, ValueError):
                    continue
                try:
                    _ov = int(base.get("stage") or 0)
                except (TypeError, ValueError):
                    _ov = 0
                if _nv > _ov:
                    base[fk] = _nv
                continue
            if fk == "stageByTopic":
                base[fk] = _merge_stage_by_topic(base.get("stageByTopic"), fv)
                continue
            if fk == "clues":
                base[fk] = _merge_clues(base.get("clues"), fv)
                continue
            if fk == "customStages":
                # 【2026-09-18】自定义阶段只增不减：并集（保序）。
                # 走 _keep_nonempty 即「后写者胜」，任一持旧快照的标签页 POST 上来，
                # 就会把管理端刚新增的阶段（如「第一次会议」）从项目里抹掉，
                # 政府端进度条随之少一格。
                if isinstance(fv, list):
                    _cs = [x for x in (base.get("customStages") or []) if isinstance(x, str)]
                    for _x in fv:
                        if isinstance(_x, str) and _x not in _cs:
                            _cs.append(_x)
                    base[fk] = _cs
                continue
            base[fk] = _keep_nonempty(base.get(fk), fv)
        if chain_fields:
            bundles = _merge_chain_maps(previous, v, base, chain_projects, k)
            for field in _CHAIN_MAPS:
                if field in previous or bundles[field]:
                    base[field] = bundles[field]
    return merged


def _merge_invite_codes(old, new):
    """按邀请码合并：新码直接并入；同码的 usedBy 按 (user,ts) 去重取并集，
    revoked 一旦任一端标记为真即视为真（作废只进不退，避免旧快照复活已作废的码）。
    不要走 _merge_map：那是给 PROJECTS/REPORTSTATE 用的，字段名(如误撞 kb/text/stage)
    会触发不相关的特判分支。"""
    if not isinstance(old, dict):
        old = {}
    if not isinstance(new, dict):
        new = {}
    merged = {k: dict(v) for k, v in old.items() if isinstance(v, dict)}
    for code, v in new.items():
        if not isinstance(v, dict):
            continue
        base = merged.get(code)
        if not isinstance(base, dict):
            merged[code] = dict(v)
            continue
        out = dict(base)
        for fk, fv in v.items():
            if fk == 'usedBy':
                seen = {}
                for rec in (base.get('usedBy') or []) + (fv or []):
                    if not isinstance(rec, dict):
                        continue
                    key = (rec.get('user'), rec.get('ts'))
                    seen[key] = rec
                out['usedBy'] = sorted(seen.values(), key=lambda r: r.get('ts') or 0)
                continue
            if fk == 'revoked':
                out['revoked'] = bool(base.get('revoked')) or bool(fv)
                continue
            out[fk] = _keep_nonempty(base.get(fk), fv)
        merged[code] = out
    return merged
