#!/usr/bin/env python3
"""Build a source release using explicit paths; never package local data or credentials."""
import hashlib
from pathlib import Path
import tarfile

root = Path(__file__).resolve().parent.parent
output = root / 'out' / 'qarzhy-ubuntu24.tar.gz'
paths = ['app', 'backend', 'components', 'features', 'public', 'server',
         'deploy/ubuntu24', 'docs/sql/migrations', 'scripts',
         'package.json', 'package-lock.json', 'next.config.ts', 'tsconfig.json', 'proxy.ts']
allowed = {'.ts', '.tsx', '.mjs', '.js', '.json', '.css', '.svg', '.png', '.jpg', '.jpeg',
           '.webp', '.ico', '.woff', '.woff2', '.py', '.sql', '.md', '.service', '.conf', '.example'}
files = []
for entry in paths:
    path = root / entry
    for file in sorted(path.rglob('*')) if path.is_dir() else [path]:
        if file.is_symlink():
            raise RuntimeError(f'Symlink refused: {file.relative_to(root)}')
        if not file.is_file() or file.suffix not in allowed:
            continue
        relative = file.relative_to(root)
        if any(part.startswith('.') or part in {'node_modules', '__pycache__'} for part in relative.parts):
            continue
        files.append(file)
output.parent.mkdir(exist_ok=True)
with tarfile.open(output, 'w:gz') as archive:
    for file in files:
        archive.add(file, arcname='qarzhy/' + str(file.relative_to(root)), recursive=False)
with tarfile.open(output) as archive:
    names = archive.getnames()
    assert not any('/data/' in n or '/.env' in n or n.endswith(('.dump', '.sqlite')) for n in names)
digest = hashlib.sha256(output.read_bytes()).hexdigest()
output.with_suffix(output.suffix + '.sha256').write_text(f'{digest}  {output.name}\n')
print(f'{output}\n{output.stat().st_size} bytes; {len(files)} files\nSHA256 {digest}')
