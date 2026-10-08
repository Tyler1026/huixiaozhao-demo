"""Configuration gates are offline and cannot restore legacy ownership."""
import json
import unittest

from report_service.hosted import configured_environment, engine_status, readiness


class HostedConfigurationTests(unittest.TestCase):
    def environment(self, **changes):
        return {'DATABASE_URL': 'offline-fixture', 'DEEPSEEK_API_KEY': 'offline-private-model',
                'HXZ_SEARCH_KEY': 'offline-private-search', 'HXZ_ENABLE_LIVE': '1', **changes}

    def test_engine_selector_is_optional_but_paid_execution_stays_explicit(self):
        self.assertTrue(readiness(self.environment())['ready'])
        status = engine_status(self.environment(HXZ_ENABLE_LIVE='0', HXZ_REPORT_ENGINE='legacy'))
        self.assertEqual(status['engine'], 'standalone')
        self.assertFalse(status['configured'])
        self.assertFalse(status['worker_running'])
        self.assertNotIn('offline-private', json.dumps(status))

    def test_empty_deepseek_and_exa_fallback_fields_are_completed_in_memory(self):
        env = configured_environment(self.environment(HXZ_MODEL_URL='', HXZ_MODEL_NAME='',
            HXZ_SEARCH_KEY='', EXA_API_KEY='offline-exa', HXZ_SEARCH_PROVIDER=''))
        self.assertEqual(env['HXZ_MODEL_NAME'], 'deepseek-chat')
        self.assertEqual(env['HXZ_SEARCH_PROVIDER'], 'exa')
        self.assertTrue(readiness(env)['ready'])

    def test_invalid_provider_settings_are_reported_before_worker_restart_loop(self):
        for name, value in [('HXZ_MODEL_URL', 'http://localhost/private-fixture'),
                            ('HXZ_SEARCH_URL', 'https://user:private-fixture@example.com/search'),
                            ('HXZ_SEARCH_PROVIDER', 'unknown-private-fixture')]:
            with self.subTest(name=name):
                result = readiness(self.environment(**{name:value}))
                self.assertFalse(result['ready'])
                self.assertEqual(result['invalid'], [name])
                self.assertNotIn('private-fixture', json.dumps(result))


if __name__ == '__main__':
    unittest.main()
