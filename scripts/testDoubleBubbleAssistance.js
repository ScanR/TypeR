const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const source=fs.readFileSync(process.env.GEOM||path.join(__dirname,'../app_src/doubleBubbleGeometry.js'),'utf8'),ctx={};vm.createContext(ctx);vm.runInContext(source,ctx);const g=ctx.TypeRDoubleBubble;
const ellipse=Array.from({length:96},(_,i)=>[100*Math.cos(i*Math.PI/48),200*Math.sin(i*Math.PI/48)]),first={x:-50,y:0},second={x:50,y:0};
assert.equal(g.detect([ellipse]).length,1,'automatic detector is unchanged for singles');
for(const offset of [-.2,0,.2])for(const angle of [-45,0,45]){
 const split=g.assistedSplit([ellipse],first,second,offset,angle);assert(split);assert.equal(split.regions.length,2);
 assert(g.contains(split.regions[0].polygons,first.x,first.y));assert(g.contains(split.regions[1].polygons,second.x,second.y));
 for(const p of ellipse.filter((_,i)=>i%8===0)){
  const x=p[0]*.8,y=p[1]*.8,a=g.contains(split.regions[0].polygons,x,y),b=g.contains(split.regions[1].polygons,x,y);
  assert(!(a&&b),'halves do not overlap away from the seam');
 }
}
for(const invalid of [[null,second,0,0],[first,first,0,0],[{x:300,y:300},second,0,0],[first,second,NaN,0],[first,second,0,Infinity]])assert.equal(g.assistedSplit([ellipse],...invalid),null,'reject invalid preview');
const hostSource=fs.readFileSync(path.join(__dirname,'../app_src/host.js'),'utf8');
function extract(name){const match=hostSource.match(new RegExp('function '+name+'\\([^]*?\\n\\}'));assert(match,name);return match[0];}
function harness(){
 const doc={id:7},state={enabled:true,seed:{x:-50,y:0,documentID:7}},counts={reads:0,selects:0};
 const c={documents:[doc],app:{activeDocument:doc},_hostState:{doubleBubble:state},TypeRDoubleBubble:g,jamJSON:JSON,history:1,counts,success:true,
 _getCurrentSelectionBounds:()=>({left:-100,top:-200,right:100,bottom:200}),
 getTypeRDoubleBubbleProbe:()=>{counts.reads++;return JSON.stringify({error:'noContour'});}};
 vm.createContext(c);vm.runInContext("function _typeRRegionKey(b,seed){return app.activeDocument.id+':'+history+':'+seed.x+','+seed.y;}function selectTypeRDoubleBubbleLobe(options){counts.selects++;if(!success)return JSON.stringify({changed:false,error:'busy'});if(options.expectedKey!==_hostState.doubleBubble.cache.key)throw Error('bad key');_hostState.doubleBubble.appliedKey=options.expectedKey+':applied';_hostState.doubleBubble.assistSource.key=_hostState.doubleBubble.appliedKey;return JSON.stringify({changed:true,documentID:7});}",c);
 for(const name of ['getTypeRAssistedBubbleProbe','setTypeRAssistedBubbleLobe'])vm.runInContext(extract(name),c);
 const key=c._typeRRegionKey({},state.seed);state.assistSource={key,documentID:7,polygons:[ellipse],points:[],offset:0,angle:0};
 return {c,state,counts,key,apply(overrides={}){return JSON.parse(c.setTypeRAssistedBubbleLobe(Object.assign({key,documentID:7,first,second,offset:0,angle:0,index:1},overrides)));}};
}
{
 const h=harness(),before=JSON.stringify(h.state);
 const preview=JSON.parse(h.c.getTypeRAssistedBubbleProbe({}));assert.equal(preview.polygons[0].length,ellipse.length);assert.equal(JSON.stringify(h.state),before,'opening/canceling preview does not change caches');assert.equal(h.counts.reads,0,'raw contour survives automatic lobe selection');
 for(const invalid of [{key:'stale'},{documentID:8},{index:2},{first:{x:300,y:0}}])assert.equal(h.apply(invalid).changed,false);
 assert.equal(h.counts.selects,0,'invalid and stale requests never change Photoshop selection');assert.equal(JSON.stringify(h.state),before);
 const result=h.apply();assert(result.changed);assert.equal(h.state.seed.x,50);assert.equal(h.state.probeCache.polygons[0].length,ellipse.length,'keep raw ink/subtraction source');assert.equal(h.state.cache.value.selected.center.x,50);assert.equal(h.state.assistSource.key,result.key);assert.equal(h.state.assistSource.points.length,2);
}
{
 const h=harness(),before=JSON.stringify(h.state);h.c.success=false;assert.equal(h.apply().changed,false);assert.equal(JSON.stringify(h.state),before,'failed native operation restores prepared state');
 h.c.history++;assert.equal(h.apply().changed,false);assert.equal(h.counts.selects,1,'new history rejects stale preview');
 h.state.enabled=false;assert.equal(h.apply().changed,false);
}
{
 const h=harness(),result=h.apply({whole:true,index:0,first:null,second:null});assert(result.changed);assert.equal(h.state.cache.value.regions.length,1,'explicit single-bubble correction is accepted');assert.equal(h.state.assistSource.points.length,0);
}
{
 const h=harness(),c=h.c,doc=c.app.activeDocument;let nativeBounds={left:-100,top:-200,right:100,bottom:200},removed=0,paths=[];
 c._getCurrentSelectionBounds=()=>nativeBounds;c.app.preferences={rulerUnits:'original'};c.Units={PIXELS:'pixels'};doc.resolution=600;
 c.PointKind={CORNERPOINT:'corner'};c.ShapeOperation={SHAPEADD:'add',SHAPESUBTRACT:'subtract'};c.SelectionType={REPLACE:'replace'};c.SubPathInfo=function(){};c.PathPointInfo=function(){};
 c._withSuspendedHistory=(name,fn)=>fn();
 doc.pathItems={add(name,subs){paths.push(subs);return {makeSelection(){
  const pixels=subs.filter(s=>s.operation==='add').map(s=>s.entireSubPath.map(p=>p.anchor.map(x=>x*doc.resolution/72)));
  nativeBounds=g.bounds(pixels);c.history++;
 },remove(){removed++;}};}};
 vm.runInContext(extract('selectTypeRDoubleBubbleLobe'),c);
 const hole=Array.from({length:16},(_,i)=>[-20+3*Math.cos(i*Math.PI/8),3*Math.sin(i*Math.PI/8)]);h.state.assistSource.polygons.push(hole);
 let result=h.apply();assert(result.changed);assert.equal(removed,1);assert.equal(c.app.preferences.rulerUnits,'original');assert(paths[0].some(p=>p.operation==='subtract'),'native path preserves ink subtraction');
 const selected=h.state.cache.value.selected;assert.equal(paths[0][0].entireSubPath[0].anchor[0],selected.polygons[0][0][0]*72/doc.resolution,'600 ppi coordinate conversion');
 const reopened=JSON.parse(c.getTypeRAssistedBubbleProbe({}));assert.equal(reopened.polygons[0].length,ellipse.length,'reopening after native selection retains full contour');assert.equal(reopened.key,result.key);
 result=h.apply({key:reopened.key,index:0});assert(result.changed);assert.equal(h.state.cache.value.selected.center.x,-50,'other half can be selected from the same source');assert.equal(removed,2);
}
console.log('Assisted split: explicit intent only, move/rotate preview, invalid seeds, no overlap, raw source retained, stale document/history rejection and native failure rollback PASS');
