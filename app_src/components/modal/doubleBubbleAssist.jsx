import React from 'react';
import './doubleBubbleAssist.scss';
import {locale} from '../../utils';
import {useContext} from '../../context';
import {useModalClose} from '../../modalClose';
const DoubleBubbleAssist = React.memo(function DoubleBubbleAssist() {
    const context=useContext(()=>({}));
    const [probe,setProbe]=React.useState(null),[points,setPoints]=React.useState([]),[offset,setOffset]=React.useState(0),[angle,setAngle]=React.useState(0);
    const [preview,setPreview]=React.useState(null),[loading,setLoading]=React.useState(true),[pending,setPending]=React.useState(false),[busy,setBusy]=React.useState(false),[error,setError]=React.useState('');
    const close=()=>context.dispatch({type:'setModal'});
    const mounted=React.useRef(true);
    useModalClose(()=>{if(!busy)close();});
    React.useEffect(()=>{
        const api=window.TypeRDoubleBubbleBridge;let alive=true;mounted.current=true;
        if(!api?.requestAssistance){setError(locale.bubbleAssistUnavailable||'Reopen TypeR to load this feature.');setLoading(false);return undefined;}
        api.setAssisting(true);
        api.requestAssistance(raw=>{
            if(!alive)return;
            try{
                const data=JSON.parse(raw);
                if(data.error||!data.polygons?.length)throw new Error('noContour');
                setProbe(data);setPoints(data.points?.length===2?data.points:[]);setOffset(data.offset||0);setAngle(data.angle||0);
            }catch(e){setError(locale.bubbleAssistNoContour||'Select the joined bubble with the magic wand, then reopen this window.');}
            setLoading(false);
        });
        return ()=>{alive=false;mounted.current=false;api.setAssisting(false);};
    },[]);
    React.useEffect(()=>{
        setPreview(null);
        if(!probe||points.length!==2){setPending(false);return undefined;}
        setPending(true);setError('');
        const timer=setTimeout(()=>{
            try{
                const value=window.TypeRDoubleBubble.assistedSplit(probe.polygons,points[0],points[1],offset,angle);
                setPreview(value);
                if(!value)setError(locale.bubbleAssistInvalid||'Place the two markers farther apart inside the two halves, or adjust the line.');
            }catch(e){setError(locale.bubbleAssistInvalid||'Unable to form two regions. Reset the markers.');}
            setPending(false);
        },120);
        return ()=>clearTimeout(timer);
    },[probe,points,offset,angle]);
    const geometry=window.TypeRDoubleBubble,box=probe?geometry.bounds(probe.polygons):null;
    const pad=box?Math.max(box.width,box.height)*.04:0,r=box?Math.max(box.width,box.height)*.026:0;
    const mark=event=>{
        if(busy||!probe)return;
        const svg=event.currentTarget,matrix=svg.getScreenCTM();if(!matrix)return;
        const cursor=svg.createSVGPoint();cursor.x=event.clientX;cursor.y=event.clientY;
        const point=cursor.matrixTransform(matrix.inverse());
        if(!geometry.contains(geometry.outerContours(probe.polygons),point.x,point.y))return;
        setError('');setPreview(null);setPending(points.length===1);setOffset(0);setAngle(0);setPoints(points.length===2?[{x:point.x,y:point.y}]:points.concat([{x:point.x,y:point.y}]));
    };
    const apply=(index,whole=false)=>{
        if(busy||!probe||(!whole&&(!preview||points.length!==2||pending)))return;setBusy(true);setError('');
        window.TypeRDoubleBubbleBridge.applyAssistance({key:probe.key,documentID:probe.documentID,first:points[0],second:points[1],offset,angle,index,whole},result=>{
            if(!mounted.current)return;
            setBusy(false);
            if(result.changed)close();
            else setError(result.error==='selectionChanged'?(locale.bubbleAssistChanged||'The Photoshop selection changed. Close and reopen this window.'):(locale.bubbleAssistApplyError||'The selection could not be applied. Reset or reopen this window.'));
        },probe.polygons);
    };
    return <React.Fragment>
        <div className="app-modal-header hostBrdBotContrast"><div className="app-modal-title">{locale.bubbleAssistTitle||'Correct the split'}</div></div>
        <div className="app-modal-body"><div className="app-modal-body-inner bubble-assist">
            <p>{locale.bubbleAssistInstructions||'Click near the center of each half in this preview. Check the split, then choose the half to select in Photoshop.'}</p>
            {loading?<p>{locale.loading||'Loading...'}</p>:null}
            {box?<svg viewBox={`${box.left-pad} ${box.top-pad} ${box.width+2*pad} ${box.height+2*pad}`} className="bubble-assist-preview" onClick={mark} aria-label={locale.bubbleAssistPreview||'Joined bubble: mark half 1 then half 2'}>
                {probe.polygons.map((poly,i)=><polygon key={`raw${i}`} points={poly.map(p=>p.join(',')).join(' ')} className="bubble-assist-outline"/>)}
                {preview?.regions.map((region,i)=>region.polygons.map((poly,j)=><polygon key={`part${i}-${j}`} points={poly.map(p=>p.join(',')).join(' ')} className={`bubble-assist-part bubble-assist-part-${i+1}`}/>))}
                {points.map((point,i)=><g key={i}><circle cx={point.x} cy={point.y} r={r} className={`bubble-assist-marker bubble-assist-marker-${i+1}`}/><text x={point.x} y={point.y+r*.34} textAnchor="middle" fontSize={r*1.2}>{i+1}</text></g>)}
            </svg>:null}
            {points.length===2?<label className="bubble-assist-adjust">{locale.bubbleAssistAdjust||'Move the dividing line'}<input type="range" min="-40" max="40" value={Math.round(offset*100)} disabled={busy} onChange={e=>{const value=Number(e.target.value)/100;if(value!==offset){setPending(true);setPreview(null);setOffset(value);}}}/></label>:null}
            {points.length===2?<label className="bubble-assist-adjust">{locale.bubbleAssistRotate||'Tilt the dividing line'}<input type="range" min="-60" max="60" value={angle} disabled={busy} onChange={e=>{const value=Number(e.target.value);if(value!==angle){setPending(true);setPreview(null);setAngle(value);}}}/></label>:null}
            <button className="topcoat-button" disabled={busy||loading} onClick={()=>{setPreview(null);setPending(false);setPoints([]);setOffset(0);setAngle(0);setError('');}}>{locale.bubbleAssistReset||'Reset markers'}</button>
            <p className="bubble-assist-error" role="status">{error||(pending?(locale.loading||'Loading...'):'')}</p>
        </div></div>
        <div className="app-modal-footer hostBrdTopContrast bubble-assist-actions">
            <button className="topcoat-button--large" disabled={busy} onClick={close}>{locale.cancel||'Cancel'}</button>
            <button className="topcoat-button--large" disabled={busy||loading||!probe} onClick={()=>apply(0,true)}>{locale.bubbleAssistWhole||'Keep one bubble'}</button>
            {[0,1].map(i=><button key={i} className="topcoat-button--large--cta" disabled={!preview||pending||busy} onClick={()=>apply(i)}>{i===0?(locale.bubbleAssistSelect1||'Select half 1'):(locale.bubbleAssistSelect2||'Select half 2')}</button>)}
        </div>
    </React.Fragment>;
});
export default DoubleBubbleAssist;
