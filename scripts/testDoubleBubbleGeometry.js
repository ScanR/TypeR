const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm'),acorn=require('acorn');
const source=fs.readFileSync(path.join(__dirname,'../app_src/doubleBubbleGeometry.js'),'utf8');
const host=fs.readFileSync(path.join(__dirname,'../app_src/doubleBubbleGeometry.jsxinc'),'utf8');
assert.strictEqual(source,host,'CEP and ExtendScript use identical geometry');
acorn.parse(host,{ecmaVersion:3});
const context={};vm.createContext(context);vm.runInContext(source,context);const g=context.TypeRDoubleBubble;
const fixtures=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/doubleBubbleContours.json'),'utf8'));
for(const fixture of fixtures){
 const regions=g.detect(fixture.polygons),selected=g.choose(regions,fixture.seed);
 assert.equal(regions.length,fixture.count,fixture.name+' lobe count');
 assert(selected,fixture.name+' selected lobe');
 if(fixture.count>1){
  assert(Math.abs(selected.bounds.xMid-fixture.center.x)<(fixture.maxError||18),fixture.name+' horizontal placement');
  assert(Math.abs(selected.bounds.yMid-fixture.center.y)<(fixture.maxError||18),fixture.name+' vertical placement');
  assert.equal(g.choose(regions,null),null,'no guessing without a click');
 }
}
function circle(x,y,r){return Array.from({length:120},(_,i)=>[x+r*Math.cos(i*Math.PI/60),y+r*Math.sin(i*Math.PI/60)]);}
assert.equal(g.detect([circle(100,100,80)]).length,1,'single bubble remains single');
assert.equal(g.detect([circle(100,100,80).map(p=>[p[0]*3,p[1]])]).length,1,'oval remains single');
assert.equal(g.detect([[[0,0],[300,0],[300,100],[0,100]]]).length,1,'rectangular narration remains single');
const double=[circle(100,100,80),circle(300,100,80)],hole=circle(300,100,5);
assert.equal(g.detect(double.concat([hole])).length,2,'ink holes do not split a lobe');
console.log('Double bubble geometry: '+fixtures.length+' video/manga contours, tails, holes, simple shapes and ES3 parity PASS');
