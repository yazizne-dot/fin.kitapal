import sys
import unittest
from pathlib import Path
from decimal import Decimal
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from resolve_relational_issues import subtotal_is_duplicate, text_is_responsible


class ResolutionTest(unittest.TestCase):
    def test_text_does_not_hide_real_or_unexplained_money(self):
        self.assertTrue(text_is_responsible({'D':'Қасым','F':'Қасым','E':2258208,'J':'Шығыс'}))
        self.assertFalse(text_is_responsible({'D':'Қасым','F':'Other','E':2258208,'J':'Шығыс'}))
        self.assertFalse(text_is_responsible({'D':100,'F':'Қасым','E':2258208,'J':'Шығыс'}))

    def test_subtotal_requires_all_months_and_matching_values(self):
        from relational_import.workbooks import column
        detail={1:{column(c):Decimal('0.1') for c in range(3,15)},
                2:{column(c):Decimal('0.2') for c in range(3,15)}}
        total={column(c):Decimal('0.3') for c in range(3,15)}
        self.assertTrue(subtotal_is_duplicate(detail,total,[1,2]))
        total['C']=Decimal('0.31')
        self.assertFalse(subtotal_is_duplicate(detail,total,[1,2]))
        del total['C']
        self.assertFalse(subtotal_is_duplicate(detail,total,[1,2]))
