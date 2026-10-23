import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root=process.cwd();
const config=ts.readConfigFile(path.join(root,'tsconfig.json'),ts.sys.readFile);
if(config.error)throw Error(ts.flattenDiagnosticMessageText(config.error.messageText,'\n'));
const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,root);
const normalize=file=>path.relative(root,file).replaceAll('\\','/');
const sourceFiles=parsed.fileNames.filter(file=>!file.includes('node_modules')&&!normalize(file).startsWith('.next'));
const cache=new Map();
function inspect(file){
  if(cache.has(file))return cache.get(file);
  const content=fs.readFileSync(file,'utf8');
  const source=ts.createSourceFile(file,content,ts.ScriptTarget.Latest,true);
  const dependencies=[];
  const record=(specifier,runtime=true)=>{
    const resolved=ts.resolveModuleName(specifier,file,parsed.options,ts.sys).resolvedModule;
    dependencies.push({specifier,runtime,file:resolved&&!resolved.isExternalLibraryImport?resolved.resolvedFileName:null});
  };
  function visit(node){
    if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)){
      const clause=node.importClause;
      const names=clause?.namedBindings;
      const typeOnly=clause?.isTypeOnly||(!clause?.name&&names&&ts.isNamedImports(names)&&names.elements.length>0&&names.elements.every(item=>item.isTypeOnly));
      record(node.moduleSpecifier.text,!typeOnly);
    }
    if(ts.isExportDeclaration(node)&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier))record(node.moduleSpecifier.text,!node.isTypeOnly);
    if(ts.isImportTypeNode(node)&&ts.isLiteralTypeNode(node.argument)&&ts.isStringLiteral(node.argument.literal))record(node.argument.literal.text,false);
    if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword&&node.arguments.length===1&&ts.isStringLiteral(node.arguments[0]))record(node.arguments[0].text);
    ts.forEachChild(node,visit);
  }
  visit(source);
  const client=source.statements.some(node=>ts.isExpressionStatement(node)&&ts.isStringLiteral(node.expression)&&node.expression.text==='use client');
  const result={client,dependencies};cache.set(file,result);return result;
}
const failures=new Set();
const clientReachable=new Set();
for(const file of sourceFiles){
  const owner=normalize(file);
  for(const dep of inspect(file).dependencies){
    const location=dep.file?normalize(dep.file):'';
    if(owner.startsWith('packages/')&&location.startsWith('apps/'))failures.add(`${owner}: shared package imports application ${dep.specifier}`);
    if((owner.startsWith('apps/web/')||owner.startsWith('apps/admin/'))&&location.startsWith('packages/backend/'))failures.add(`${owner}: UI app imports backend implementation ${dep.specifier}`);
    const app=owner.match(/^apps\/([^/]+)\//)?.[1];
    const targetApp=location.match(/^apps\/([^/]+)\//)?.[1];
    if(app&&targetApp&&app!==targetApp)failures.add(`${owner}: cross-application dependency ${dep.specifier}`);
    if((dep.specifier.startsWith('@web/')||dep.specifier.startsWith('@admin/')||dep.specifier.startsWith('@api/')||dep.specifier.startsWith('@rumiai/'))&&!dep.file&&!dep.specifier.endsWith('.css'))failures.add(`${owner}: unresolved workspace import ${dep.specifier}`);
  }
  if(normalize(file).startsWith('packages/contracts/')){
    const data=inspect(file);
    for(const dep of data.dependencies){
      if(dep.specifier.startsWith('node:')||dep.specifier==='@prisma/client'||dep.file&&!normalize(dep.file).startsWith('packages/contracts/'))failures.add(`${normalize(file)}: contracts runtime dependency ${dep.specifier}`);
    }
  }
}
for(const entry of sourceFiles.filter(file=>inspect(file).client)){
  const seen=new Set();
  function walk(file,chain){
    if(seen.has(file))return;seen.add(file);
    clientReachable.add(normalize(file));
    for(const dep of inspect(file).dependencies){
      if(!dep.runtime)continue;
      const location=dep.file?normalize(dep.file):'';
      if(dep.specifier.startsWith('node:')||dep.specifier==='@prisma/client'||location.startsWith('packages/backend/')){
        failures.add([...chain,dep.specifier].join(' -> '));continue;
      }
      if(dep.file&&fs.existsSync(dep.file)&&!dep.file.endsWith('.d.ts'))walk(dep.file,[...chain,location]);
    }
  }
  walk(entry,[normalize(entry)]);
}
if(process.argv.includes('--list-client'))console.log([...clientReachable].sort().join('\n'));
if(failures.size){console.error([...failures].join('\n'));process.exitCode=1;}
else console.log(`PASS: ${sourceFiles.length} source files; application isolation, shared contracts and client/server boundaries`);
