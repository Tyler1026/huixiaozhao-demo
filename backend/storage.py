"""Legacy persistence boundary. Import has no database I/O."""
import os
import time
try:
    import psycopg2
    _PG_AVAIL=True
except ImportError:
    _PG_AVAIL=False

# HTML 与 server.py 同目录（云端部署打包在一起）
SYNC_PATH    = os.environ.get("SYNC_PATH", "/tmp/sync_data.json")
DATABASE_URL = os.environ.get("DATABASE_URL", "")

def _db_conn():
    return psycopg2.connect(DATABASE_URL)

def _init_db():
    if not (_PG_AVAIL and DATABASE_URL):
        print("[db] 未配置 DATABASE_URL，使用文件存储降级模式")
        return
    try:
        conn = _db_conn()
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS sync_data (
                id INTEGER PRIMARY KEY DEFAULT 1,
                data TEXT NOT NULL DEFAULT '{}',
                updated_at TIMESTAMP DEFAULT NOW(),
                CHECK (id = 1)
            )
        """)
        # 【2026-09-18】写入前快照表：sync_data 是 id=1 单行原地覆盖，
        # 一次误写就永久丢数据（松江智库 238 条即因此丢失）。这里留一条后路。
        cur.execute("""
            CREATE TABLE IF NOT EXISTS sync_history (
                ts BIGINT PRIMARY KEY,
                data TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        conn.commit(); cur.close(); conn.close()
        print("[db] PostgreSQL sync_data + sync_history 表就绪")
    except Exception as e:
        print(f"[db] 初始化失败: {e}")

def _db_get():
    try:
        conn = _db_conn(); cur = conn.cursor()
        cur.execute("SELECT data FROM sync_data WHERE id=1")
        row = cur.fetchone(); cur.close(); conn.close()
        return row[0] if row else '{}'
    except Exception as e:
        print(f"[db] 读取失败: {e}"); return None

SNAPSHOT_KEEP = 30   # 保留最近 N 份写入前快照

def _db_snapshot(cur):
    """把当前 sync_data 存进 sync_history，并裁剪到最近 SNAPSHOT_KEEP 份。
    只在数据非空时存，避免空快照占满历史。"""
    try:
        cur.execute("SELECT data FROM sync_data WHERE id=1")
        row = cur.fetchone()
        old = row[0] if row else None
        if not old or len(old) < 50:
            return
        cur.execute("INSERT INTO sync_history(ts,data) VALUES(%s,%s) ON CONFLICT(ts) DO NOTHING",
                    (int(time.time() * 1000), old))
        cur.execute("DELETE FROM sync_history WHERE ts NOT IN "
                    "(SELECT ts FROM sync_history ORDER BY ts DESC LIMIT %s)", (SNAPSHOT_KEEP,))
    except Exception as e:
        print(f"[db] 快照失败(不阻断写入): {e}")

def _db_set(data_str):
    try:
        conn = _db_conn(); cur = conn.cursor()
        _db_snapshot(cur)          # 覆盖前先留一份旧值
        cur.execute(
            "INSERT INTO sync_data(id,data,updated_at) VALUES(1,%s,NOW()) "
            "ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,updated_at=NOW()",
            (data_str,))
        conn.commit(); cur.close(); conn.close(); return True
    except Exception as e:
        print(f"[db] 写入失败: {e}"); return False

def _file_snapshot():
    """文件存储模式：写入前把旧 SYNC_PATH 复制为 .bak.<ts>，保留最近 SNAPSHOT_KEEP 份。"""
    try:
        if not os.path.exists(SYNC_PATH):
            return
        if os.path.getsize(SYNC_PATH) < 50:
            return
        import shutil, glob
        bak = '%s.bak.%d' % (SYNC_PATH, int(time.time() * 1000))
        shutil.copy2(SYNC_PATH, bak)
        olds = sorted(glob.glob(SYNC_PATH + '.bak.*'))
        for f in olds[:-SNAPSHOT_KEEP]:
            try:
                os.remove(f)
            except Exception:
                pass
    except Exception as e:
        print(f"[snap] 文件快照失败(不阻断写入): {e}")

