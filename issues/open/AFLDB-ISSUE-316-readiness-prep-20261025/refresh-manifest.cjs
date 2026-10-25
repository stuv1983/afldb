'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const files=fs.readdirSync(__dirname).filter(p=>fs.statSync(path.join(__dirname,p)).isFile()&&p!=='SHA256SUMS').sort();
const sums=files.map(p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,p))).digest('hex')+'  '+p).join('\n')+'\n';
fs.writeFileSync(path.join(__dirname,'SHA256SUMS'),sums);
console.log(JSON.stringify({preparation_members:files.length,manifest_sha256:crypto.createHash('sha256').update(sums).digest('hex'),freshness_evidence:false}));
