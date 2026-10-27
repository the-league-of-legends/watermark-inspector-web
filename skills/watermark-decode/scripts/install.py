#!/usr/bin/env python3
"""安装独立环境及命令，不修改系统Python或其他证据工具环境。"""
from pathlib import Path
import os,subprocess,sys
base=Path.home()/'.local/share/watermark-decode/venv'
subprocess.run([sys.executable,'-m','venv',str(base)],check=True)
python=base/('Scripts/python.exe' if os.name=='nt' else 'bin/python')
subprocess.run([str(python),'-m','pip','install','Pillow>=10,<15'],check=True)
if os.name!='nt':
    import shlex
    cmd=Path.home()/'.local/bin/watermark-decode';cmd.parent.mkdir(parents=True,exist_ok=True)
    if cmd.exists() and 'Managed by watermark-decode' not in cmd.read_text() and str(Path(__file__).with_name('watermark_decode.py')) not in cmd.read_text():raise RuntimeError('Refusing to replace an unrelated command')
    cmd.write_text('#!/bin/sh\n# Managed by watermark-decode\nexec '+shlex.quote(str(python))+' '+shlex.quote(str(Path(__file__).with_name('watermark_decode.py')))+' "$@"\n');cmd.chmod(0o755)
print('Python:',python)
