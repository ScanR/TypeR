const assert=require('assert'),fs=require('fs'),vm=require('vm');
const geometrySource=fs.readFileSync(require('path').join(__dirname,'../app_src/doubleBubbleGeometry.js'),'utf8');
const bridgeSource=fs.readFileSync(require('path').join(__dirname,'../app_src/doubleBubbleBridge.js'),'utf8').replace(/^import[^\n]+\n/,'');
function harness(){
 let listener,now=1000,id=0,calls=[],timers={};
 function CSInterface(){}
 CSInterface.prototype.evalScript=function(script,cb){calls.push({script,cb});};
 CSInterface.prototype.getExtensionID=()=> 'typer.test';
 CSInterface.prototype.addEventListener=(type,cb)=>{listener=cb;};
 CSInterface.prototype.dispatchEvent=()=>{};
 function CSEvent(){}
 const window={CSInterface,CSEvent},context={window,JSON,Number,Math,Object,String,Date:{now:()=>now},setTimeout:(cb)=>{timers[++id]=cb;return id;},clearTimeout:(key)=>{delete timers[key];}};
 vm.createContext(context);vm.runInContext(geometrySource,context);vm.runInContext(bridgeSource,context);
 window.TypeRDoubleBubbleBridge.autoSelect=false;
 // The panel switches the mode on at startup when the user enabled it; the bridge boots off.
 assert.equal(window.TypeRDoubleBubbleBridge.enabled,false,'the bridge boots with the mode off');
 window.TypeRDoubleBubbleBridge.setEnabled(true);
 assert.equal(calls.length,1);assert.equal(calls[0].script,'setTypeRDoubleBubbleMode(true)','enabling the mode tells the host once');calls.length=0;
 return {cs:new CSInterface(),api:window.TypeRDoubleBubbleBridge,calls,
  emit(data){listener({data:typeof data==='string'?data:'ver1,'+JSON.stringify({eventID:1936028772,eventData:data})});},
  click(x,y,documentID=7){this.emit({documentID,null:{_ref:'channel',_property:'selection'},to:{_obj:'paint',horizontal:{_unit:'pixelsUnit',_value:x},vertical:{_unit:'pixelsUnit',_value:y}}});},
  advance(ms){now+=ms;},timeout(){const key=Object.keys(timers)[0];const cb=timers[key];delete timers[key];cb();}
 };
}
function circle(x,y,r){return Array.from({length:120},(_,i)=>[x+r*Math.cos(i*Math.PI/60),y+r*Math.sin(i*Math.PI/60)]);}
function probe(x=100,y=100,key='k1',syntheticPoints=[]){return JSON.stringify({key,documentID:7,seed:{x,y},polygons:[circle(100,100,80),circle(300,100,80)],syntheticPoints,repaired:false});}
{
 const h=harness();h.cs.evalScript('getHotkeyPressed()',()=>{});h.click(100,100);
 h.cs.evalScript('createTextLayerInSelection({},false)',()=>{});
 assert.equal(h.calls.length,2);assert(h.calls[1].script.startsWith('getTypeRDoubleBubbleProbe('),'keyboard polling must not lose the click');
 h.calls[1].cb(probe());assert(h.calls[2].script.includes('setTypeRDetectedLobe('));h.calls[2].cb('');
 h.cs.evalScript('getTypeRPanelSnapshot({})',()=>{});assert.equal(h.calls[3].script,'getTypeRPanelSnapshot({})','idle panel polls do not scan');
 h.cs.evalScript('getCurrentSelection()',()=>{});assert.equal(h.calls[4].script,'getCurrentSelection()');
}
{
 const h=harness();let called=0;h.click(100,100);h.cs.evalScript('createTextLayerInSelection({},false)',()=>{called++;});
 h.click(300,100);h.calls[0].cb(probe());
 assert.equal(h.calls.length,2);assert(h.calls[1].script.includes('"x":300'),'a real click during a probe must trigger a fresh probe');
 h.calls[1].cb(probe(300,100,'k2'));assert(h.calls[2].script.includes('"x":300'));h.calls[2].cb('');h.calls[2].cb('');assert.equal(called,1);
}
{
 const h=harness();h.click(100,100);h.cs.evalScript('createTextLayerInSelection({},false)',()=>{});
 h.click(42,22,99);h.calls[0].cb(probe(100,100,'k1',[{x:42,y:22,documentID:99}]));
 assert.equal(h.calls.length,2,'repair wand actions must not become user clicks');assert.equal(h.api.lastSeed.x,100);h.calls[1].cb('');
 h.emit({null:{_ref:'channel',_property:'selection'},to:{_ref:'channel',_name:'TypeR scan backup'}});assert.equal(h.api.lastSeed.x,100,'delayed channel restores must not erase the seed');
 h.emit({null:{_ref:'channel',_property:'selection'},to:{_obj:'rectangle'}});assert.equal(h.api.lastSeed,null);
 h.emit('bad JSON');h.emit({null:{_ref:'layer'},to:{_obj:'paint',horizontal:1,vertical:2}});assert.equal(h.api.lastSeed,null);
}
{
 const h=harness();const results=[];h.click(100,100);h.cs.evalScript('createTextLayerInSelection({},false)',x=>results.push(x));
 h.timeout();assert.deepEqual(results,['noSelection']);h.calls[0].cb(probe());assert.equal(h.calls.length,1,'a late timeout callback cannot paste');
 h.advance(121000);h.cs.evalScript('createTextLayerInSelection({},false)',()=>{});assert(h.calls[1].script.includes('setTypeRSelectionSeed(null);'));h.calls[1].cb('');
}
{
 const h=harness();h.click(100,100);h.cs.evalScript('getCurrentSelectionShape({samples:21})',()=>{});
 h.cs.evalScript('createTextLayerInSelection({},false)',()=>{});assert.equal(h.calls.length,1,'selection actions are serialized');
 h.calls[0].cb(probe());h.calls[1].cb('');assert(h.calls[2].script.includes('"cachedKey":"k1"'));
 h.calls[2].cb(JSON.stringify({key:'k1',same:true}));assert(h.calls[3].script.includes('setTypeRDetectedLobe('));h.calls[3].cb('');
}
console.log('Double bubble bridge: real clicks during polling/probes, synthetic events, cache, queue, TTL and timeout PASS');
{
 const h=harness();h.cs.evalScript('getActiveLayerBubbleShape({samples:21,tolerance:20})',()=>{});
 assert(h.calls[0].script.startsWith('getTypeRActiveBubbleProbe('),'TextShapeR gets an automatic probe without a recent wand seed');
 const data=JSON.parse(probe());data.auto=true;data.key='active:k1';h.calls[0].cb(JSON.stringify(data));
 assert(h.calls[1].script.includes('setTypeRDetectedLobe('));assert(h.calls[1].script.includes('"auto":true'));h.calls[1].cb('');
}
{
 const h=harness();h.click(100,100);h.api.setEnabled(false);
 assert.equal(h.calls[0].script,'setTypeRDoubleBubbleMode(false)','disabling the mode clears the host state at once');
 h.cs.evalScript('createTextLayerInSelection({},false)',()=>{});
 assert.equal(h.calls[1].script,'createTextLayerInSelection({},false)','disabled mode passes Paste straight through: no prefix, no probe');h.calls[1].cb('');
 h.cs.evalScript('getActiveLayerBubbleShape({})',()=>{});assert.equal(h.calls[2].script,'getActiveLayerBubbleShape({})');h.calls[2].cb('');
 h.api.setEnabled(true);assert.equal(h.calls[3].script,'setTypeRDoubleBubbleMode(true)');
 h.click(300,100);h.cs.evalScript('createTextLayerInSelection({},false)',()=>{});
 assert(h.calls[4].script.startsWith('getTypeRDoubleBubbleProbe('));h.calls[4].cb(probe(300,100));
 assert(h.calls[5].script.startsWith('setTypeRDoubleBubbleMode(true);'));h.calls[5].cb('');
}
{
 const h=harness();let result=null;h.click(100,100);h.cs.evalScript('createTextLayerInSelection({},false)',r=>result=r);
 h.api.setEnabled(false);assert.equal(h.calls[1].script,'setTypeRDoubleBubbleMode(false)');h.calls[0].cb(probe());
 assert(h.calls[2].script.startsWith('setTypeRDoubleBubbleMode(false);setTypeRSelectionSeed(null);'),'a paste caught mid-scan still runs, without the lobe');
 assert(!h.calls[2].script.includes('setTypeRDetectedLobe('),'turning the mode off during a scan discards the lobe');h.calls[2].cb('');assert.equal(result,'');
}
console.log('Double bubble toggle: disabled mode, re-enable and in-flight change PASS');
{
 const h=harness();h.click(100,100);h.cs.evalScript('getSelectionChanged()',()=>{});h.calls[0].cb(probe());
 h.click(300,100);h.calls[1].cb('');assert.equal(h.api.lastSeed.x,300,'a real click before the owned CEP callback must survive');
 h.cs.evalScript('createTextLayerInSelection({},false)',()=>{});assert(h.calls[2].script.includes('"x":300'));h.calls[2].cb(probe(300,100));h.calls[3].cb('');
}
{
 const h=harness();h.cs.evalScript('getActiveLayerBubbleShape({})',()=>{});
 const data=JSON.parse(probe());data.auto=true;data.syntheticPoints=[{x:42,y:22,documentID:99}];h.calls[0].cb(JSON.stringify(data));
 h.click(42,22,99);h.calls[1].cb('');assert.equal(h.api.lastSeed,null,'owned synthetic wand clicks are filtered');
}
console.log('Double bubble bridge: clicks arriving before public-operation callbacks PASS');
{
 const h=harness();h.api.autoSelect=true;h.click(100,100);h.timeout();
 assert(h.calls[0].script.startsWith('getTypeRDoubleBubbleProbe('));h.calls[0].cb(probe());
 assert(h.calls[1].script.includes('selectTypeRDoubleBubbleLobe({"expectedKey":"k1"})'),'a wand click applies its lobe without Insert');h.calls[1].cb('{"changed":true}');
 assert.equal(h.api.lastApplied.changed,true);
}

{
 const h=harness();h.click(100,100);h.cs.evalScript('createTextLayerInSelection({},false)',()=>{});
 for(let i=0;i<12;i++)h.cs.evalScript('getSelectionChanged()',()=>{});
 h.calls[0].cb(probe());h.calls[1].cb('');h.calls[2].cb(probe());h.calls[3].cb('');
 assert.equal(h.calls.length,4,'poll storm is coalesced without duplicate Paste');
}
{
 const h=harness();h.click(100,100);h.cs.evalScript('createTextLayerInSelection({},false)',()=>{});
 const data=JSON.parse(probe());data.polygons.push(circle(500,100,80));h.calls[0].cb(JSON.stringify(data));
 assert(!h.calls[1].script.includes('forceRepair'),'three genuine bubbles require no forced repair');
 h.cs.evalScript('getSelectionChanged()',()=>{});h.timeout();
 assert.equal(h.api.lastError,'callTimeout');assert.equal(h.calls.length,3,'lost public callback releases queue');
 h.calls[1].cb('');assert.equal(h.calls.length,3,'late callback is ignored');
}
{
 const h=harness();h.api.autoSelect=true;h.click(100,100);h.timeout();h.click(300,100);
 h.calls[0].cb(probe());h.calls[1].cb(probe(300,100,'k2'));h.calls[2].cb('{"changed":true}');
 assert.equal(h.calls.length,3,'latest click is applied once when it arrives during the first probe');
}
console.log('Claude review regression: poll coalescing, triple bubble, public timeout and rapid click PASS');

{
 const h=harness();h.click(375,650);h.cs.evalScript('selectTypeRDoubleBubbleLobe()',()=>{});
 const data=JSON.parse(fs.readFileSync(require('path').join(__dirname,'fixtures/kikuriComplexLeak.json'),'utf8'));data.documentID=7;
 h.calls[0].cb(JSON.stringify(data));assert(h.calls[1].script.includes('"forceRepair":true'),'Kikuri leak into the artwork requests one targeted repair');
}

{
 const h=harness();let result=null;
 h.cs.evalScript('getSelectionChanged()',r=>result=r);
 assert.equal(h.calls.length,0,'a poll without a seed waits briefly for the wand event');
 h.click(300,100);h.timeout();
 assert(h.calls[0].script.startsWith('getTypeRDoubleBubbleProbe('));
 h.calls[0].cb(probe(300,100));
 assert(h.calls[1].script.includes('setTypeRDetectedLobe('),'late wand event is prepared before Multi-bubble captures');
 h.calls[1].cb('two');assert.equal(result,'two');
}
{
 const h=harness();h.cs.evalScript('getSelectionChanged()',()=>{});h.timeout();
 assert(h.calls[0].script.includes('setTypeRSelectionSeed(null);'),'manual selections still pass after the grace period');h.calls[0].cb('');
 h.api.setEnabled(false);h.cs.evalScript('getSelectionChanged()',()=>{});
 assert.equal(h.calls.length,3,'disabled mode has no grace-period delay');assert.equal(h.calls[2].script,'getSelectionChanged()','and no prefix either');h.calls[2].cb('');
}
console.log('Delayed CEP wand notification: poll waits for seed, manual fallback and disabled mode PASS');

{
 const h=harness(),results=[];h.click(100,100);
 h.cs.evalScript('createTextLayerInSelection({},false)',()=>{});
 for(let i=0;i<12;i++)h.cs.evalScript('getSelectionChanged()',r=>results.push(r));
 h.calls[0].cb(probe());h.calls[1].cb('');h.calls[2].cb(probe());
 const capture=JSON.stringify({multiSelection:[{left:20,top:20,right:180,bottom:180}]});
 h.calls[3].cb(capture);
 assert.equal(results.length,12,'every waiting poll resolves');
 assert.equal(results.filter(r=>r===capture).length,1,'a capture is consumed once across merged polls');
 assert.equal(results.filter(r=>r==='').length,11,'other polls receive the normal no-change result');
}
console.log('Coalesced selection polls: one capture delivery and all callbacks resolved PASS');

{
 const data=JSON.parse(fs.readFileSync(require('path').join(__dirname,'fixtures/kikuriAngularRepair.json'),'utf8'));
 data.documentID=7;data.seed.documentID=7;data.geometrySeed.documentID=7;
 const h=harness();h.click(375,650);h.cs.evalScript('selectTypeRDoubleBubbleLobe()',()=>{});
 h.calls[0].cb(JSON.stringify(data));
 const prepared=JSON.parse(h.calls[1].script.match(/setTypeRDetectedLobe\((.*?)\);/)[1]);
 assert(prepared.selected,'the repaired interior point survives the containment check');
 assert(Math.abs(prepared.selected.bounds.xMid-321)<20,'the right angular lobe is selected');
 assert.equal(h.api.lastSeed.x,375,'repair does not replace the actual user click');
 h.calls[1].cb('{}');
}
console.log('Repaired angular manga contour: recovered interior point chooses the clicked half PASS');

{
 const h=harness();h.click(100,100,undefined);delete h.api.lastSeed.documentID;
 h.cs.evalScript('getSelectionChanged()',()=>{});h.calls[0].cb(probe());
 assert.equal(h.api.lastSeed.documentID,7,'native points acquire the document verified by the probe');
 h.calls[1].cb('{}');
 h.cs.evalScript('getSelectionChanged()',()=>{});
 h.calls[2].cb(JSON.stringify({error:'noSeedOrSelection',documentID:8}));
 assert.equal(h.api.lastSeed,null,'changing page clears the previous page point before capture');
 assert.equal(h.calls.length,3,'the stale point cannot consume a joined selection');
 h.click(300,100,8);h.timeout();
 const data=JSON.parse(probe(300,100,'page8'));data.documentID=8;
 h.calls[3].cb(JSON.stringify(data));
 assert(h.calls[4].script.includes('"documentID":8'),'the new page uses its own click');
 h.calls[4].cb('{}');
}
console.log('Page change: bind native point, clear stale page seed, wait for fresh click PASS');

{
 const h=harness();h.api.autoSelect=true;h.click(100,100);h.api.setAssisting(true);
 h.api.requestAssistance(()=>{});
 assert.equal(h.calls.length,1);assert(h.calls[0].script.includes('getTypeRAssistedBubbleProbe('));assert(!h.calls[0].script.includes('getTypeRDoubleBubbleProbe('),'assisted requests use the serialized direct path');
 h.click(42,22,99);h.calls[0].cb(JSON.stringify({polygons:[circle(100,100,80)],syntheticPoints:[{x:42,y:22,documentID:99}]}));
 assert.equal(h.api.lastSeed.x,100,'assisted scan filters synthetic points');h.api.setAssisting(false);
}
{
 const h=harness(),poly=Array.from({length:96},(_,i)=>[100*Math.cos(i*Math.PI/48),200*Math.sin(i*Math.PI/48)]);
 h.click(-50,0);h.api.setAssisting(true);
 const data={key:'preview',documentID:7,first:{x:-50,y:0},second:{x:50,y:0},offset:0,angle:0,index:0};
 h.api.applyAssistance(data,()=>{},[poly]);assert(h.calls[0].script.includes('setTypeRAssistedBubbleLobe('));h.calls[0].cb(JSON.stringify({changed:true,seed:{x:-50,y:0,documentID:7}}));
 assert(h.api.lastManual);h.api.setAssisting(false);h.click(50,0);h.cs.evalScript('getCurrentSelectionShape({samples:21})',()=>{});
 const p=poly.slice(17).concat(poly.slice(0,17)).reverse();h.calls[1].cb(JSON.stringify({key:'next',documentID:7,seed:{x:50,y:0},polygons:[p,circle(20,20,3)]}));
 assert.equal(h.api.lastDetection.count,2,'the approved split is reused for the other half, ignoring ink and contour traversal');h.calls[2].cb('');
 h.click(50,0,7);h.cs.evalScript('getCurrentSelectionShape({samples:21})',()=>{});
 const changed=poly.map((p,i)=>i===12?[p[0]-3,p[1]]:p);
 h.calls[3].cb(JSON.stringify({key:'other-shape',documentID:7,seed:{x:50,y:0},polygons:[changed]}));assert.equal(h.api.lastDetection.count,1,'same bounds with a different outline has no manual override');h.calls[4].cb('');
 h.click(50,0,8);h.cs.evalScript('getCurrentSelectionShape({samples:21})',()=>{});h.calls[5].cb(JSON.stringify({key:'other-doc',documentID:8,seed:{x:50,y:0},polygons:[poly]}));assert.equal(h.api.lastDetection.count,1,'same shape in another document has no manual override');h.calls[6].cb('');
 h.api.setEnabled(false);assert.equal(h.api.lastManual,null,'mode toggle clears manual override');
}
{
 const h=harness();h.click(100,100);h.api.applyAssistance({key:'p',documentID:7},()=>{},[circle(100,100,80)]);h.click(300,100);
 h.calls[0].cb(JSON.stringify({changed:true,seed:{x:100,y:100,documentID:7}}));assert.equal(h.api.lastSeed.x,300,'a real click during apply wins over the old manual point');assert(!h.api.lastManual);
}
console.log('Assistance bridge: pause automatic selection, serialization, synthetic events, correction reuse, contour identity, document isolation and newer click ownership PASS');

{
 const h=harness(),polygons=[circle(100,100,80),circle(300,100,80)];h.click(100,100);
 h.api.applyAssistance({key:'p',documentID:7,whole:true,index:0},()=>{},polygons);h.calls[0].cb(JSON.stringify({changed:true,seed:{x:100,y:100,documentID:7}}));
 h.click(300,100);h.cs.evalScript('getCurrentSelectionShape({})',()=>{});h.calls[1].cb(JSON.stringify({key:'next',documentID:7,seed:{x:300,y:100},polygons}));assert.equal(h.api.lastDetection.count,1,'explicit one-bubble correction is reused');h.calls[2].cb('');
}
console.log('Single-bubble assistance: explicit correction overrides automatic split on the same contour PASS');
