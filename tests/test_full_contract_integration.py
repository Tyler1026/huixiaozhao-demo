import unittest
from report_service.full_contract import STAGES, make_synthetic_part, assemble, validate


class WholeContractTests(unittest.TestCase):
    def test_every_assembled_synthetic_stage_passes_with_real_partial_context(self):
        prior = {}
        for stage in STAGES:
            parts = []
            for part in stage['parts']:
                parts.append(make_synthetic_part(stage['id'], part, {'city': '合成区'}, prior))
                prior[stage['id']] = assemble(stage['id'], parts)
            output = assemble(stage['id'], parts)
            self.assertEqual(validate(stage['id'], output['text'], output['metadata'], synthetic=True), [], stage['id'])


if __name__ == '__main__': unittest.main()
