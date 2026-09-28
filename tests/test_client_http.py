"""Run the shipped JS client against the real isolated HTTP server."""
import pathlib
import subprocess
import unittest
import test_identity_http as harness


class ClientHTTPTests(unittest.TestCase):
    setUp = harness.HTTPTests.setUp
    tearDown = harness.HTTPTests.tearDown

    def test_actual_client_login_save_reload_logout(self):
        source = r'''
const assert=require('node:assert/strict');
const {createClient}=require('./identity/client.cjs');
const base=process.argv[1];
let cookie='';
const wrapped=async(path,options)=>{
 const headers=Object.assign({},options.headers,{Origin:base});
 if(cookie)headers.Cookie=cookie;
 const response=await fetch(base+path,Object.assign({},options,{headers}));
 const next=response.headers.get('set-cookie');
 if(next)cookie=next.split(';')[0];
 return response;
};
(async()=>{
 const client=createClient(wrapped);
 await client.login('alice','alice password long enough');
 assert.deepEqual((await client.load()).PROJECTS,{});
 await client.save({PROJECTS:{synthetic:{city:'same'}}});
 assert.equal((await client.load()).PROJECTS.synthetic.city,'same');
 await client.logout();
 await assert.rejects(client.load(),/unauthorized/);
 await client.login('bob','bob password long enough');
 assert.deepEqual((await client.load()).PROJECTS,{});
 console.log('real client -> real HTTP -> scoped database PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
'''
        root = pathlib.Path(__file__).resolve().parents[1]
        result = subprocess.run(['node', '-e', source, self.origin], cwd=root,
                                capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('scoped database PASS', result.stdout)


if __name__ == '__main__':
    unittest.main()
