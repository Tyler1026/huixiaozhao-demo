import copy
import json
import unittest
from backend.auth import AuthError
from backend.material_verification import verification_context, SYSTEM_VERIFY


def sample():
    return {'PROJECTS': {'a': {'city': '苏州', 'kb': [{'t': '经济', 'known': [
        {'text': '2025年苏州市地区生产总值27695.1亿元。', 'origin': 'report'},
        {'text': '错误测试文件：本市GDP999亿元。', 'sourceFile': '错误测试.docx', 'origin': 'user'}]}]},
        'b': {'city': '他市', 'kb': [{'t': '经济', 'known': ['OTHER_WORKSPACE_SECRET']}]}},
        'UPLOADS': {'a': [{'name': '错误测试.docx', 'originalId': 'u1', 'ts': 100}],
                    'b': [{'name': '他市.docx', 'originalId': 'u2', 'ts': 200}]},
        'KB_FILE_CHUNKS': {'a': [{'id': 'ch1', 'originalId': 'u1', 'cite': '错误测试.docx', 'text': '错误测试文件：本市GDP999亿元。'}],
                           'b': [{'id': 'ch2', 'originalId': 'u2', 'text': 'OTHER_WORKSPACE_SECRET'}]}}


class MaterialVerificationTests(unittest.TestCase):
    def test_saved_uploads_and_baseline_are_separate_and_client_prompt_is_not_trusted(self):
        state=sample();before=copy.deepcopy(state)
        result=verification_context({'projectKey':'a','verifyOriginalIds':['u1'],
            'question':'INJECTED_PROMPT','chunks':[{'text':'FAKE_CLIENT_DATA'}]},state)
        data=json.loads(result['question'])
        self.assertEqual(result['city'],'苏州')
        self.assertEqual(len(data['上传材料']),1)
        self.assertEqual(len(data['对照材料']),1)
        self.assertIn('27695.1',data['对照材料'][0]['原文'])
        self.assertNotIn('999',data['对照材料'][0]['原文'])
        for text in ('INJECTED_PROMPT','FAKE_CLIENT_DATA','OTHER_WORKSPACE_SECRET'):
            self.assertNotIn(text,result['question'])
        self.assertEqual(state,before)

    def test_changed_deleted_or_foreign_upload_cannot_be_selected(self):
        for body in ({'verifyOriginalIds':['u2']},{'verifyFiles':['他市.docx']}):
            with self.assertRaises(AuthError):
                verification_context(dict(body,projectKey='a'),sample())
        state=sample();state['UPLOAD_TOMBS']={'a::错误测试.docx':1}
        with self.assertRaises(AuthError):
            verification_context({'projectKey':'a'},state)
        with self.assertRaises(AuthError):
            verification_context({'projectKey':'missing'},sample())

    def test_file_name_selection_supports_legacy_parsed_chunks(self):
        state=sample()
        result=verification_context({'projectKey':'a','verifyFiles':['错误测试.docx']},state)
        self.assertIn('999',result['question'])
        self.assertEqual(len(json.loads(result['question'])['上传材料']),1)

    def test_large_batches_are_rejected_instead_of_silently_clipped(self):
        state=sample();state['KB_FILE_CHUNKS']['a'][0]['text']='a'*16001
        with self.assertRaises(AuthError) as caught:
            verification_context({'projectKey':'a'},state)
        self.assertEqual(caught.exception.status,413)

    def test_malformed_selection_and_different_period_rules(self):
        for selected in ('u1',{},[2]):
            with self.assertRaises(AuthError):
                verification_context({'projectKey':'a','verifyOriginalIds':selected},sample())
        self.assertIn('年份、区域、主体、单位或口径不同',SYSTEM_VERIFY)
        self.assertIn('一致不代表真实',SYSTEM_VERIFY)


if __name__=='__main__':unittest.main()
