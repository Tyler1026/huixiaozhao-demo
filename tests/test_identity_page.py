import unittest
import test_identity_http as harness
import http.client


class PageTests(unittest.TestCase):
    setUp = harness.HTTPTests.setUp
    tearDown = harness.HTTPTests.tearDown

    def test_page_reuses_login_without_legacy_secrets_or_startup(self):
        c = http.client.HTTPConnection('127.0.0.1', self.port)
        c.request('GET', '/')
        r = c.getresponse(); text = r.read().decode(); c.close()
        self.assertEqual(r.status, 200)
        self.assertIn('loginUser', text)
        self.assertIn('loginPwd', text)
        self.assertIn('tenant-page.js', text)
        for forbidden in ['suizhou ——', 'admin ——', 'CITY_ACCOUNTS', 'USER_PROFILES', 'loadAuth()', 'gotoRegister()']:
            self.assertNotIn(forbidden, text)


if __name__ == '__main__':
    unittest.main()
