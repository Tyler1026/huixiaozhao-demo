"""Legacy saved-line chain generation cannot bypass the original-source route."""
import unittest
from backend.evidence_grounding import evidence_catalog, ground_chain


class LegacyChainBoundaryTests(unittest.TestCase):
    def test_saved_report_suggestion_with_real_url_is_not_original_evidence(self):
        topic='商业火箭'
        cat=evidence_catalog([{'id':'report','topic':topic,'text':'建议核实商业火箭总装测试需求。来源 https://www.shanghai.gov.cn/a'}])
        with self.assertRaisesRegex(ValueError,'legacy_chain_disabled'):
            ground_chain([{'seg':'中游','nodes':[{'name':'商业火箭总装测试','evidence_ids':[cat[0]['id']]}]}],cat,{'topic':topic,'city':'闵行区'})

    def test_legacy_empty_or_malformed_inputs_do_not_report_success(self):
        for value in ([],{},[{'seg':'其他','nodes':[None]}]):
            with self.assertRaisesRegex(ValueError,'legacy_chain_disabled'):
                ground_chain(value,[],{'topic':'商业火箭','city':'闵行区'})


if __name__=='__main__':unittest.main()
