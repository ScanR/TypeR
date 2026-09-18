const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../uxp/web');
const localeRoot = path.resolve(__dirname, '../locale');
const locales = {};
for(const name of fs.readdirSync(localeRoot)) {
  const relative = name === 'messages.properties' ? name : name + '/messages.properties';
  const file = path.join(localeRoot, relative);
  if (fs.existsSync(file) && fs.statSync(file).isFile()) locales['/locale/' + relative] = fs.readFileSync(file, 'utf8');
}
const initial = {storage: {language: 'fr_FR', checkUpdates: false}, locales, locale: 'fr_FR', fonts: JSON.stringify({fonts: [{name:'Arial',postScriptName:'ArialMT',family:'Arial',style:'Regular'}]})};
const mock = `<script>window.uxpHost=window;window.postMessage=function(message){const result=message.method==='init'?${JSON.stringify(initial).replace(/</g, '\\u003c')}:message.method==='getSelectionChanged'?'{}':message.method==='pickImages'?[]:'';setTimeout(()=>window.dispatchEvent(new MessageEvent('message',{source:window,data:{channel:'typer-uxp',id:message.id,result}})),10)};</script>`;
http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));
  if (!file.startsWith(root+path.sep)||!fs.existsSync(file)) {res.writeHead(404);res.end();return;}
  const ext=path.extname(file);
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'}[ext])||'application/octet-stream');
  const data=fs.readFileSync(file);
  res.end(ext==='.html'?data.toString().replace('<head>','<head>'+mock):data);
}).listen(43127,'127.0.0.1',()=>console.log('TypeR preview on http://127.0.0.1:43127'));
