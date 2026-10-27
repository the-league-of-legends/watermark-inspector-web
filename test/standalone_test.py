"""独立Skill端到端验证，合成数据；不依赖真实媒体或在线服务。"""
import importlib.util,json,subprocess,sys,tempfile,unittest,shutil
from pathlib import Path
from unittest import mock
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('watermark_decode',ROOT/'skills/watermark-decode/scripts/watermark_decode.py');tool=importlib.util.module_from_spec(spec);spec.loader.exec_module(tool)
class StandaloneTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.temp=tempfile.TemporaryDirectory();cls.root=Path(cls.temp.name)
  for name,rule,values in [('game',ROOT/'watermark.schema.json',{'userId':'9223372036854775807','gameId':10013,'capturedAt':1792410000}),('other',ROOT/'examples/other-project.schema.json',{'accountId':'1234567890123456','tenantId':7,'state':'open','tag':'😀','active':False})]:
   code='''const c=require(process.argv[1]),s=require(process.argv[2]),r=require(process.argv[3]),v=JSON.parse(process.argv[4]),t=c.makeTile(s.encode(r,v)),w=1080,h=2400,out=Buffer.alloc(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=(y*w+x)*4,z=((y%512)*544+x%544)*4;for(let k=0;k<3;k++)out[p+k]=t[z+k]+236;out[p+3]=255;}process.stdout.write(out);'''
   raw=subprocess.check_output(['node','-e',code,str(ROOT/'src/codec.js'),str(ROOT/'src/schema.js'),str(rule),json.dumps(values)])
   Image.frombytes('RGBA',(1080,2400),raw).save(cls.root/(name+'.png'))
 @classmethod
 def tearDownClass(cls):cls.temp.cleanup()
 def test_two_projects_explicit_rules(self):
  a=tool.decode_file(self.root/'game.png',[ROOT/'watermark.schema.json']);self.assertEqual(a['status'],'decoded');self.assertEqual(a['payload']['userId'],'9223372036854775807')
  b=tool.decode_file(self.root/'other.png',[ROOT/'examples/other-project.schema.json']);self.assertEqual(b['status'],'decoded');self.assertEqual(b['payload']['tag'],'😀');self.assertNotIn('userId',b['payload'])
 def test_legacy_protocol_does_not_claim_project_identity(self):
  vector=json.loads((ROOT/'test/vectors.json').read_text())[0]
  code="const c=require(process.argv[1]),t=c.makeTile(c.fromHex(process.argv[2])),w=1080,h=2400,a=Buffer.alloc(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=(y*w+x)*4,z=((y%512)*544+x%544)*4;for(let k=0;k<3;k++)a[p+k]=t[z+k]+236;a[p+3]=255;}process.stdout.write(a)"
  raw=subprocess.check_output(['node','-e',code,str(ROOT/'src/codec.js'),vector['payload']]);image=self.root/'legacy.png';Image.frombytes('RGBA',(1080,2400),raw).save(image)
  result=tool.decode_file(image,project=self.root);self.assertEqual(result['status'],'decoded');self.assertTrue(result['schema']['legacy']);self.assertIsNone(result['schema']['projectKey'])
 def test_wrong_and_missing_rules_do_not_guess(self):
  v=tool.decode_file(self.root/'game.png',[ROOT/'examples/other-project.schema.json']);self.assertEqual(v['status'],'unknown_schema');self.assertIsNone(v['payload'])
  with tempfile.TemporaryDirectory() as directory:
   v=tool.decode_file(self.root/'game.png',project=directory);self.assertEqual(v['status'],'unknown_schema')
 def test_history_and_project_directory(self):
  with tempfile.TemporaryDirectory() as folder:
   p=Path(folder);rule=json.loads((ROOT/'watermark.schema.json').read_text());rule['schemaVersion']=2;(p/'watermark.schema.json').write_text(json.dumps(rule));(p/'watermark.schemas').mkdir();shutil.copy(ROOT/'watermark.schema.json',p/'watermark.schemas/1.json');self.assertEqual(tool.decode_file(self.root/'game.png',project=p)['status'],'decoded')
 def test_invalid_rules_dependency_and_timeout(self):
  with tempfile.TemporaryDirectory() as directory:
   p=Path(directory)/'rules.json';p.write_text('{"projectKey":"a","projectKey":"b"}');self.assertEqual(tool.decode_file(self.root/'game.png',[p])['status'],'invalid_schema')
  with mock.patch.object(tool.shutil,'which',return_value=None):self.assertEqual(tool.decode_file(self.root/'game.png',[ROOT/'watermark.schema.json'])['status'],'dependency_error')
  self.assertEqual(tool.decode_file(self.root/'game.png',[ROOT/'watermark.schema.json'],seconds=.01)['status'],'timeout')
 def test_cli_no_source_checkout_required(self):
  cmd=[sys.executable,str(ROOT/'skills/watermark-decode/scripts/watermark_decode.py'),'decode-image',str(self.root/'other.png'),'--rules',str(ROOT/'examples/other-project.schema.json')]
  p=subprocess.run(cmd,cwd=self.root,capture_output=True,text=True);self.assertEqual(p.returncode,0,p.stderr);self.assertEqual(json.loads(p.stdout)['schema']['projectKey'],'example-shop')
if __name__=='__main__':unittest.main()
