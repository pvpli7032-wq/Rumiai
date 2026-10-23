import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

const root=fileURLToPath(new URL('../../',import.meta.url));
const slash=value=>value.replaceAll('\\','/');
const methods=new Set(['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']);
const authNames=new Set(['getAuthUser','requireUser','requireAdmin']);
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(dir,entry.name)):[path.join(dir,entry.name)]);
const routes=[];
for(const application of ['web','admin','api']){
  const appRoot=path.join(root,'apps',application,'src/app');
  for(const file of walk(appRoot).filter(file=>/\/(?:page\.tsx|route\.ts)$/.test(slash(file)))){
    const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
    const exports=new Set();
    const backend=new Set();
    const authenticationCalls=new Set();
    function visit(node){
      if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)&&node.moduleSpecifier.text.startsWith('@rumiai/backend/'))backend.add(node.moduleSpecifier.text);
      if(ts.isFunctionDeclaration(node)&&node.name&&node.modifiers?.some(modifier=>modifier.kind===ts.SyntaxKind.ExportKeyword)&&methods.has(node.name.text))exports.add(node.name.text);
      if(ts.isVariableStatement(node)&&node.modifiers?.some(modifier=>modifier.kind===ts.SyntaxKind.ExportKeyword)){
        for(const declaration of node.declarationList.declarations)if(ts.isIdentifier(declaration.name)&&methods.has(declaration.name.text))exports.add(declaration.name.text);
      }
      if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&authNames.has(node.expression.text))authenticationCalls.add(node.expression.text);
      ts.forEachChild(node,visit);
    }
    visit(source);
    const parts=slash(path.relative(appRoot,path.dirname(file))).split('/').filter(part=>part&&!/^\(.*\)$/.test(part));
    routes.push({application,kind:path.basename(file)==='route.ts'?'handler':'page',url:'/'+parts.join('/'),methods:[...exports].sort(),source:slash(path.relative(root,file)),backendServices:[...backend].sort(),authenticationCalls:[...authenticationCalls].sort()});
  }
}
routes.sort((a,b)=>a.application.localeCompare(b.application)||a.url.localeCompare(b.url));
const report={description:'Current source route map. Authentication calls are an inventory, not proof of permission coverage. Listed routes are not automatically functionally verified.',counts:Object.fromEntries(['web','admin','api'].map(app=>[app,routes.filter(route=>route.application===app).length])),routes};
fs.writeFileSync(path.join(root,'docs/route-inventory.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.counts));
