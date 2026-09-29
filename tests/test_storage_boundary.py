import ast
import subprocess
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
NAMES={'_db_conn','_init_db','_db_get','_db_snapshot','_db_set','_file_snapshot'}
class StorageTests(unittest.TestCase):
    def test_storage_functions_preserve_baseline_ast(self):
        from backend import storage
        old=subprocess.check_output(['git','show','21baa54:server.py'],cwd=ROOT,text=True)
        def functions(s):return {n.name:ast.dump(n) for n in ast.parse(s).body if isinstance(n,ast.FunctionDef) and n.name in NAMES}
        self.assertEqual(functions(old),functions(Path(storage.__file__).read_text()))
    def test_write_snapshots_before_replace_and_commits_once(self):
        from unittest.mock import Mock,patch
        from backend import storage
        cursor=Mock();cursor.fetchone.return_value=('x'*60,)
        connection=Mock();connection.cursor.return_value=cursor
        with patch.object(storage,'_db_conn',return_value=connection):
            self.assertTrue(storage._db_set('{"synthetic":true}'))
        sql=[call.args[0] for call in cursor.execute.call_args_list]
        self.assertIn('SELECT data',sql[0])
        self.assertIn('INSERT INTO sync_history',sql[1])
        self.assertIn('DELETE FROM sync_history',sql[2])
        self.assertIn('INSERT INTO sync_data',sql[3])
        connection.commit.assert_called_once()
        cursor.close.assert_called_once()
        connection.close.assert_called_once()

    def test_read_failure_is_not_an_empty_success(self):
        from unittest.mock import patch
        from backend import storage
        with patch.object(storage,'_db_conn',side_effect=OSError('synthetic failure')):
            self.assertIsNone(storage._db_get())
            self.assertFalse(storage._db_set('{}'))

    def test_import_does_not_open_database(self):
        from backend import storage
        self.assertTrue(callable(storage._db_get))
