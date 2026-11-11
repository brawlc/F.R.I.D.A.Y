import {cp,mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const root=resolve('cloud-package');await mkdir(root,{recursive:true});
for(const dir of ['distributed','briefing','communications','research']){
 const source=join('backend',dir),dest=join(root,source);await mkdir(dest,{recursive:true});
 for(const name of await readdir(source))if(name.endsWith('.mjs')&&!/manual|probe|smoke/.test(name))await cp(join(source,name),join(dest,name));
}
await cp('mobile-dist',join(root,'mobile-dist'),{recursive:true});
const dependencies={};for(const name of ['express','pdfkit','@fontsource/noto-sans','@simplewebauthn/server'])dependencies[name]=JSON.parse(await readFile(join('node_modules',name,'package.json'),'utf8')).version;
await writeFile(join(root,'package.json'),JSON.stringify({name:'friday-private-core',private:true,type:'module',engines:{node:'>=24.0.0'},dependencies,scripts:{start:'node backend/distributed/server.mjs'}},null,2));
console.log('Prepared cloud-package from explicit code/assets only. No .env, memory, desktop server or models copied. Review and lock dependencies before deployment.');
