import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from backup_postgres import parse_settings


class BackupSettingsTest(unittest.TestCase):
    def test_unquoted_whitespace_and_equals(self):
        self.assertEqual(parse_settings('PGUSER= user\nPGPASSWORD= a=b  '),{'PGUSER':'user','PGPASSWORD':'a=b'})

    def test_quoted_spaces_preserved_without_shell_expansion(self):
        self.assertEqual(parse_settings('PGPASSWORD=" $HOME=$(bad) "')['PGPASSWORD'],' $HOME=$(bad) ')

    def test_unknown_settings_rejected(self):
        with self.assertRaises(ValueError):parse_settings('HOME=/tmp')
