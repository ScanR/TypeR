const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const context={};vm.createContext(context);vm.runInContext(fs.readFileSync(process.env.GEOM||path.join(__dirname,'../app_src/doubleBubbleGeometry.js'),'utf8'),context);const g=context.TypeRDoubleBubble;
// Exact two-circle outline, then stretched to represent tall, broad-joined ovals.
function outline(distance,stretch){
 const r=100,n=128,theta=Math.acos(distance/(2*r)),p=[];
 for(let i=0;i<=n;i++){const a=theta+(2*Math.PI-2*theta)*i/n;p.push([r*Math.cos(a),stretch*r*Math.sin(a)]);}
 for(let i=1;i<n;i++){const a=-Math.PI+theta+(2*Math.PI-2*theta)*i/n;p.push([distance+r*Math.cos(a),stretch*r*Math.sin(a)]);}
 return p;
}
let checked=0;
for(const distance of [80,90,100,110,120,130])for(const stretch of [1,1.5,2]){
 for(const [angle,scale,reverse] of [[0,1,false],[.43,.5,true],[Math.PI/2,3,false],[2.33,1,true]]){
  const transform=([x,y])=>[500+scale*(x*Math.cos(angle)-y*Math.sin(angle)),700+scale*(x*Math.sin(angle)+y*Math.cos(angle))];
  let poly=outline(distance,stretch).map(transform);if(reverse)poly.reverse();
  const label=`wide d=${distance}, stretch=${stretch}, rotation=${angle}, scale=${scale}`;
  const regions=g.detect([poly]);assert.equal(regions.length,2,label);
  function choose(x,y){const p=transform([x,y]);return g.choose(regions,{x:p[0],y:p[1]});}
  const left=choose(0,0),right=choose(distance,0);assert.notStrictEqual(left,right,label+' click on each body');
  assert.strictEqual(choose(distance/2-3,0),left,label+' left of junction');
  assert.strictEqual(choose(distance/2+3,0),right,label+' right of junction');
  assert.strictEqual(choose(distance,0),right,label+' repeated click');
  assert.strictEqual(g.choose(regions,null),null,label+' requires click');
  const json=JSON.stringify(regions);assert.equal(JSON.stringify(g.detect([poly])),json,label+' deterministic');
  const hole=Array.from({length:16},(_,i)=>transform([distance+3*Math.cos(i*Math.PI/8),3*Math.sin(i*Math.PI/8)]));
  assert.equal(JSON.stringify(g.detect([poly,hole])),json,label+' ignores interior ink');
  for(const x of [-25,distance+25])for(const y of [-stretch*40,stretch*40]){
   const p=transform([x,y]),selected=choose(x,y),other=selected===left?right:left;
   assert(g.contains(selected.polygons,p[0],p[1]),label+' body preserved');
   assert(!g.contains(other.polygons,p[0],p[1]),label+' bodies do not overlap');
  }
  checked++;
 }
}
const video=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/doubleBubbleVideoWide.json'),'utf8'));
for(const reverse of [false,true]){
 const poly=video.polygons[0].slice();if(reverse)poly.reverse();
 const regions=g.detect([poly]);assert.equal(regions.length,2,'estimated video contour');
 assert.notStrictEqual(g.choose(regions,video.seeds[0]),g.choose(regions,video.seeds[1]),'video click on each half');
}
// A wide triangular tail is still a tail even when its two bases oppose one another.
for(const tail of [90,150]){
 const p=[],r=100,half=.65;
 for(let i=0;i<=160;i++){const a=half+(2*Math.PI-2*half)*i/160;p.push([r*Math.cos(a),r*Math.sin(a)]);}
 p.push([r+tail,0]);
 assert.equal(g.detect([p]).length,1,'wide triangular tail '+tail);
}
// Shallow pinches in an otherwise single oval are insufficient evidence.
for(const stretch of [1,2]){
 const p=Array.from({length:256},(_,i)=>{const a=i*Math.PI/128,r=100*(1-.025*Math.pow(Math.sin(a),16));return [r*Math.cos(a),stretch*r*Math.sin(a)];});
 assert.equal(g.detect([p]).length,1,'shallow oval dents '+stretch);
}
// Cyclic start and winding must not hide repeated inward cloud arcs.
for(const bumps of [4,5,6,8])for(const start of [0,17,89])for(const reverse of [false,true]){
 let p=Array.from({length:360},(_,i)=>{const a=i*Math.PI/180,r=200*(1+.08*Math.abs(Math.sin(bumps*a/2))-.04);return [r*Math.cos(a),r*Math.sin(a)];});
 p=p.slice(start).concat(p.slice(0,start));if(reverse)p.reverse();
 assert.equal(g.detect([p]).length,1,'cloud '+bumps+' start '+start+' reverse '+reverse);
}
console.log('Wide junctions: '+checked+' scale/rotation/winding cases, estimated video contour, ink, clicks and wide tails PASS');
