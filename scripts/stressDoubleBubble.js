// Offline developer audit. Deterministic synthetic labels; not a Photoshop validation.
const fs=require('fs'),vm=require('vm'),path=require('path'),os=require('os');
const ctx={};vm.createContext(ctx);vm.runInContext(fs.readFileSync(process.argv[2]||path.join(__dirname,'../app_src/doubleBubbleGeometry.js'),'utf8'),ctx);const g=ctx.TypeRDoubleBubble;
const result={geometry:process.argv[2]||'current geometry',platform:os.platform(),scope:'Synthetic known two-disk unions transformed affinely. Expected seams come from generator labels; these do not establish coverage of real manga bubbles.',double:{total:0,correctCount:0,correctBodyClicks:0,correctNearSeamClicks:0},single:{total:0,falseSplits:0},families:{},failures:[]};
const start=process.hrtime.bigint();
function affine(x,y,angle,sx,sy,shear){const u=x*sx+shear*y*sy,v=y*sy;return [800+u*Math.cos(angle)-v*Math.sin(angle),900+u*Math.sin(angle)+v*Math.cos(angle)];}
function outline(r1,r2,d,n){const x=(d*d+r1*r1-r2*r2)/(2*d),theta=Math.acos(x/r1),phi=Math.acos((x-d)/r2),p=[];for(let i=0;i<=n;i++){const a=theta+(2*Math.PI-2*theta)*i/n;p.push([r1*Math.cos(a),r1*Math.sin(a)]);}for(let i=1;i<n;i++){const a=-phi+2*phi*i/n;p.push([d+r2*Math.cos(a),r2*Math.sin(a)]);}return {poly:p,x};}
for(const ratio of [.4,.65,1,1.5,2.5])for(const overlap of [.05,.2,.35,.5,.6])for(const stretch of [.6,1,1.6,2.4])for(const variant of [0,1,2,3]){
 const r1=100,r2=r1*ratio,d=(r1+r2)*(1-overlap),join=(d*d+r1*r1-r2*r2)/(2*d);
 // Exclude shapes where an assumed body center is on the wrong side of the join.
 if(d<=Math.abs(r1-r2)||join<d*.08||join>d*.92)continue;
 const angle=[0,.57,1.57,2.31][variant],shear=variant===3?.3:0,n=variant===1?32:96,scale=variant===2?.6:1;
 const transform=p=>affine(p[0],p[1],angle,scale,stretch*scale,shear),source=outline(r1,r2,d,n);let poly=source.poly.map(transform);if(variant%2)poly.reverse();
 const regions=g.detect([poly]);function choose(x,y){const p=transform([x,y]);return g.choose(regions,{x:p[0],y:p[1]});}
 const left=choose(0,0),right=choose(d,0),bodies=regions.length===2&&left&&right&&left!==right;
 const offset=Math.min(r1,r2)*.04,seam=bodies&&choose(join-offset,0)===left&&choose(join+offset,0)===right;
 const family='overlap '+overlap;const f=result.families[family]||(result.families[family]={total:0,correctCount:0,correctBodyClicks:0,correctNearSeamClicks:0});
 for(const target of [result.double,f]){target.total++;if(regions.length===2)target.correctCount++;if(bodies)target.correctBodyClicks++;if(seam)target.correctNearSeamClicks++;}
 if(!seam)result.failures.push({kind:regions.length!==2?'count':!bodies?'body-click':'seam-click',ratio,overlap,stretch,variant,count:regions.length});
}
function single(name,p){const regions=g.detect([p]);result.single.total++;if(regions.length!==1||regions[0].split){result.single.falseSplits++;result.failures.push({kind:'false-split',name,count:regions.length});}}
for(const stretch of [.5,1,2,3])for(const angle of [0,.57,1.57])for(const n of [32,128])single('convex ellipse',Array.from({length:n},(_,i)=>affine(100*Math.cos(i*2*Math.PI/n),100*Math.sin(i*2*Math.PI/n),angle,1,stretch,0)));
for(const bumps of [4,5,6,8,12])for(const amplitude of [.08,.15,.25])for(const angle of [0,.57])single('cloud '+bumps+'/'+amplitude,Array.from({length:360},(_,i)=>{const a=i*Math.PI/180,r=100*(1+amplitude*Math.abs(Math.sin(bumps*a/2))-amplitude/2);return affine(r*Math.cos(a),r*Math.sin(a),angle,1,1,0);}));
for(const half of [.2,.4,.65])for(const length of [50,90,150,230])for(const stretch of [1,2]){
 const p=[];for(let i=0;i<=160;i++){const a=half+(2*Math.PI-2*half)*i/160;p.push([100*Math.cos(a),stretch*100*Math.sin(a)]);}p.push([100+length,0]);single('tail '+half+'/'+length+'/'+stretch,p);
}
result.elapsedMs=Number(process.hrtime.bigint()-start)/1e6;console.log(JSON.stringify(result,null,2));
