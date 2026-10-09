import "./doubleBubbleGeometry";
/* Double bubble: Photoshop wand bridge. Off until the panel enables it. ES5 for CEP 6 / Photoshop CC 2015. */
(function () {
    'use strict';
    if(!window.CSInterface || !window.CSEvent || window.TypeRDoubleBubbleBridge)return;
    var seed=null,revision=0,owned=0,probing=0,pending=[],cached=null,queue=[],running=false,ownedClicks=[],ownedSynthetic=[],captureOwned=false,autoTimer=null,activeSelectionProbe=false;
    var original=window.CSInterface.prototype.evalScript;
    var api=window.TypeRDoubleBubbleBridge={version:'1',enabled:false,autoSelect:true,lastSeed:null,lastSelectionEvent:null,log:[]};
    api.setAssisting=function(value){
        api.assisting=!!value;
        if(api.assisting && autoTimer){clearTimeout(autoTimer);autoTimer=null;}
    };
    api.requestAssistance=function(callback){
        cs.evalScript('getTypeRAssistedBubbleProbe('+JSON.stringify({seed:seed})+')',callback);
    };
    function contourKey(polygons){
        if(!polygons || !window.TypeRDoubleBubble)return '';
        var outer=window.TypeRDoubleBubble.outerContours(polygons),keys=[];
        for(var k=0;k<outer.length;k++){
            var p=outer[k],points=[],i,point;
            for(i=0;i<p.length;i++){
                point=Math.round(p[i][0]*4)+','+Math.round(p[i][1]*4);
                if(!points.length || point!==points[points.length-1])points.push(point);
            }
            if(points.length>1 && points[0]===points[points.length-1])points.pop();
            var start=0;
            for(i=1;i<points.length;i++)if(points[i]<points[start])start=i;
            var forward=[],backward=[];
            for(i=0;i<points.length;i++){
                forward.push(points[(start+i)%points.length]);
                backward.push(points[(start-i+points.length)%points.length]);
            }
            var a=forward.join(';'),b=backward.join(';');keys.push(a<b?a:b);
        }
        return keys.sort().join('|');
    }
    function manualGeometry(polygons,manual){
        if(!manual.whole)return window.TypeRDoubleBubble.assistedSplit(polygons,manual.first,manual.second,manual.offset,manual.angle);
        var g=window.TypeRDoubleBubble,body=g.bodyPolygons(g.outerContours(polygons)),box=g.bounds(body);
        return {regions:[{polygons:body,bounds:box,center:{x:box.xMid,y:box.yMid},split:true}]};
    }
    api.applyAssistance=function(data,callback,polygons){
        var stamp=revision;
        cs.evalScript('setTypeRAssistedBubbleLobe('+JSON.stringify(data)+')',function(raw){
            var result;
            try{result=JSON.parse(raw);}catch(error){result={changed:false,error:'hostError'};}
            if(result.changed && result.seed && revision===stamp){
                seed=result.seed;seed.receivedAt=Date.now();api.lastSeed=seed;cached=null;revision++;
                if(polygons)api.lastManual={documentID:data.documentID,signature:contourKey(polygons),first:data.first,second:data.second,offset:data.offset,angle:data.angle,whole:!!data.whole};
            }
            if(callback)callback(result);
        });
    };
    api.setEnabled=function(value) {
        var enabled=value!==false;
        if(api.enabled===enabled)return;
        api.enabled=enabled;revision++;seed=null;cached=null;api.lastSeed=null;api.lastDetection=null;api.lastManual=null;
        if(autoTimer){clearTimeout(autoTimer);autoTimer=null;}
        // Keep the host in step: while the mode is off, every call below passes straight
        // through, so the host must drop its own lobe state here rather than on the next call.
        original.call(cs,'setTypeRDoubleBubbleMode('+enabled+')',function(){});
    };
    function numeric(value) {
        if(typeof value==='number')return value;
        if(value && typeof value._value==='number' && (!value._unit || value._unit==='pixelsUnit'))return value._value;
        if(value && typeof value.value==='number' && (!value.units || value.units==='pixelsUnit'))return value.value;
        return null;
    }
    function selectionTarget(target) {
        if(!target)return false;
        if(Object.prototype.toString.call(target)==='[object Array]'){
            for(var i=0;i<target.length;i++)if(selectionTarget(target[i]))return true;
            return false;
        }
        return (target._ref==='channel' || target._class==='channel') &&
            (target._property==='selection' || target._property==='fsel' || target._enum==='channel' && (target._value==='selection' || target._value==='fsel'));
    }
    function applySelection(event) {
        revision++;seed=event.point;api.lastSeed=seed;api.lastSelectionEvent=event.data;
        if(seed)seed.receivedAt=Date.now();
        if(autoTimer){clearTimeout(autoTimer);autoTimer=null;}
        if(seed && api.enabled && api.autoSelect && !api.assisting && !activeSelectionProbe && !queue.some(function(job){return /\bselectTypeRDoubleBubbleLobe\s*\(/.test(job.script);})){
            var stamp=revision;
            autoTimer=setTimeout(function(){
                autoTimer=null;if(!api.enabled || api.assisting || !seed || revision!==stamp)return;
                cs.evalScript('selectTypeRDoubleBubbleLobe()',function(raw){
                    try{api.lastApplied=JSON.parse(raw);}catch(error){api.lastError=String(raw);}
                });
            },80);
        }
    }
    function observe(event) {
        api.log.push({t:Date.now(),data:String(event && event.data).slice(0,4000)});
        if(api.log.length>40)api.log.shift();
        var parsed=event && event.data;
        try {if(typeof parsed==='string')parsed=JSON.parse(parsed.replace(/^ver\d+,\s*/,''));}catch(error){return;}
        if(!parsed || Number(parsed.eventID)!==1936028772)return;
        var data=parsed.eventData || parsed.descriptor;
        if(!data || !selectionTarget(data['null'] || data._target))return;
        var value=data.to || data.T,point=null;
        if(value && (value._obj==='paint' || value._obj==='point')){
            var x=numeric(value.horizontal),y=numeric(value.vertical);
            if(x===null || y===null)return;
            point={x:x,y:y};if(typeof data.documentID==='number')point.documentID=data.documentID;
        }else{
            // Reference restores belong to scans. Geometry/deselection invalidates.
            if(!value || !/^(rectangle|ellipse|polygon|lasso)$/.test(value._obj||'') && value._value!=='none')return;
        }
        var selection={data:data,point:point};
        if(probing){pending.push(selection);if(pending.length>20)pending.shift();return;}
        if(owned){
            // A real click can arrive after Photoshop finished the operation,
            // before its CEP callback. Retain paint points, ignoring our own.
            if(point && captureOwned){ownedClicks.push(selection);if(ownedClicks.length>20)ownedClicks.shift();}
            return;
        }
        applySelection(selection);
    }
    function flushPending(synthetic) {
        var events=pending;pending=[];
        for(var i=0;i<events.length;i++){
            var event=events[i],internal=false,p=event.point;
            for(var j=0;p && j<synthetic.length;j++){
                var s=synthetic[j];
                if(p.x===s.x && p.y===s.y && (p.documentID===undefined || p.documentID===s.documentID)){internal=true;break;}
            }
            if(!internal)applySelection(event);
        }
    }
    window.CSInterface.prototype.evalScript=function(script,callback) {
        var match=/\b(selectTypeRDoubleBubbleLobe|createTextLayerInSelection|alignTextLayerToSelection|getSelectionChanged|getCurrentSelectionShape)\s*\(/.test(script);
        var auto=/\bgetActiveLayerBubbleShape\s*\(/.test(script);
        var assisted=/\b(getTypeRAssistedBubbleProbe|setTypeRAssistedBubbleLobe)\s*\(/.test(script);
        var changesSelection=assisted || match || /\b(getActiveLayerBubbleShape|getAllRenderedTextLines|scanTextShapeRTraining|createTextLayersInStoredSelections)\s*\(/.test(script);
        // Mode off: no queueing, no probe, no prefix. The panel pays nothing for this file.
        if(!api.enabled || !changesSelection)return original.call(this,script,callback);
        if(running){
            // Polling and automatic selection can share a pending request. Never coalesce Paste.
            if(/\b(getSelectionChanged|getCurrentSelectionShape|selectTypeRDoubleBubbleLobe)\s*\(/.test(script)){
                for(var qi=0;qi<queue.length;qi++)if(queue[qi].script===script){
                    var previous=queue[qi].callback,consume=/\bgetSelectionChanged\s*\(/.test(script);
                    // Selection changes are consumed once. Resolving every merged poll
                    // with the same capture can append duplicates before React updates.
                    queue[qi].callback=function(result){if(previous)previous(result);if(callback)callback(consume?'':result);};return;
                }
            }
            queue.push({cs:this,script:script,callback:callback});return;
        }
        running=true;
        if(seed && Date.now()-seed.receivedAt>120000){seed=null;api.lastSeed=null;revision++;}
        var cs=this,done=false,timer=null,attempts=0,forceRepair=false,seedWaited=false;
        function release(){activeSelectionProbe=false;running=false;var job=queue.shift();if(job)window.CSInterface.prototype.evalScript.call(job.cs,job.script,job.callback);}
        function finish(result){if(done)return;done=true;if(timer)clearTimeout(timer);owned=Math.max(0,owned-1);if(assisted){try{ownedSynthetic=JSON.parse(result).syntheticPoints||[];}catch(error){ownedSynthetic=[];}}pending=ownedClicks;ownedClicks=[];flushPending(ownedSynthetic);captureOwned=false;try{if(callback)callback(result);}finally{release();}}
        function run(snapshot,region) {
            var prefix='setTypeRDoubleBubbleMode('+api.enabled+');';
            if(match)prefix+='setTypeRSelectionSeed('+JSON.stringify(api.enabled?snapshot:null)+');';
            if(region)prefix+='setTypeRDetectedLobe('+JSON.stringify(region)+');';
            if(/\bselectTypeRDoubleBubbleLobe\s*\(/.test(script) && region)script=script.replace('selectTypeRDoubleBubbleLobe()', 'selectTypeRDoubleBubbleLobe('+JSON.stringify({expectedKey:region.key})+')');
            activeSelectionProbe=false;
            timer=setTimeout(function(){api.lastError='callTimeout';finish('callTimeout');},60000);
            captureOwned=!!(match || auto || assisted);ownedClicks=[];ownedSynthetic=region && region.syntheticPoints || [];
            owned++;
            try{return original.call(cs,prefix+script,finish);}catch(error){if(!done){owned--;done=true;release();}throw error;}
        }
        function prepare() {
            var snapshot=seed,stamp=revision;
            if(assisted)return run(snapshot,null);
            // Photoshop may answer the selection poll before delivering its wand event.
            // Give that event a short grace period before capturing an entire joined bubble (notifications can arrive over 200 ms late).
            if(api.enabled && !snapshot && /\bgetSelectionChanged\s*\(/.test(script) && !seedWaited){
                seedWaited=true;timer=setTimeout(function(){timer=null;prepare();},400);return;
            }
            if(!api.enabled || (!auto && (!match || !snapshot)) || !window.TypeRDoubleBubble)return run(snapshot,null);
            attempts++;probing++;pending=[];activeSelectionProbe=/\bselectTypeRDoubleBubbleLobe\s*\(/.test(script);
            var request=auto?{cachedKey:cached && cached.key}:{x:snapshot.x,y:snapshot.y,documentID:snapshot.documentID,cachedKey:cached && cached.key};
            if(forceRepair)request.forceRepair=true;
            var waiting=true;
            timer=setTimeout(function(){
                if(!waiting || done)return;waiting=false;probing=Math.max(0,probing-1);flushPending([]);
                api.lastError='probeTimeout';finish('noSelection');
            },15000);
            try {
                return original.call(cs,(auto?'getTypeRActiveBubbleProbe(':'getTypeRDoubleBubbleProbe(')+JSON.stringify(request)+')',function(raw){
                    if(!waiting || done)return;waiting=false;clearTimeout(timer);timer=null;probing=Math.max(0,probing-1);
                    var prepared=null,probe=null,retryRepair=false;
                    try {
                        probe=JSON.parse(raw);
                        // Bind a native wand point to the document that verified it.
                        // A previous page's seed must not trigger repair/capture in a new page.
                        if(!auto && probe && probe.documentID!==undefined && snapshot && revision===stamp){
                            if(snapshot.documentID!==undefined && snapshot.documentID!==probe.documentID){
                                seed=null;api.lastSeed=null;cached=null;revision++;
                            }else if(!probe.error)snapshot.documentID=probe.documentID;
                        }
                        if(probe && probe.same && cached && cached.key===probe.key)prepared=cached;
                        else if(probe && !probe.error && probe.selected && probe.regions){
                            prepared={key:probe.key,documentID:probe.documentID,regions:probe.regions,selected:probe.selected,repaired:!!probe.repaired,auto:!!probe.auto,syntheticPoints:[]};cached=prepared;
                        }
                        else if(probe && !probe.error && probe.polygons){
                            var geometry=window.TypeRDoubleBubble,manual=api.lastManual,
                                assistedGeometry=!auto && manual && manual.documentID===probe.documentID && manual.signature===contourKey(probe.polygons)?manualGeometry(probe.polygons,manual):null,
                                regions=assistedGeometry?assistedGeometry.regions:geometry.detect(probe.polygons),geometrySeed=probe.geometrySeed || probe.seed,selected=geometry.choose(regions,geometrySeed);
                            // Four peaks inside one complex ink-filled outline can indicate leakage into art.
                            // Separate components and genuine triples do not trigger this fallback.
                            if(regions.length>3 && !probe.repaired && !forceRepair && probe.polygons.length>40 && geometry.outerContours(probe.polygons).length===1)retryRepair=true;
                            if(selected && !geometry.contains(probe.polygons,geometrySeed.x,geometrySeed.y))selected=null;
                            if(probe.auto && selected && !selected.split){
                                var body=geometry.bodyPolygons(selected.polygons);selected={polygons:body,bounds:geometry.bounds(body),split:false,center:selected.center};
                            }
                            prepared={key:probe.key,documentID:probe.documentID,regions:regions,selected:selected,repaired:probe.repaired,auto:!!probe.auto,syntheticPoints:probe.syntheticPoints||[]};
                            cached=prepared;api.lastDetection={count:regions.length,repaired:!!probe.repaired,key:probe.key,timing:probe.timing};
                        }
                    }catch(error){api.lastError=String(error.message||error);}
                    flushPending(probe && probe.syntheticPoints || []);
                    if(revision!==stamp){
                        forceRepair=false;
                        if(attempts<3)return prepare();
                        finish('noSelection');return;
                    }
                    if(retryRepair){forceRepair=true;return prepare();}
                    return run(snapshot,prepared);
                });
            }catch(error){if(!done){clearTimeout(timer);probing=Math.max(0,probing-1);flushPending([]);done=true;release();}throw error;}
        }
        return prepare();
    };
    var cs=new window.CSInterface(),id=cs.getExtensionID();
    cs.addEventListener('com.adobe.PhotoshopJSONCallback'+id,observe);
    var register=new window.CSEvent('com.adobe.PhotoshopRegisterEvent','APPLICATION');
    register.extensionId=id;register.data='1936483188, 1936028772, 1836021349';cs.dispatchEvent(register);
}());

