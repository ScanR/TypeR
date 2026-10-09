const assert=require('assert'),fs=require('fs'),vm=require('vm'),path=require('path');
const source=fs.readFileSync(path.join(__dirname,'../app_src/host.js'),'utf8');
function extract(name){const match=source.match(new RegExp('function '+name+'\\([^]*?\\n\\}'));assert(match,name);return match[0];}
function host(){
 const counts={scan:0,repair:0},doc={id:7,width:{as:()=>1000},height:{as:()=>1000}},state={enabled:true,seed:null,cache:null};
 const context={documents:[doc],app:{activeDocument:doc},_hostState:{doubleBubble:state},jamJSON:JSON,JSON,isFinite,Number,String,
  history:1,counts,busy:false,selected:true,
  _getCurrentSelectionBounds:()=>context.selected?({left:0,top:0,right:1000,bottom:1000,width:1000,height:1000}):null,
  _typeRRepairOpenBubble:()=>{counts.repair++;return null;},_typeRReadSelectionPolygons:()=>null,
  _typeRPolygonsLookLeaked:()=>false,_layerIsTextLayer:()=>true,
  _getCurrentTextLayerBounds:()=>({left:500,yMid:500}),_createMagicWandSelection:()=>{context.selected=true;},_getActiveLayerId:()=>42};
 vm.createContext(context);
 vm.runInContext("function _typeRRegionKey(b,seed){return app.activeDocument.id+':'+history+':'+(seed?seed.x+','+seed.y:'');}function _withTemporaryHistory(n,callback){counts.scan++;var saved=selected;try{return busy?{error:'historyBusy'}:callback();}finally{selected=saved;}}",context);
 for(const name of ['setTypeRSelectionSeed','getTypeRDoubleBubbleProbe','_typeRActiveBubbleKey','getTypeRActiveBubbleProbe'])vm.runInContext(extract(name),context);
 return {context,state,doc,counts,probe(options={}){return JSON.parse(context.getTypeRDoubleBubbleProbe(Object.assign({x:500,y:500,documentID:doc.id},options)));},auto(options={}){context.selected=false;return JSON.parse(context.getTypeRActiveBubbleProbe(options));}};
}
{
 const h=host();assert.equal(h.probe().error,'noSelection');
 for(let i=0;i<20;i++)assert.equal(h.probe().error,'noSelection');
 assert.equal(h.counts.repair,1,'idle polls must not duplicate/filter a failed bubble repeatedly');
 h.context.history++;h.probe();assert.equal(h.counts.repair,2,'an edit/Undo/Redo invalidates the negative cache');
 h.probe({x:501});assert.equal(h.counts.repair,3,'a new wand point gets a fresh attempt');
 h.probe({x:501,forceRepair:true});assert.equal(h.counts.repair,4,'explicit retry bypasses a failure');
 h.doc.id=8;h.probe({x:501});assert.equal(h.counts.repair,5,'a different document gets a fresh scan');
}
{
 const h=host();assert.equal(h.auto().error,'noBubble');
 for(let i=0;i<20;i++)assert.equal(h.auto().error,'noBubble');
 assert.equal(h.counts.repair,1,'TextShapeR polling does not repeatedly repair a failed outline');
 h.context.history++;h.auto();assert.equal(h.counts.repair,2);
 h.auto({forceRepair:true});assert.equal(h.counts.repair,3);
}
{
 const h=host();h.context.busy=true;h.probe();h.probe();assert.equal(h.counts.scan,2,'historyBusy remains retryable');
 h.auto();h.auto();assert.equal(h.counts.scan,4,'busy TextShapeR probes remain retryable');
}
{
 const h=host();h.context.setTypeRSelectionSeed({x:500,y:500,documentID:7});
 const key=h.context._typeRRegionKey({},h.state.seed),region={bounds:{xMid:500,yMid:500},polygons:[[[0,0],[1,0],[1,1]]]};
 h.state.cache={key,value:{regions:[region],selected:region,repaired:false}};h.state.appliedKey=key;
 assert.equal(h.probe({cachedKey:key}).same,true,'unchanged applied geometry stays in CEP without another large payload');
 assert(h.probe().selected,'a client without the geometry still receives it');assert.equal(h.counts.scan,0);
}
console.log('Double bubble probe cache: one failed scan for idle polls, edit/document/click/forced invalidation, busy retry and small cached payload PASS');

{
 const h=host(),c=h.context;
 c._hostState.selectionMonitor={};c.ScriptUI={environment:{keyboardState:{shiftKey:false}}};
 c._getSelectionChanged=()=>JSON.stringify({original:true});
 c._selectionBoundsKey=b=>[b.xMid,b.yMid,b.width,b.height].join('_');
 vm.runInContext(extract('_typeRLobeBoundsKey'),c);
 vm.runInContext(source.slice(source.indexOf('var _typeRSelectionChangedOriginal=')),c);
 c.setTypeRSelectionSeed({x:282,y:1220,documentID:7});
 const capture=()=>JSON.parse(c._getSelectionChanged());
 assert(capture().noChange,'unprepared geometry waits without a slow host rescan');
 assert.equal(h.counts.scan,0);
 const key=c._typeRRegionKey({},h.state.seed);
 const bounds={left:241,top:1161.61629256643,right:326.019664413639,bottom:1341.24828115856,width:85.019664413639,height:179.631988592135,xMid:283.50983220682,yMid:1251.4322868625};
 h.state.cache={key,value:{selected:{bounds,split:true}}};
 assert.equal(capture().multiSelection.length,1);
 Object.assign(bounds,{right:326.0196644136387,bottom:1341.24828115857,xMid:283.509832206819,width:85.0196644136387,height:179.631988592132});
 assert(capture().noChange,'floating point drift does not create a third capture');
 Object.assign(bounds,{left:87,top:1310,right:308,bottom:1494,xMid:197.5,yMid:1402,width:221,height:184});
 assert.equal(capture().multiSelection.length,1,'the other half is captured independently');
 const selected=h.state.cache.value.selected;h.state.cache.value.selected=null;
 assert(capture().noChange,'a stale point outside the current outline cannot capture the joined bubble');
 h.state.cache.value.selected=selected;
 c.history++;assert(capture().noChange,'history change waits for freshly prepared geometry');
 assert.equal(h.counts.scan,0);
 h.doc.id=8;h.state.cache.key=c._typeRRegionKey({},h.state.seed);
 assert.equal(capture().multiSelection.length,1,'matching bounds in another document are a new capture');
 h.state.enabled=false;assert(capture().original,'mode off preserves the original monitor');
}
console.log('Lobe capture monitor: precision drift, other half, unprepared geometry and document changes PASS');

{
 const h=host();
 h.context._typeRRepairOpenBubble=()=>{h.state.repairSeed={x:520,y:500,documentID:7};return [[[450,450],[600,450],[600,600],[450,600]]];};
 const repaired=h.probe({forceRepair:true});
 assert.equal(repaired.seed.x,500,'the user point stays in the cache key');
 assert.equal(repaired.geometrySeed.x,520,'the recovered interior point is sent to CEP');
 h.context.history++;h.context._getCurrentSelectionBounds=()=>({left:100,top:100,right:900,bottom:900,width:800,height:800});h.context._typeRReadSelectionPolygons=()=>[[[400,400],[600,400],[600,600],[400,600]]];
 const clean=h.probe();assert.equal(clean.geometrySeed.x,500,'an unrepaired scan does not reuse a stale repair point');
}
console.log('Repair probe: original click retained, recovered point exported and stale repair ignored PASS');
