import {copyFile,mkdir,writeFile,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url)),target=root+'skills/watermark-decode/scripts/core/';await mkdir(target,{recursive:true});const hashes={};
for(const name of ['codec.js','schema.js']){await copyFile(root+'src/'+name,target+name);hashes[name]=createHash('sha256').update(await readFile(target+name)).digest('hex');}
await copyFile(root+'LICENSE.upstream',target+'LICENSE.upstream');await writeFile(target+'manifest.json',JSON.stringify(hashes,null,2)+'\n');
