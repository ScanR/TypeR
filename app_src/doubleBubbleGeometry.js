/* TypeR double-bubble geometry. ES3-compatible; no Photoshop dependencies. */
var TypeRDoubleBubble = (function () {
    function bounds(polygons) {
        var b={left:Infinity,top:Infinity,right:-Infinity,bottom:-Infinity},i,j,p;
        for(i=0;i<polygons.length;i++) for(j=0;j<polygons[i].length;j++) {
            p=polygons[i][j]; b.left=Math.min(b.left,p[0]);b.right=Math.max(b.right,p[0]);
            b.top=Math.min(b.top,p[1]);b.bottom=Math.max(b.bottom,p[1]);
        }
        b.width=b.right-b.left;b.height=b.bottom-b.top;
        b.xMid=(b.left+b.right)/2;b.yMid=(b.top+b.bottom)/2;return b;
    }
    function contains(polygons,x,y) {
        var inside=false,i,j,k,a,b;
        for(i=0;i<polygons.length;i++) {k=polygons[i].length-1;
            for(j=0;j<polygons[i].length;j++) {a=polygons[i][j];b=polygons[i][k];
                if((a[1]>y)!=(b[1]>y) && x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
                k=j;
            }
        }return inside;
    }
    function outerContours(polygons) {
        // Ink islands (letters, dust, a captured pointer) do not define the
        // bubble's neck. Keep separate outer components, omit enclosed holes.
        var out=[],boxes=[],i,j,p,b,q,inside;
        for(i=0;i<polygons.length;i++)boxes.push(bounds([polygons[i]]));
        for(i=0;i<polygons.length;i++){
            p=polygons[i];if(p.length<3)continue;b=boxes[i];inside=false;
            for(j=0;j<polygons.length;j++)if(i!==j){q=boxes[j];
                if(q.left<=b.left && q.top<=b.top && q.right>=b.right && q.bottom>=b.bottom &&
                   q.width*q.height>b.width*b.height && contains([polygons[j]],p[0][0],p[0][1])){inside=true;break;}
            }
            if(!inside)out.push(p);
        }return out;
    }
    function raster(polygons) {
        var b=bounds(polygons),scale=Math.max(b.width,b.height)/144;
        if(!(scale>0))return null;
        var w=Math.ceil(b.width/scale)+4,h=Math.ceil(b.height/scale)+4,
            ox=b.left-2*scale,oy=b.top-2*scale,n=w*h,mask=[],d=[],i,x,y,k,j,a,c,hits,left,right;
        for(i=0;i<n;i++){mask[i]=0;d[i]=0;}
        for(y=1;y<h-1;y++) {
            hits=[];var sy=oy+(y+.5)*scale;
            for(k=0;k<polygons.length;k++)for(j=0;j<polygons[k].length;j++){
                a=polygons[k][j];c=polygons[k][(j+1)%polygons[k].length];
                if((a[1]<=sy && c[1]>sy)||(c[1]<=sy && a[1]>sy))hits.push(a[0]+(sy-a[1])*(c[0]-a[0])/(c[1]-a[1]));
            }
            hits.sort(function(a,b){return a-b;});
            for(k=0;k+1<hits.length;k+=2){
                left=Math.max(1,Math.ceil((hits[k]-ox)/scale-.5));right=Math.min(w-2,Math.floor((hits[k+1]-ox)/scale-.5));
                for(x=left;x<=right;x++){i=y*w+x;mask[i]=1;d[i]=1e6;}
            }
        }
        // Chamfer distance: two linear passes, including diagonal neighbours.
        for(y=1;y<h-1;y++)for(x=1;x<w-1;x++){i=y*w+x;if(mask[i])d[i]=Math.min(d[i],d[i-1]+1,d[i-w]+1,d[i-w-1]+1.414214,d[i-w+1]+1.414214);}
        for(y=h-2;y>0;y--)for(x=w-2;x>0;x--){i=y*w+x;if(mask[i])d[i]=Math.min(d[i],d[i+1]+1,d[i+w]+1,d[i+w+1]+1.414214,d[i+w-1]+1.414214);}
        return {bounds:b,scale:scale,w:w,h:h,ox:ox,oy:oy,mask:mask,d:d};
    }
    function peaks(grid) {
        // Descending superlevel components record where two distance peaks merge.
        var d=grid.d,w=grid.w,n=d.length,order=[],parent=[],leader=[],birth=[],dead=[],i,j,q,root,other,win,lose,
            steps=[-1,1,-w,w],candidates=[],kept=[];
        function find(k){var r=k;while(parent[r]!==r)r=parent[r];while(parent[k]!==k){var p=parent[k];parent[k]=r;k=p;}return r;}
        for(i=0;i<n;i++){parent[i]=-1;dead[i]=false;if(grid.mask[i])order.push(i);}
        order.sort(function(a,b){return d[b]-d[a] || a-b;});
        for(q=0;q<order.length;q++){
            i=order[q];parent[i]=i;leader[i]=i;birth[i]=d[i];
            for(j=0;j<steps.length;j++){
                var k=i+steps[j];if(k<0||k>=n||parent[k]<0)continue;
                root=find(i);other=find(k);if(root===other)continue;
                if(birth[leader[root]]>=birth[leader[other]]){win=root;lose=other;}else{win=other;lose=root;}
                var peak=leader[lose];
                if(!dead[peak] && birth[peak]-d[i]>0.17*birth[peak] && birth[peak]>=3)candidates.push({index:peak,r:birth[peak],saddle:d[i]});
                dead[peak]=true;parent[lose]=win;
            }
        }
        for(q=0;q<order.length;q++){i=order[q];if(parent[i]===i)candidates.push({index:leader[i],r:birth[leader[i]],saddle:0});}
        candidates.sort(function(a,b){return b.r-a.r;});
        for(q=0;q<candidates.length;q++){
            var p=candidates[q];p.x=(p.index%w+.5)*grid.scale+grid.ox;p.y=(Math.floor(p.index/w)+.5)*grid.scale+grid.oy;
            if(kept.length && p.r<kept[0].r*.23)continue;
            var accept=true;
            for(j=0;j<kept.length;j++){
                var dx=p.x-kept[j].x,dy=p.y-kept[j].y;
                if(Math.sqrt(dx*dx+dy*dy)<.70*(p.r+kept[j].r)*grid.scale){accept=false;break;}
            }
            if(accept)kept.push(p);if(kept.length>=4)break;
        }
        return kept;
    }
    function clip(poly,nx,ny,limit) {
        var out=[],i,a,b,da,db,t;
        for(i=0;i<poly.length;i++){
            a=poly[i];b=poly[(i+1)%poly.length];da=a[0]*nx+a[1]*ny-limit;db=b[0]*nx+b[1]*ny-limit;
            if(da<=0)out.push(a);
            if((da<=0)!=(db<=0)){t=da/(da-db);out.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);}
        }return out;
    }
    function bodyPolygons(polygons) {
        // A morphological opening removes thin tails from the text area.
        // Bounding the eroded core then restoring its radius reproduces the
        // existing host opening without additional Photoshop mutations.
        var grid=raster(polygons),b=grid.bounds,r=Math.min(b.width,b.height)*.1/grid.scale;
        var left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity,i,x,y;
        for(i=0;i<grid.d.length;i++)if(grid.mask[i] && grid.d[i]>=r){
            x=grid.ox+(i%grid.w+.5)*grid.scale;y=grid.oy+(Math.floor(i/grid.w)+.5)*grid.scale;
            left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
        }
        if(left===Infinity)return polygons;
        r*=grid.scale;left=Math.max(b.left,left-r);right=Math.min(b.right,right+r);
        top=Math.max(b.top,top-r);bottom=Math.min(b.bottom,bottom+r);
        var out=[],p;
        for(i=0;i<polygons.length;i++){
            p=clip(polygons[i],-1,0,-left);p=clip(p,1,0,right);
            p=clip(p,0,-1,-top);p=clip(p,0,1,bottom);if(p.length>=3)out.push(p);
        }return out.length?out:polygons;
    }
    function polygonArea(p) {
        var area=0,i;for(i=0;i<p.length;i++){var q=p[(i+1)%p.length];area+=p[i][0]*q[1]-q[0]*p[i][1];}return area/2;
    }
    function simplifyClosed(p,tolerance) {
        function segmentDistance(point,a,b){var x=b[0]-a[0],y=b[1]-a[1],s=x*x+y*y,t=s?((point[0]-a[0])*x+(point[1]-a[1])*y)/s:0;t=Math.max(0,Math.min(1,t));x=point[0]-a[0]-t*x;y=point[1]-a[1]-t*y;return Math.sqrt(x*x+y*y);}
        function reduce(points){var best=0,index=-1;for(var i=1;i<points.length-1;i++){var d=segmentDistance(points[i],points[0],points[points.length-1]);if(d>best){best=d;index=i;}}
            if(best<=tolerance || index<0)return [points[0],points[points.length-1]];
            var left=reduce(points.slice(0,index+1)),right=reduce(points.slice(index));return left.slice(0,left.length-1).concat(right);
        }
        var far=1,max=0,i;for(i=1;i<p.length;i++){var dx=p[i][0]-p[0][0],dy=p[i][1]-p[0][1],d=dx*dx+dy*dy;if(d>max){max=d;far=i;}}
        var a=reduce(p.slice(0,far+1)),b=reduce(p.slice(far).concat([p[0]]));return a.slice(0,a.length-1).concat(b.slice(0,b.length-1));
    }
    function contourJunction(polygons,first,second,grid,maxNotches) {
        // Distance peaks establish that there are two bodies. Their radii only
        // estimate the join: anchor it to opposing inward contour corners when
        // both bodies and the entire cross-section confirm the same junction.
        var ax=second.x-first.x,ay=second.y-first.y,distance=Math.sqrt(ax*ax+ay*ay),
            radius=Math.min(first.r,second.r)*grid.scale;
        if(!(distance>0) || !(radius>0))return null;
        ax/=distance;ay/=distance;
        var expected=(distance+(first.r-second.r)*grid.scale)/2,best=null,score=-Infinity,candidates=[],i,j,k;
        for(k=0;k<polygons.length;k++){
            var poly=polygons[k];
            if(!contains([poly],first.x,first.y) || !contains([poly],second.x,second.y))continue;
            var p=simplifyClosed(poly,Math.max(grid.scale*.65,radius*.018)),
                orientation=polygonArea(p)>0?1:-1,notches=[];
            for(i=0;i<p.length;i++){
                var a=p[(i+p.length-1)%p.length],b=p[i],c=p[(i+1)%p.length],
                    ux=b[0]-a[0],uy=b[1]-a[1],vx=c[0]-b[0],vy=c[1]-b[1],
                    l1=Math.sqrt(ux*ux+uy*uy),l2=Math.sqrt(vx*vx+vy*vy),cross=ux*vy-uy*vx,
                    chord=Math.sqrt((c[0]-a[0])*(c[0]-a[0])+(c[1]-a[1])*(c[1]-a[1])),
                    along=(b[0]-first.x)*ax+(b[1]-first.y)*ay,
                    side=-(b[0]-first.x)*ay+(b[1]-first.y)*ax;
                if(!l1 || !l2 || !chord || cross*orientation>=-.15*l1*l2 ||
                   Math.abs(cross)/chord<radius*.02 || along<distance*.05 || along>distance*.95)continue;
                var ix=ux/l1-vx/l2,iy=uy/l1-vy/l2,il=Math.sqrt(ix*ix+iy*iy);
                if(il)notches.push({point:b,side:side,depth:Math.abs(cross)/chord,ix:ix/il,iy:iy/il});
            }
            notches.sort(function(a,b){return b.depth-a.depth;});
            if(notches.length>(maxNotches || 24))notches=notches.slice(0,maxNotches || 24);
            for(i=0;i<notches.length;i++)for(j=i+1;j<notches.length;j++){
                a=notches[i].point;b=notches[j].point;
                var dx=b[0]-a[0],dy=b[1]-a[1],length=Math.sqrt(dx*dx+dy*dy);
                if(notches[i].side*notches[j].side>=-grid.scale*grid.scale ||
                   length<grid.scale*2 || length>radius*2.2)continue;
                if((notches[i].ix*dx+notches[i].iy*dy)/length<.35 ||
                   (-notches[j].ix*dx-notches[j].iy*dy)/length<.35)continue;
                var nx=-dy/length,ny=dx/length;
                if(nx*ax+ny*ay<0){nx=-nx;ny=-ny;}
                var alignment=nx*ax+ny*ay,limit=a[0]*nx+a[1]*ny,
                    da=limit-first.x*nx-first.y*ny,db=second.x*nx+second.y*ny-limit;
                if(alignment<.65 || da<radius*.15 || db<radius*.15)continue;
                var valid=true,s;
                for(s=1;s<8;s++)if(!contains([poly],a[0]+dx*s/8,a[1]+dy*s/8)){valid=false;break;}
                if(!valid)continue;
                // A tail, an extra notch, or a folded contour can suggest a
                // chord that cuts elsewhere too. Require one complete section.
                for(s=0;s<poly.length;s++){
                    var u=poly[s],v=poly[(s+1)%poly.length],
                        du=u[0]*nx+u[1]*ny-limit,dv=v[0]*nx+v[1]*ny-limit;
                    if(Math.abs(du)<grid.scale*.000001){
                        var touch=((u[0]-a[0])*dx+(u[1]-a[1])*dy)/length;
                        if(touch<-grid.scale*1.5 || touch>length+grid.scale*1.5){valid=false;break;}
                    }
                    if((du<=0)!=(dv<=0)){
                        var t=du/(du-dv),x=u[0]+t*(v[0]-u[0]),y=u[1]+t*(v[1]-u[1]),
                            position=((x-a[0])*dx+(y-a[1])*dy)/length;
                        if(position<-grid.scale*1.5 || position>length+grid.scale*1.5){valid=false;break;}
                    }
                }
                if(!valid)continue;
                var value=(notches[i].depth+notches[j].depth)/radius-length/radius*.2-
                    Math.abs(da/alignment-expected)/distance*.3;
                var candidate={nx:nx,ny:ny,limit:limit,along:da/alignment,score:value};
                candidates.push(candidate);
                if(value>score){score=value;best=candidate;}
            }
        }
        // Several equally credible but different cross-sections provide no
        // reliable anchor. Keep the established disk-based split in that case.
        for(i=0;best && i<candidates.length;i++){
            var other=candidates[i];
            if(other.score>=score-.1 && (Math.abs(other.along-best.along)>radius*.25 ||
               other.nx*best.nx+other.ny*best.ny<.96))return null;
        }
        return best;
    }
    function angularSplit(polygons) {
        if(polygons.length!==1)return null;
        var poly=polygons[0],box=bounds(polygons),size=Math.min(box.width,box.height),p=simplifyClosed(poly,size*.035),orientation=polygonArea(p)>0?1:-1,notches=[],i,j;
        for(i=0;i<p.length;i++){
            var a=p[(i+p.length-1)%p.length],b=p[i],c=p[(i+1)%p.length],ux=b[0]-a[0],uy=b[1]-a[1],vx=c[0]-b[0],vy=c[1]-b[1],l1=Math.sqrt(ux*ux+uy*uy),l2=Math.sqrt(vx*vx+vy*vy);
            var chord=Math.sqrt((c[0]-a[0])*(c[0]-a[0])+(c[1]-a[1])*(c[1]-a[1])),depth=chord?Math.abs(ux*vy-uy*vx)/chord:0;
            if((ux*vy-uy*vx)*orientation<-0.35*l1*l2 && Math.max(l1,l2)>size*.10 && depth>size*.04){
                var ix=ux/l1-vx/l2,iy=uy/l1-vy/l2,il=Math.sqrt(ix*ix+iy*iy);
                notches.push({depth:depth,point:b,edge:Math.max(l1,l2),ix:ix/il,iy:iy/il});
            }
        }
        // Retain a short tail as an extra corner; densely repeated inward corners
        // describe an explosion/cloud rather than a neck.
        if(notches.length>5)return null;
        notches.sort(function(a,b){return b.depth-a.depth;});
        if(notches.length===5 && notches[4].depth>notches[0].depth*.6)return null;
        var total=Math.abs(polygonArea(poly)),best=null,score=-Infinity;
        for(i=0;i<notches.length;i++)for(j=i+1;j<notches.length;j++){
            a=notches[i].point;b=notches[j].point;var dx=b[0]-a[0],dy=b[1]-a[1],length=Math.sqrt(dx*dx+dy*dy);
            if(length<size*.18 || length>size*.9)continue;
            if((notches[i].ix*dx+notches[i].iy*dy)/length<.5 || (-notches[j].ix*dx-notches[j].iy*dy)/length<.5)continue;
            if(!contains(polygons,a[0]+dx*.25,a[1]+dy*.25) || !contains(polygons,a[0]+dx*.5,a[1]+dy*.5) || !contains(polygons,a[0]+dx*.75,a[1]+dy*.75))continue;
            var nx=-dy/length,ny=dx/length,limit=a[0]*nx+a[1]*ny,one=clip(poly,nx,ny,limit),two=clip(poly,-nx,-ny,-limit);
            var balance=Math.min(Math.abs(polygonArea(one)),Math.abs(polygonArea(two)))/total;
            if(balance<0.16)continue;
            var value=balance*.2-length/size*.8;
            if(value>score){score=value;best=[one,two];}
        }
        if(!best)return null;
        var regions=[];for(i=0;i<best.length;i++){var body=bodyPolygons([best[i]]),b=bounds(body);regions.push({polygons:body,bounds:b,center:{x:b.xMid,y:b.yMid},split:true});}return regions;
    }
    function wideContourSplit(polygons,grid) {
        // Only the single-body fallback uses this finer contour pass. Reuse the
        // existing 144-cell grid scale; never rasterize candidate pairs.
        if(polygons.length!==1)return null;
        var poly=polygons[0],box=grid.bounds,size=Math.min(box.width,box.height),
            orientation=polygonArea(poly)>0?1:-1,notches=[],i,j,k,
            run=0,runs=0,firstRun=0,seenConvex=false;
        // Count inward arcs before simplification can erase shallow cloud bumps.
        // Sum normalized turns to ignore tiny isolated contour noise. Convex
        // singles exit here without a second Douglas-Peucker pass.
        for(i=0;i<poly.length;i++){
            var a=poly[(i+poly.length-1)%poly.length],b=poly[i],c=poly[(i+1)%poly.length],
                ux=b[0]-a[0],uy=b[1]-a[1],vx=c[0]-b[0],vy=c[1]-b[1],
                product=Math.sqrt((ux*ux+uy*uy)*(vx*vx+vy*vy)),turn=product?(ux*vy-uy*vx)*orientation/product:0;
            if(turn<-.000001)run-=turn;
            else {
                if(!seenConvex){firstRun=run;seenConvex=true;}
                else if(run>.15)runs++;
                run=0;
                if(runs>4)return null;
            }
        }
        if(run+firstRun>.15)runs++;
        if(runs<2 || runs>4)return null;
        var p=simplifyClosed(poly,Math.max(grid.scale,size*.012));
        for(i=0;i<p.length;i++){
            var a=p[(i+p.length-1)%p.length],b=p[i],c=p[(i+1)%p.length],
                ux=b[0]-a[0],uy=b[1]-a[1],vx=c[0]-b[0],vy=c[1]-b[1],
                l1=Math.sqrt(ux*ux+uy*uy),l2=Math.sqrt(vx*vx+vy*vy),cross=ux*vy-uy*vx,
                chord=Math.sqrt((c[0]-a[0])*(c[0]-a[0])+(c[1]-a[1])*(c[1]-a[1]));
            if(!l1 || !l2 || !chord || cross*orientation>=-.2*l1*l2 || Math.abs(cross)/chord<Math.max(grid.scale*.8,size*.008))continue;
            var ix=ux/l1-vx/l2,iy=uy/l1-vy/l2,il=Math.sqrt(ix*ix+iy*iy);
            if(il)notches.push({point:b,ix:ix/il,iy:iy/il});
            // Clouds/bursts do not provide one unambiguous pair. Six pairs at most.
            if(notches.length>4)return null;
        }
        var best=null,total=Math.abs(polygonArea(poly));
        for(i=0;i<notches.length;i++)for(j=i+1;j<notches.length;j++){
            a=notches[i].point;b=notches[j].point;
            var dx=b[0]-a[0],dy=b[1]-a[1],length=Math.sqrt(dx*dx+dy*dy);
            if(length<size*.3 || length>Math.sqrt(box.width*box.width+box.height*box.height)*.98)continue;
            if((notches[i].ix*dx+notches[i].iy*dy)/length<.65 ||
               (-notches[j].ix*dx-notches[j].iy*dy)/length<.65)continue;
            var nx=-dy/length,ny=dx/length,limit=a[0]*nx+a[1]*ny,valid=true;
            for(k=1;k<8;k++)if(!contains([poly],a[0]+dx*k/8,a[1]+dy*k/8)){valid=false;break;}
            if(!valid)continue;
            // The proposed section must not intersect a tail or another body.
            for(k=0;k<poly.length;k++){
                var u=poly[k],v=poly[(k+1)%poly.length],du=u[0]*nx+u[1]*ny-limit,dv=v[0]*nx+v[1]*ny-limit;
                if(Math.abs(du)<grid.scale*.000001){
                    var touch=((u[0]-a[0])*dx+(u[1]-a[1])*dy)/length;
                    if(touch<-grid.scale*1.5 || touch>length+grid.scale*1.5){valid=false;break;}
                }
                if((du<=0)!=(dv<=0)){
                    var t=du/(du-dv),x=u[0]+t*(v[0]-u[0]),y=u[1]+t*(v[1]-u[1]),position=((x-a[0])*dx+(y-a[1])*dy)/length;
                    if(position<-grid.scale*1.5 || position>length+grid.scale*1.5){valid=false;break;}
                }
            }
            if(!valid)continue;
            var one=clip(poly,nx,ny,limit),two=clip(poly,-nx,-ny,-limit),
                area1=Math.abs(polygonArea(one)),area2=Math.abs(polygonArea(two)),balance=Math.min(area1,area2)/total;
            if(balance<.22)continue;
            // In a frame aligned with the section, require two filled bodies.
            // A triangular tail has low fill and must not become a second lobe.
            var parts=[one,two];
            for(var side=0;side<2;side++){
                var low=Infinity,high=-Infinity,depth=0,part=parts[side];
                for(k=0;k<part.length;k++){
                    var along=((part[k][0]-a[0])*dx+(part[k][1]-a[1])*dy)/length;
                    low=Math.min(low,along);high=Math.max(high,along);
                    depth=Math.max(depth,Math.abs(part[k][0]*nx+part[k][1]*ny-limit));
                }
                if(depth<length*.20 || length>(high-low)*.97 || !(high>low) || (side===0?area1:area2)/((high-low)*depth)<.58){valid=false;break;}
            }
            if(!valid)continue;
            if(best)return null; // More than one credible junction: keep the safe single region.
            best=parts;
        }
        if(!best)return null;
        var regions=[];
        for(i=0;i<2;i++){
            var body=bodyPolygons([best[i]]),rb=bounds(body);
            regions.push({polygons:body,bounds:rb,center:{x:rb.xMid,y:rb.yMid},split:true});
        }
        return regions;
    }
    // Wide junctions can hide a lobe in the distance peaks. Refine existing
    // regions at inward contour corners, also handling a connected triple.
    function refineRegions(regions) {
        var result=[],pending=regions.slice(0),iterations=0;
        while(pending.length && iterations++<12){
            var region=pending.shift(),parts=angularSplit(region.polygons);
            if(parts && result.length+pending.length+parts.length<=4){
                for(var k=0;k<parts.length;k++)pending.push(parts[k]);
            }else result.push(region);
        }
        return result.concat(pending);
    }
    function detect(polygons) {
        polygons=outerContours(polygons);
        var grid=raster(polygons);if(!grid)return [];
        var ps=peaks(grid),regions=[],i,j,k,a,b,dx,dy,len,t,part,polys;
        if(ps.length<2){var angular=angularSplit(polygons);if(angular)return refineRegions(angular);var wide=wideContourSplit(polygons,grid);if(wide)return refineRegions(wide);return [{polygons:polygons,bounds:grid.bounds,center:{x:grid.bounds.xMid,y:grid.bounds.yMid},split:false}];}
        var junction=ps.length===2?contourJunction(polygons,ps[0],ps[1],grid):null;
        for(i=0;i<ps.length;i++){
            a=ps[i];polys=polygons;
            for(j=0;j<ps.length;j++)if(i!==j){
                b=ps[j];dx=b.x-a.x;dy=b.y-a.y;len=Math.sqrt(dx*dx+dy*dy);dx/=len;dy/=len;
                // Equal distance to each inscribed disk's edge puts the cut in the neck.
                t=Math.max(len*.18,Math.min(len*.82,(len+(a.r-b.r)*grid.scale)/2));
                var limit=(a.x+dx*t)*dx+(a.y+dy*t)*dy;
                if(junction){var sign=i===0?1:-1;dx=junction.nx*sign;dy=junction.ny*sign;limit=junction.limit*sign;}
                part=[];for(k=0;k<polys.length;k++){
                    var c=clip(polys[k],dx,dy,limit);
                    if(c.length>=3)part.push(c);
                }polys=part;
            }
            if(!polys.length)continue;
            polys=bodyPolygons(polys);
            var rb=bounds(polys);if(rb.width*rb.height<200)continue;
            regions.push({polygons:polys,bounds:rb,center:{x:a.x,y:a.y},radius:a.r*grid.scale,split:true});
        }
        return regions.length>1?refineRegions(regions):[{polygons:polygons,bounds:grid.bounds,center:{x:grid.bounds.xMid,y:grid.bounds.yMid},split:false}];
    }
    function assistedSplit(polygons,first,second,offset,angle) {
        // Explicit user intent supplies two bodies. Preview a contour-anchored
        // line when available; otherwise offer an adjustable bisector.
        polygons=outerContours(polygons);
        if(!first || !second || !isFinite(first.x) || !isFinite(first.y) ||
           !isFinite(second.x) || !isFinite(second.y) ||
           !contains(polygons,first.x,first.y) || !contains(polygons,second.x,second.y))return null;
        var grid=raster(polygons);if(!grid)return null;
        var dx=second.x-first.x,dy=second.y-first.y,distance=Math.sqrt(dx*dx+dy*dy);
        if(distance<grid.scale*3)return null;
        function radius(seed){
            var x=Math.floor((seed.x-grid.ox)/grid.scale),y=Math.floor((seed.y-grid.oy)/grid.scale),
                r=grid.d[y*grid.w+x] || 0;
            return Math.min(distance*.6,Math.max(grid.scale*3,r*grid.scale*1.3))/grid.scale;
        }
        var a={x:first.x,y:first.y,r:radius(first)},b={x:second.x,y:second.y,r:radius(second)},
            junction=contourJunction(polygons,a,b,grid,8),nx=junction?junction.nx:dx/distance,
            ny=junction?junction.ny:dy/distance,
            limit=junction?junction.limit:((first.x+second.x)*nx+(first.y+second.y)*ny)/2;
        offset=offset===undefined || offset===null?0:Number(offset);
        angle=angle===undefined || angle===null?0:Number(angle);
        if(!isFinite(offset) || !isFinite(angle))return null;
        angle=Math.max(-60,Math.min(60,angle))*Math.PI/180;
        if(angle){
            var along=(limit-first.x*nx-first.y*ny)/(dx*nx+dy*ny),
                cx=first.x+dx*along,cy=first.y+dy*along,
                rx=nx*Math.cos(angle)-ny*Math.sin(angle),ry=nx*Math.sin(angle)+ny*Math.cos(angle);
            nx=rx;ny=ry;limit=cx*nx+cy*ny;
        }
        offset=Math.max(-.4,Math.min(.4,offset));limit+=distance*offset;
        if(first.x*nx+first.y*ny>=limit-grid.scale || second.x*nx+second.y*ny<=limit+grid.scale)return null;
        var regions=[],i,k;
        for(i=0;i<2;i++){
            var sign=i===0?1:-1,parts=[];
            for(k=0;k<polygons.length;k++){
                var part=clip(polygons[k],nx*sign,ny*sign,limit*sign);
                if(part.length>=3 && Math.abs(polygonArea(part))>grid.scale*grid.scale)parts.push(part);
            }
            if(!parts.length)return null;
            // One body opening per accepted half, never a full-resolution image.
            var body=bodyPolygons(parts),rb=bounds(body),seed=i===0?first:second;
            regions.push({polygons:body,bounds:rb,center:{x:seed.x,y:seed.y},split:true});
        }
        return {regions:regions,anchored:!!junction,line:{nx:nx,ny:ny,limit:limit}};
    }
    function choose(regions,seed) {
        if(!regions.length)return null;if(!seed)return regions.length===1?regions[0]:null;
        var i,best=null,score=Infinity;
        for(i=0;i<regions.length;i++){
            var r=regions[i];if(contains(r.polygons,seed.x,seed.y))return r;
            var dx=seed.x-r.center.x,dy=seed.y-r.center.y,s=dx*dx+dy*dy;
            if(s<score){score=s;best=r;}
        }return best;
    }
    return {detect:detect,assistedSplit:assistedSplit,choose:choose,bounds:bounds,contains:contains,raster:raster,peaks:peaks,outerContours:outerContours,bodyPolygons:bodyPolygons};
}());
if(typeof window!=='undefined')window.TypeRDoubleBubble=TypeRDoubleBubble;
if(typeof module!=='undefined' && module.exports)module.exports=TypeRDoubleBubble;
