'use strict';
/* BakhawScan 2.1 — standalone PWA frontend. No libraries or backend bundled. */
const $ = id => document.getElementById(id);
const COLORS = {Black_spot:'#c85965', Brown_spot:'#cb8b4b', White_spot:'#5eacbe'};
const CLASSES = ['Black_spot','Brown_spot','White_spot'];
const MAX_IMAGE_SIDE = 1280;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const HISTORY_LIMIT = 12;
const HISTORY_KEY = 'bakhawscan_v2_history';
const state = {source:null, photoBlob:null, detections:[], result:null, view:'annotated', runToken:0, busy:false, toastTimeout:null};
const store = {
  get(key, fallback='') {try {return localStorage.getItem(key) ?? fallback;} catch {return fallback;}},
  set(key, val) {try {localStorage.setItem(key,val);return true;} catch {return false;}},
  remove(key) {try {localStorage.removeItem(key);return true;} catch {return false;}}
};
function safeHistory(){
  try {
    const saved=JSON.parse(store.get(HISTORY_KEY,'[]'));
    return Array.isArray(saved) ? saved.filter(r=>r&&typeof r==='object'&&typeof r.image==='string'&&Array.isArray(r.detections)).slice(0,HISTORY_LIMIT) : [];
  }catch{return [];}
}
const pretty = name => ({Black_spot:'Black spots',Brown_spot:'Brown spots',White_spot:'White spots'})[name] || String(name||'Spot').replace(/_/g,' ');
const shortPretty = name => pretty(name).replace(/ spots$/,' spot');
const normalizedName = str => {
  const name=String(str??'').toLowerCase().replace(/[^a-z]/g,'');
  if (name==='blackspot'||name==='blackspots') return 'Black_spot';
  if (name==='brownspot'||name==='brownspots') return 'Brown_spot';
  if (name==='whitespot'||name==='whitespots') return 'White_spot';
  return null;
};
const el = (tag,cls,content) => {const e=document.createElement(tag); if(cls)e.className=cls;if(content!==undefined)e.textContent=content;return e;};
function icon(name){const s=document.createElementNS('http://www.w3.org/2000/svg','svg');const use=document.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href','#i-'+name);s.append(use);return s;}
function dateText(iso, includeTime=false){
  const d=new Date(iso);if(Number.isNaN(d.getTime()))return 'Unknown date';
  return new Intl.DateTimeFormat('en-PH',includeTime ? {year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'} : {year:'numeric',month:'short',day:'numeric'}).format(d);
}
function toast(text,error=false){
  const t=$('toast');t.textContent=text;t.className='toast'+(error?' error':'');t.hidden=false;
  clearTimeout(state.toastTimeout);state.toastTimeout=setTimeout(()=>{t.hidden=true;},4500);
}
function navigate(page){
  if (!$('page-'+page))page='overview';
  if(page!=='scanner' && (live.active||live.cameraStarting))stopLiveCamera();
  document.querySelectorAll('.page').forEach(e=>e.classList.toggle('active',e.id==='page-'+page));
  document.querySelectorAll('[data-go]').forEach(btn=>{
    if(!btn.classList.contains('nav-link')&&!btn.closest('.mobile-nav'))return;
    const active=btn.dataset.go===page;btn.classList.toggle('active',active);
    if(active)btn.setAttribute('aria-current','page');else btn.removeAttribute('aria-current');
  });
  const names={overview:'Overview',scanner:'Leaf scanner',results:'Scan results',history:'Scan history',learn:'Learn & explore',settings:'Settings'};
  $('crumb').textContent=names[page];document.title='BakhawScan · '+names[page];
  if(page==='overview')renderOverview();
  if(page==='history')renderHistory();
  if(page==='results')renderResults();
  window.scrollTo({top:0,behavior:'instant'});
}
document.addEventListener('click',e=>{
  const target=e.target.closest('[data-go]');if(!target)return;
  navigate(target.dataset.go);
});
function updateConnectivity(){const online=navigator.onLine;$('connectivity').classList.toggle('offline',!online);$('connectivityText').textContent=online?'Online':'Offline';}
window.addEventListener('online',updateConnectivity);window.addEventListener('offline',updateConnectivity);

/* ---------- photo intake ---------- */
async function fileToBitmap(file){
  if('createImageBitmap' in window){
    try{return await createImageBitmap(file,{imageOrientation:'from-image'});}catch{}
    try{return await createImageBitmap(file);}catch{}
  }
  return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(file);const img=new Image();
    img.onload=()=>{URL.revokeObjectURL(url);resolve(img);};
    img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Unsupported image format'));};
    img.src=url;
  });
}
function canvasToBlob(canvas,type='image/jpeg',quality=.88){return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Unable to prepare image')) ,type,quality));}
function setScanStatus(message,error=false){$('scanStatus').textContent=message;$('scanStatus').classList.toggle('error',error);}
async function loadPhoto(file){
  if(!file)return;
  if(state.busy){toast('Finish the current scan before changing photos.',true);return;}
  if(file.size>MAX_FILE_BYTES){setScanStatus('Image exceeds the 15 MB limit. Choose a smaller file.',true);return;}
  if(file.type&&!file.type.startsWith('image/')){setScanStatus('Please select an image file.',true);return;}
  const token=++state.runToken;
  setScanStatus('Preparing image…');
  try{
    const image=await fileToBitmap(file);
    if(!image.width||!image.height)throw Error('Empty image');
    const scale=Math.min(1,MAX_IMAGE_SIDE/Math.max(image.width,image.height));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
    canvas.getContext('2d',{alpha:false}).drawImage(image,0,0,canvas.width,canvas.height);
    if('close' in image)image.close();
    const blob=await canvasToBlob(canvas);
    if(token!==state.runToken)return;
    state.source=canvas;state.photoBlob=blob;state.result=null;state.detections=[];state.view='annotated';
    const cv=$('scanCanvas');cv.width=canvas.width;cv.height=canvas.height;cv.getContext('2d').drawImage(canvas,0,0);
    cv.hidden=false;$('scanEmpty').hidden=true;$('dropzone').classList.add('has-image');
    $('imageState').textContent='Ready to analyze';$('analyzeBtn').disabled=false;
    setScanStatus('Photo ready. Select Analyze leaf.');
    navigate('scanner');
  }catch(e){setScanStatus('This image could not be opened. Try JPG, PNG, or WebP.',true);toast('Image could not be opened.',true);}
}
$('cameraBtn').addEventListener('click',()=>$('cameraInput').click());
$('chooseBtn').addEventListener('click',()=>$('fileInput').click());
$('cameraInput').addEventListener('change',e=>{const f=e.target.files?.[0];e.target.value='';loadPhoto(f);});
$('fileInput').addEventListener('change',e=>{const f=e.target.files?.[0];e.target.value='';loadPhoto(f);});
$('dropzone').addEventListener('click',()=>$('fileInput').click());
$('dropzone').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('fileInput').click();}});
for(const eventName of ['dragover','dragenter','dragleave','drop']){
  $('dropzone').addEventListener(eventName,e=>{e.preventDefault();e.stopPropagation();if(eventName==='dragover'||eventName==='dragenter')$('dropzone').classList.add('dragging');else $('dropzone').classList.remove('dragging');if(eventName==='drop')loadPhoto(e.dataTransfer?.files?.[0]);});
}
window.addEventListener('dragover',e=>e.preventDefault());
window.addEventListener('drop',e=>{if(!e.target.closest('#dropzone'))e.preventDefault();});

/* ---------- detection ---------- */
function mockDetect(w,h){
  return new Promise(resolve=>setTimeout(()=>{
    const out=[];const count=5+Math.floor(Math.random()*8);
    for(let i=0;i<count;i++){
      const bw=w*(.025+Math.random()*.065),bh=h*(.027+Math.random()*.06);
      const x=Math.random()*(w-bw),y=Math.random()*(h-bh);
      out.push({class_name:CLASSES[Math.floor(Math.random()*CLASSES.length)],confidence:Math.round((.25+Math.random()*.72)*100)/100,box:[x,y,x+bw,y+bh]});
    }
    resolve({image_width:w,image_height:h,detections:out});
  },750));
}
async function fetchPrediction(blob, externalSignal, timeoutMs=45000){
  const base=$('apiUrl').value.trim().replace(/\/+$/,'');
  if(!/^https?:\/\//i.test(base))throw Error('Set a valid http(s) API address in Settings.');
  if(location.protocol==='https:'&&base.startsWith('http:')&&!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(base))throw Error('The HTTPS app needs an HTTPS API. Update the address in Settings.');
  const data=new FormData();data.append('file',blob,'leaf.jpg');
  const controller=new AbortController();
  const abort=()=>controller.abort();externalSignal?.addEventListener('abort',abort,{once:true});
  if(externalSignal?.aborted)controller.abort();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    let response;
    try{response=await fetch(base+'/predict',{method:'POST',body:data,signal:controller.signal,cache:'no-store'});}
    catch(e){if(e.name==='AbortError')throw Error(externalSignal?.aborted?'Scan cancelled.':'Request timed out. Check the API server.');throw Error('Could not reach the API. Verify the URL, CORS settings, and server availability.');}
    if(!response.ok)throw Error('API request failed (HTTP '+response.status+').');
    try{return await response.json();}catch{throw Error('The API did not return valid JSON.');}
  }finally{clearTimeout(timer);externalSignal?.removeEventListener('abort',abort);}
}
async function apiDetect(){return fetchPrediction(state.photoBlob);}
function parseDetections(response,sourceWidth=state.source?.width,sourceHeight=state.source?.height){
  if(!response||!Array.isArray(response.detections))throw Error('Unexpected API response: expected a detections array.');
  const rw=Number(response.image_width)||sourceWidth,rh=Number(response.image_height)||sourceHeight;
  if(rw<=0||rh<=0)throw Error('Invalid image dimensions returned by API.');
  let unsupported=0, malformed=0;
  const results=[];
  for(const d of response.detections){
    const name=normalizedName(d?.class_name);
    if(!name){unsupported++;continue;}
    const confidence=Number(d.confidence),box=d.box;
    if(!Number.isFinite(confidence)||confidence<0||confidence>1||!Array.isArray(box)||box.length!==4||!box.every(v=>Number.isFinite(Number(v)))){malformed++;continue;}
    const sx=sourceWidth/rw,sy=sourceHeight/rh;
    const x1=Math.max(0,Math.min(sourceWidth,Number(box[0])*sx)),y1=Math.max(0,Math.min(sourceHeight,Number(box[1])*sy));
    const x2=Math.max(0,Math.min(sourceWidth,Number(box[2])*sx)),y2=Math.max(0,Math.min(sourceHeight,Number(box[3])*sy));
    if(x2<=x1||y2<=y1){malformed++;continue;}
    results.push({class_name:name,confidence,box:[x1,y1,x2,y2]});
  }
  return {results,unsupported,malformed};
}
async function analyze(){
  if(!state.photoBlob||state.busy)return;
  const token=state.runToken;state.busy=true;
  $('analyzeBtn').disabled=true;$('analyzeBtn').querySelector('span').textContent='Analyzing…';
  const mode=$('scanMode').value;
  setScanStatus(mode==='demo'?'Generating simulated demo detections…':'Running model inference…');
  try{
    const response=mode==='demo'?await mockDetect(state.source.width,state.source.height):await apiDetect();
    if(token!==state.runToken)return;
    const {results,unsupported,malformed}=parseDetections(response);
    state.detections=results;
    state.result={id:(crypto.randomUUID?.()||String(Date.now())+'-'+Math.random().toString(16).slice(2)),timestamp:new Date().toISOString(),mode,detections:results};
    const stored=saveCurrentScan();
    const warnings=(unsupported||malformed)?` ${unsupported+malformed} unsupported or invalid prediction(s) omitted.`:'';
    setScanStatus('Scan complete.'+warnings);
    if(!stored)toast('Scan completed, but could not be saved locally. You can still export your results.',true);
    navigate('results');
  }catch(error){setScanStatus(error.message||'Detection failed.',true);toast(error.message||'Detection failed.',true);}
  finally{state.busy=false;$('analyzeBtn').disabled=!state.photoBlob;$('analyzeBtn').querySelector('span').textContent='Analyze leaf';}
}
$('analyzeBtn').addEventListener('click',analyze);

/* ---------- drawing + results ---------- */
function shownDetections(){return state.detections.filter(d=>d.confidence >= +$('confidence').value/100);}
function drawResult(){
  if(!state.source)return;
  const c=$('resultCanvas'),src=state.source; c.width=src.width;c.height=src.height;
  const ctx=c.getContext('2d');ctx.drawImage(src,0,0);
  if(state.view==='original')return;
  const fs=Math.max(11,Math.round(c.width/62));ctx.font=`700 ${fs}px system-ui, sans-serif`;ctx.textBaseline='top';
  const strokeWidth=Math.max(2,c.width/420);ctx.lineWidth=strokeWidth;
  for(const d of shownDetections()){
    const [x1,y1,x2,y2]=d.box,col=COLORS[d.class_name];
    ctx.strokeStyle=col;ctx.strokeRect(x1,y1,x2-x1,y2-y1);
    if(!$('showLabels').checked)continue;
    const text=shortPretty(d.class_name)+' '+Math.round(d.confidence*100)+'%';
    const width=Math.min(c.width,ctx.measureText(text).width+12),height=fs+9;
    const lx=Math.max(0,Math.min(x1,c.width-width)),ly=y1-height>=0?y1-height:Math.min(y1,c.height-height);
    ctx.fillStyle=col;ctx.fillRect(lx,ly,width,height);
    ctx.fillStyle='#18251f';ctx.fillText(text,lx+6,ly+4);
  }
}
function boundingBoxCoverage(boxes,w,h){
  if(!boxes.length||w<=0||h<=0)return 0;
  // Grid union prevents double-counting overlaps. This is image area, NOT lesion/leaf segmentation.
  const cols=160,rows=Math.max(32,Math.round(cols*h/w));
  let covered=0;
  for(let y=0;y<rows;y++){
    const cy=(y+.5)*h/rows;
    for(let x=0;x<cols;x++){
      const cx=(x+.5)*w/cols;
      if(boxes.some(b=>cx>=b[0]&&cx<=b[2]&&cy>=b[1]&&cy<=b[3]))covered++;
    }
  }
  return 100*covered/(cols*rows);
}
function severityInfo(shown){
  if(!state.source)return {coverage:0,level:'Not assessed'};
  if(!shown.length)return {coverage:0,level:'No spots above threshold'};
  const coverage=boundingBoxCoverage(shown.map(d=>d.box),state.source.width,state.source.height);
  const level=coverage<3?'Low':coverage<10?'Moderate':'High';
  return {coverage,level:level+' (experimental proxy)'};
}
function renderResults(){
  const active=!!state.result;
  $('resultsEmpty').hidden=active;$('resultsContent').hidden=!active;
  if(!active)return;
  const list=shownDetections(),total=list.length;
  $('resultsDemoNotice').hidden=state.result.mode!=='demo';
  $('resultSourceBadge').textContent=state.result.mode==='demo'?'Simulated demo':'FastAPI model';
  $('resultTimestamp').textContent=dateText(state.result.timestamp,true);
  $('resultCount').textContent=total;
  $('resultThreshold').textContent='At ≥ '+$('confidence').value+'% confidence';
  $('resultImageCaption').textContent=state.view==='original'?'Original leaf photo':'Bounding boxes for visible detections';
  $('viewAnnotated').classList.toggle('selected',state.view==='annotated');$('viewOriginal').classList.toggle('selected',state.view==='original');
  $('viewAnnotated').setAttribute('aria-pressed',String(state.view==='annotated'));$('viewOriginal').setAttribute('aria-pressed',String(state.view==='original'));
  drawResult();
  const breakdown=$('classBreakdown');breakdown.replaceChildren();
  for(const type of CLASSES){
    const n=list.filter(d=>d.class_name===type).length;
    const row=el('div');const top=el('div','break-row');const title=el('span','break-title');
    const dot=el('i','color-dot '+({Black_spot:'black',Brown_spot:'brown',White_spot:'white'}[type]));
    title.append(dot,document.createTextNode(pretty(type)));top.append(title,el('strong','',String(n)));row.append(top);
    const rail=el('div','break-bar');const fill=el('span');fill.style.width=(total?100*n/total:0)+'%';fill.style.background=COLORS[type];rail.append(fill);row.append(rail);breakdown.append(row);
  }
  const sev=severityInfo(list);
  $('severityLabel').textContent=sev.level;
  $('severityFill').style.width=Math.min(100,sev.coverage*5)+'%';
  $('severityText').textContent=total?`Approximately ${sev.coverage.toFixed(1)}% of the whole photo is inside detection boxes at the current confidence threshold. Illustrative bands: low below 3%, moderate 3–<10%, high at least 10%.`:'No qualifying detection boxes at the current threshold. This does not prove the leaf is healthy.';
  const foundTypes=new Set(list.map(d=>d.class_name));
  const interpretations=[];
  if(foundTypes.has('Black_spot'))interpretations.push('Dark marks can resemble necrotic leaf tissue, but their cause cannot be determined from a photo.');
  if(foundTypes.has('Brown_spot'))interpretations.push('Brown patches may resemble leaf-spot symptoms or stress-related discoloration.');
  if(foundTypes.has('White_spot'))interpretations.push('Pale marks may reflect discoloration or surface material; closer inspection is needed.');
  $('possibleCondition').textContent=interpretations.length?interpretations.join(' '):'No supported spot classes meet the current threshold. This does not confirm the leaf is healthy.';
  $('detailCount').textContent=total+' '+(total===1?'spot':'spots');
  const target=$('detectionList');target.replaceChildren();
  if(!total){target.append(el('div','detection-empty','No matching spots at this confidence. Try lowering the threshold.'));}
  else for(const d of [...list].sort((a,b)=>b.confidence-a.confidence)){
    const row=el('div','detection-row'),name=el('div','detection-name');
    name.append(el('i','color-dot '+({Black_spot:'black',Brown_spot:'brown',White_spot:'white'}[d.class_name])),document.createTextNode(shortPretty(d.class_name)));
    row.append(name,el('strong','',Math.round(d.confidence*100)+'% confidence'));target.append(row);
  }
}
$('viewOriginal').addEventListener('click',()=>{state.view='original';renderResults();});
$('viewAnnotated').addEventListener('click',()=>{state.view='annotated';renderResults();});
$('confidence').addEventListener('input',()=>{$('confidenceValue').textContent=$('confidence').value+'%';$('liveConfidence').value=$('confidence').value;$('liveConfidenceValue').textContent=$('confidence').value+'%';store.set('bk_conf',$('confidence').value);if(state.result)renderResults();if(live.active)renderLiveOverlay();});
$('showLabels').addEventListener('change',()=>{$('liveLabels').checked=$('showLabels').checked;store.set('bk_labels',String($('showLabels').checked));if(state.result)renderResults();if(live.active)renderLiveOverlay();});

/* ---------- download + persisted scans ---------- */
function downloadBlob(blob,filename){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function filenameStamp(){return (state.result?.timestamp||new Date().toISOString()).replace(/[:.]/g,'-');}
$('downloadImageBtn').addEventListener('click',async()=>{
  if(!state.result)return;
  try{
    const before=state.view;state.view='annotated';drawResult();
    const blob=await canvasToBlob($('resultCanvas'),'image/png');
    state.view=before;renderResults();downloadBlob(blob,'bakhawscan-'+filenameStamp()+'.png');
  }catch(e){renderResults();toast('Could not export the annotated image.',true);}
});
$('downloadReportBtn').addEventListener('click',()=>{
  if(!state.result)return;
  const shown=shownDetections(),sev=severityInfo(shown);
  const report={app:'BakhawScan',version:'2.0',mode:state.result.mode,simulated:state.result.mode==='demo',timestamp:state.result.timestamp,confidence_threshold:Number($('confidence').value)/100,image_width:state.source.width,image_height:state.source.height,visible_count:shown.length,detections:shown.map(d=>({class_name:d.class_name,confidence:d.confidence,box:d.box.map(x=>Math.round(x*100)/100)})),experimental_photo_box_coverage_percent:Number(sev.coverage.toFixed(2)),experimental_spotting_band:sev.level,notes:'Not a confirmed diagnosis. Bounding box coverage is a crude, unvalidated photo-area proxy and is not measured damaged leaf area.'};
  const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'});
  downloadBlob(blob,'bakhawscan-report-'+filenameStamp()+'.json');
});
function saveCurrentScan(){
  if(!state.result||!state.source)return false;
  const src=state.source,scale=Math.min(1,780/Math.max(src.width,src.height));
  const preview=document.createElement('canvas');preview.width=Math.round(src.width*scale);preview.height=Math.round(src.height*scale);
  preview.getContext('2d').drawImage(src,0,0,preview.width,preview.height);
  const image=preview.toDataURL('image/jpeg',.68);
  const record={id:state.result.id,timestamp:state.result.timestamp,mode:state.result.mode,image,width:preview.width,height:preview.height,detections:state.detections.map(d=>({class_name:d.class_name,confidence:d.confidence,box:d.box.map((v,i)=>v*(i%2===0?preview.width/src.width:preview.height/src.height))}))};
  const previous=safeHistory().filter(r=>r.id!==record.id);
  const records=[record,...previous].slice(0,HISTORY_LIMIT);
  // Older browser storage can be small; gradually evict older records on quota errors.
  for(let count=records.length;count>=1;count--){if(store.set(HISTORY_KEY,JSON.stringify(records.slice(0,count))))return true;}
  return false;
}
async function openSavedScan(id){
  const r=safeHistory().find(item=>item.id===id);if(!r)return toast('Saved scan not found.',true);
  try{
    const blob=await(await fetch(r.image)).blob(),img=await fileToBitmap(blob);
    const c=document.createElement('canvas');c.width=img.width;c.height=img.height;c.getContext('2d').drawImage(img,0,0);
    if('close' in img)img.close();
    state.runToken++;state.source=c;state.photoBlob=await canvasToBlob(c);
    const xScale=c.width/(Number(r.width)||c.width),yScale=c.height/(Number(r.height)||c.height);
    state.detections=r.detections.map(d=>({class_name:normalizedName(d.class_name),confidence:Number(d.confidence),box:Array.isArray(d.box)?d.box.map((v,i)=>v*(i%2===0?xScale:yScale)):[]})).filter(d=>d.class_name&&Number.isFinite(d.confidence)&&d.box.length===4&&d.box.every(Number.isFinite));
    state.result={id:r.id,timestamp:r.timestamp,mode:r.mode,detections:state.detections};state.view='annotated';
    const cv=$('scanCanvas');cv.width=c.width;cv.height=c.height;cv.getContext('2d').drawImage(c,0,0);
    cv.hidden=false;$('scanEmpty').hidden=true;$('dropzone').classList.add('has-image');$('imageState').textContent='Saved image';$('analyzeBtn').disabled=false;setScanStatus('Saved scan loaded. You can analyze it again.');
    navigate('results');
  }catch{toast('This saved image could not be opened.',true);}
}
function deleteScan(id){const items=safeHistory();if(!items.some(r=>r.id===id))return;const filtered=items.filter(r=>r.id!==id);if(!store.set(HISTORY_KEY,JSON.stringify(filtered)))return toast('Could not update browser storage.',true);renderHistory();renderOverview();toast('Saved scan deleted.');}
function clearHistory(){const items=safeHistory();if(!items.length)return toast('There are no saved scans.');if(!window.confirm('Delete all saved scans from this device? This cannot be undone.'))return;store.remove(HISTORY_KEY);renderHistory();renderOverview();toast('All saved scans deleted.');}
$('clearHistoryBtn').addEventListener('click',clearHistory);$('settingsClearBtn').addEventListener('click',clearHistory);
function renderOverview(){
  const h=safeHistory(),model=h.filter(r=>r.mode==='api');
  $('stat-scans').textContent=h.length;$('stat-model').textContent=model.length;
  $('stat-spots').textContent=model.reduce((acc,r)=>acc+r.detections.filter(d=>CLASSES.includes(normalizedName(d.class_name))).length,0);
  const recent=$('recentList');recent.replaceChildren();
  if(!h.length){const empty=el('div','empty-small');empty.append(icon('leaf'),document.createTextNode('No scans yet. Your recent observations will appear here.'));recent.append(empty);return;}
  for(const r of h.slice(0,3)){
    const button=el('button','recent-item');button.type='button';button.addEventListener('click',()=>openSavedScan(r.id));
    const img=el('img','recent-thumb');img.src=r.image;img.alt='Saved mangrove leaf thumbnail';
    const label=el('span','recent-name');label.append(el('strong','',dateText(r.timestamp)),el('small','',r.detections.length+' total detection'+(r.detections.length===1?'':'s')));
    const mode=el('span','mini-mode'+(r.mode==='demo'?' demo':''),r.mode==='demo'?'Demo':'Model');
    button.append(img,label,mode,icon('chevron'));recent.append(button);
  }
}
function renderHistory(){
  const h=safeHistory(),grid=$('historyGrid');grid.replaceChildren();$('historyCount').textContent=h.length+' saved '+(h.length===1?'scan':'scans');
  $('clearHistoryBtn').disabled=h.length===0;
  if(!h.length){
    const box=el('article','surface history-empty');const mark=el('div','empty-page-icon');mark.append(icon('clock'));
    box.append(mark,el('h2','','No scans saved yet'),el('p','','Completed scans will appear here on this device.'));
    const button=el('button','btn btn-primary','Start scanning');button.addEventListener('click',()=>navigate('scanner'));box.append(button);grid.append(box);return;
  }
  for(const r of h){
    const card=el('article','surface history-card');const img=el('img');img.src=r.image;img.alt='Saved mangrove leaf photograph';img.loading='lazy';
    const body=el('div','history-card-body'),meta=el('div','history-card-meta');
    meta.append(el('span','',dateText(r.timestamp,true)),el('span','soft-badge',r.mode==='demo'?'Demo':'Model'));
    body.append(meta,el('h3','','Mangrove leaf observation'),el('p','',r.detections.length+' recorded detection'+(r.detections.length===1?'':'s')));
    const actions=el('div','history-actions'),view=el('button','btn btn-primary','View results'),del=el('button','btn btn-outline');
    view.addEventListener('click',()=>openSavedScan(r.id));del.setAttribute('aria-label','Delete scan from '+dateText(r.timestamp));del.append(icon('trash'));
    del.addEventListener('click',()=>{if(window.confirm('Delete this saved scan?'))deleteScan(r.id);});
    actions.append(view,del);body.append(actions);card.append(img,body);grid.append(card);
  }
}

/* ---------- live camera (periodic server inference) ---------- */
const live = {
  stream:null, active:false, paused:false, session:0, timer:null, controller:null,
  facing:'environment', latestFrame:null, latestBlob:null, latestDetections:[],
  lastFrameSize:null, lastShownAt:0, cameraStarting:false
};
function switchScanMethod(which){
  if(which!=='live')which='upload';
  if(which==='upload' && (live.active||live.cameraStarting))stopLiveCamera();
  $('uploadScanPanel').hidden=which!=='upload';
  $('liveScanPanel').hidden=which!=='live';
  for(const [id,selected] of [['uploadModeTab',which==='upload'],['liveModeTab',which==='live']]){
    $(id).classList.toggle('active',selected);$(id).setAttribute('aria-pressed',String(selected));
  }
  if(which==='live')updateLiveSource();
}
$('uploadModeTab').addEventListener('click',()=>switchScanMethod('upload'));
$('liveModeTab').addEventListener('click',()=>switchScanMethod('live'));
function liveStatus(message,kind='idle'){
  $('liveStatus').textContent=message;
  $('liveIndicator').textContent=kind==='running'?'SCANNING':kind==='preview'?'LIVE PREVIEW':kind==='paused'?'PAUSED':kind==='error'?'CAMERA ERROR':'CAMERA OFF';
  $('liveIndicator').className='live-indicator '+kind;
  $('livePulse').className='live-pulse '+kind;
}
function validApiBase(){
  const base=$('apiUrl').value.trim().replace(/\/+$/,'');
  if(!/^https?:\/\//i.test(base))return null;
  if(location.protocol==='https:'&&base.startsWith('http:')&&!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(base))return null;
  return base;
}
function updateLiveSource(){
  const api=$('scanMode').value==='api';
  const valid=!!validApiBase();
  $('liveSourceTitle').textContent=api?(valid?'FastAPI model selected':'API URL missing or invalid'):'Demo mode — camera preview only';
  $('liveOverlayTag').textContent=api&&valid?'MODEL · PERIODIC SCAN':'CAMERA PREVIEW · NO MODEL';
  $('liveSourceMessage').textContent=api?(valid?'The camera sends one image per scan cycle to /predict. Responses draw boxes over the live view.':'Enter a reachable HTTPS/localhost FastAPI URL in Settings to enable live detection.'):'Demo cannot detect real spots. The camera will show a preview without simulated boxes. Choose My FastAPI model in Settings.';
  if(!live.active)return;
  live.session++;clearTimeout(live.timer);live.controller?.abort();live.controller=null;
  clearLiveOverlay();live.latestFrame=null;live.latestBlob=null;live.latestDetections=[];$('liveSaveBtn').disabled=true;$('liveCounter').hidden=true;
  if(api&&valid&&!live.paused){liveStatus('Scanning frames with the model…','running');queueLiveScan(120);}
  else if(api&&!valid){live.paused=true;liveStatus('Add a valid API URL in Settings. Camera preview remains open.','paused');}
  else{liveStatus('Camera preview only. Select the FastAPI model in Settings for detection boxes.','preview');}
  updateLiveButtons();
}
function updateLiveButtons(){
  const can=live.active;
  $('liveStartBtn').disabled=live.cameraStarting||can;
  $('liveStartBtn').querySelector('span').textContent=live.cameraStarting?'Opening camera…':'Start camera';
  $('livePauseBtn').disabled=!can||$('scanMode').value!=='api'||!validApiBase();
  $('livePauseBtn').textContent=live.paused?'Resume scanning':'Pause scanning';
  $('liveFlipBtn').disabled=!can;
  $('liveStopBtn').disabled=!can;
  $('liveCaptureBtn').disabled=!can;
  $('liveSaveBtn').disabled=!can||!live.latestFrame;
}
function clearLiveOverlay(){const cv=$('liveOverlay');cv.getContext('2d').clearRect(0,0,cv.width,cv.height);}
function renderLiveOverlay(){
  const video=$('liveVideo'),cv=$('liveOverlay');
  if(!live.active||!video.videoWidth||!video.videoHeight)return;
  const rect=video.getBoundingClientRect();if(!rect.width||!rect.height)return;
  const dpr=Math.min(window.devicePixelRatio||1,2);
  const width=Math.max(1,Math.round(rect.width*dpr)),height=Math.max(1,Math.round(rect.height*dpr));
  if(cv.width!==width||cv.height!==height){cv.width=width;cv.height=height;}
  const ctx=cv.getContext('2d');ctx.clearRect(0,0,width,height);
  if($('scanMode').value!=='api'||!live.latestFrame)return;
  // video uses object-fit:contain. Account for letterboxing and device pixel ratio.
  const scale=Math.min(width/video.videoWidth,height/video.videoHeight);
  const ox=(width-video.videoWidth*scale)/2,oy=(height-video.videoHeight*scale)/2;
  const sx=video.videoWidth/live.latestFrame.width,sy=video.videoHeight/live.latestFrame.height;
  const shown=live.latestDetections.filter(d=>d.confidence>=Number($('confidence').value)/100);
  const fontSize=Math.max(11,Math.min(19,width/34));ctx.font=`700 ${fontSize}px system-ui, sans-serif`;ctx.textBaseline='top';ctx.lineWidth=Math.max(2,width/300);
  for(const d of shown){
    const [x1,y1,x2,y2]=d.box,col=COLORS[d.class_name];
    const x=ox+x1*sx*scale,y=oy+y1*sy*scale,w=(x2-x1)*sx*scale,h=(y2-y1)*sy*scale;
    ctx.strokeStyle=col;ctx.strokeRect(x,y,w,h);
    if(!$('showLabels').checked)continue;
    const text=shortPretty(d.class_name)+' '+Math.round(d.confidence*100)+'%';
    const tw=Math.min(width,ctx.measureText(text).width+12),th=fontSize+9;
    const lx=Math.max(0,Math.min(x,width-tw)),ly=y>th?y-th:Math.min(y,height-th);
    ctx.fillStyle=col;ctx.fillRect(lx,ly,tw,th);ctx.fillStyle='#17271d';ctx.fillText(text,lx+6,ly+4);
  }
  $('liveSpotCount').textContent=String(shown.length);
}
window.addEventListener('resize',()=>{if(live.active)renderLiveOverlay();});
function queueLiveScan(delay=900){
  clearTimeout(live.timer);
  const session=live.session;
  live.timer=setTimeout(()=>{if(session===live.session)void runLiveScan(session);},delay);
}
async function startLiveCamera(){
  if(live.active||live.cameraStarting)return;
  if(!navigator.mediaDevices?.getUserMedia){liveStatus('Live camera needs HTTPS or localhost and a browser that supports camera access.','error');return;}
  live.cameraStarting=true;updateLiveButtons();liveStatus('Requesting camera permission…','preview');
  const session=++live.session;
  let stream;
  try{
    try{stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:live.facing},width:{ideal:1280},height:{ideal:720}}});}
    catch(e){if(e.name==='OverconstrainedError')stream=await navigator.mediaDevices.getUserMedia({audio:false,video:true});else throw e;}
    if(session!==live.session){stream.getTracks().forEach(t=>t.stop());return;}
    const video=$('liveVideo');live.stream=stream;video.srcObject=stream;await video.play();
    if(session!==live.session){stream.getTracks().forEach(t=>t.stop());return;}
    live.active=true;live.paused=false;
    $('cameraPlaceholder').hidden=true;video.hidden=false;$('liveOverlay').hidden=false;$('liveOverlayTag').hidden=false;
    stream.getVideoTracks().forEach(track=>track.addEventListener('ended',()=>{if(live.active)stopLiveCamera('Camera disconnected.');},{once:true}));
    updateLiveSource();
  }catch(e){
    stream?.getTracks().forEach(t=>t.stop());
    if(session!==live.session)return;
    const msg=e.name==='NotAllowedError'||e.name==='PermissionDeniedError'?'Camera permission was denied. Allow it in browser site settings.':e.name==='NotFoundError'?'No camera was found on this device.':e.name==='NotReadableError'?'The camera is in use by another application.':'Camera could not open. Try HTTPS, localhost, or another browser.';
    liveStatus(msg,'error');toast(msg,true);
  }finally{live.cameraStarting=false;updateLiveButtons();}
}
function stopLiveCamera(message='Camera stopped. Frames are no longer being sent.'){
  live.session++;clearTimeout(live.timer);live.timer=null;live.controller?.abort();live.controller=null;
  live.stream?.getTracks().forEach(t=>t.stop());live.stream=null;live.active=false;live.paused=false;live.latestFrame=null;live.latestBlob=null;live.latestDetections=[];
  const video=$('liveVideo');video.pause();video.srcObject=null;video.hidden=true;
  $('liveOverlay').hidden=true;$('liveOverlayTag').hidden=true;$('cameraPlaceholder').hidden=false;$('liveCounter').hidden=true;
  clearLiveOverlay();liveStatus(message);updateLiveButtons();
}
async function runLiveScan(session){
  if(!live.active||live.paused||session!==live.session||document.hidden||$('scanMode').value!=='api')return;
  const video=$('liveVideo');if(!video.videoWidth||!video.videoHeight){queueLiveScan(300);return;}
  const base=validApiBase();if(!base){live.paused=true;liveStatus('Configure a valid FastAPI URL to start scanning.','paused');updateLiveButtons();return;}
  const scale=Math.min(1,960/Math.max(video.videoWidth,video.videoHeight));
  const frame=document.createElement('canvas');frame.width=Math.max(1,Math.round(video.videoWidth*scale));frame.height=Math.max(1,Math.round(video.videoHeight*scale));
  frame.getContext('2d',{alpha:false}).drawImage(video,0,0,frame.width,frame.height);
  const controller=new AbortController();live.controller=controller;
  try{
    const blob=await canvasToBlob(frame,'image/jpeg',.75);
    if(session!==live.session)return;
    const response=await fetchPrediction(blob,controller.signal,22000);
    if(session!==live.session)return;
    const {results,unsupported,malformed}=parseDetections(response,frame.width,frame.height);
    live.latestFrame=frame;live.latestBlob=blob;live.latestDetections=results;live.lastShownAt=Date.now();
    $('liveCounter').hidden=false;$('liveUpdated').textContent='· updated just now';
    $('liveSaveBtn').disabled=false;
    renderLiveOverlay();
    liveStatus('Live model detections are updating. Hold the leaf steady.','running');
    if(unsupported||malformed)$('liveStatus').textContent+=` ${unsupported+malformed} invalid/unsupported boxes omitted.`;
  }catch(e){
    if(session!==live.session||e.name==='AbortError')return;
    live.paused=true;clearLiveOverlay();live.latestFrame=null;live.latestBlob=null;live.latestDetections=[];
    $('liveSaveBtn').disabled=true;$('liveCounter').hidden=true;
    liveStatus((e.message||'Could not reach the model.')+' Scanning paused.','error');
    toast('Live scanning paused: '+(e.message||'API error'),true);updateLiveButtons();return;
  }finally{
    if(live.controller===controller)live.controller=null;
    if(session===live.session&&live.active&&!live.paused&&!document.hidden)queueLiveScan(750);
  }
}
$('liveStartBtn').addEventListener('click',startLiveCamera);
$('liveStopBtn').addEventListener('click',()=>stopLiveCamera());
$('livePauseBtn').addEventListener('click',()=>{
  if(!live.active)return;
  live.paused=!live.paused;
  live.session++;clearTimeout(live.timer);live.controller?.abort();live.controller=null;
  if(live.paused){clearLiveOverlay();$('liveOverlayTag').textContent='SCANNING PAUSED';liveStatus('Scanning paused. Camera preview is still active.','paused');}
  else if(validApiBase()&&$('scanMode').value==='api'){$('liveOverlayTag').textContent='MODEL · PERIODIC SCAN';liveStatus('Resuming model scanning…','running');queueLiveScan(0);}
  else{live.paused=true;clearLiveOverlay();liveStatus('Select a valid model API first.','paused');}
  updateLiveButtons();
});
$('liveFlipBtn').addEventListener('click',()=>{
  if(!live.active)return;
  live.facing=live.facing==='environment'?'user':'environment';
  stopLiveCamera('Switching cameras…');void startLiveCamera();
});
$('liveCaptureBtn').addEventListener('click',async()=>{
  if(!live.active)return;
  const v=$('liveVideo');if(!v.videoWidth)return;
  const scale=Math.min(1,MAX_IMAGE_SIDE/Math.max(v.videoWidth,v.videoHeight));
  const c=document.createElement('canvas');c.width=Math.round(v.videoWidth*scale);c.height=Math.round(v.videoHeight*scale);
  c.getContext('2d').drawImage(v,0,0,c.width,c.height);
  const blob=await canvasToBlob(c);stopLiveCamera();switchScanMethod('upload');
  await loadPhoto(new File([blob],'camera-frame.jpg',{type:'image/jpeg'}));
  setScanStatus('Camera frame captured. Select Analyze leaf to run a fresh detection.');
});
$('liveSaveBtn').addEventListener('click',async()=>{
  if(!live.active||!live.latestFrame||!live.latestBlob)return;
  const frame=live.latestFrame,blob=live.latestBlob,detections=live.latestDetections;
  stopLiveCamera();switchScanMethod('upload');
  state.runToken++;state.source=frame;state.photoBlob=blob;state.detections=detections;state.view='annotated';
  state.result={id:(crypto.randomUUID?.()||String(Date.now())),timestamp:new Date().toISOString(),mode:'api',detections};
  const cv=$('scanCanvas');cv.width=frame.width;cv.height=frame.height;cv.getContext('2d').drawImage(frame,0,0);
  cv.hidden=false;$('scanEmpty').hidden=true;$('dropzone').classList.add('has-image');$('imageState').textContent='Saved live frame';$('analyzeBtn').disabled=false;
  const stored=saveCurrentScan();if(!stored)toast('Result available, but local history could not be saved.',true);
  navigate('results');
});
$('liveConfidence').addEventListener('input',()=>{$('confidence').value=$('liveConfidence').value;$('confidence').dispatchEvent(new Event('input'));});
$('liveLabels').addEventListener('change',()=>{$('showLabels').checked=$('liveLabels').checked;$('showLabels').dispatchEvent(new Event('change'));});
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(live.active||live.cameraStarting)stopLiveCamera('Camera stopped because the app was hidden.');}});
window.addEventListener('pagehide',()=>{if(live.active||live.cameraStarting)stopLiveCamera();});

/* ---------- settings and PWA ---------- */
function updateSource(){
  const mode=$('modeSelect').value;
  $('scanMode').value=mode;store.set('bk_mode',mode);
  $('sourceTitle').textContent=mode==='demo'?'Demo mode is active':'Model detection selected';
  $('sourceMessage').textContent=mode==='demo'?'Results are simulated and must not be treated as model predictions.':'Photos will be submitted to your configured FastAPI /predict endpoint.';
  $('sourceBanner').classList.toggle('demo-source',mode==='demo');$('sourceBanner').classList.toggle('model-source',mode==='api');
  if(state.source&&!state.busy)setScanStatus('Photo ready. Select Analyze leaf.');
  $('settingsSaved').textContent='Settings save automatically.';
  updateLiveSource();
}
$('modeSelect').addEventListener('change',updateSource);
$('scanMode').addEventListener('change',()=>{$('modeSelect').value=$('scanMode').value;updateSource();});
$('apiUrl').addEventListener('input',()=>{store.set('bk_api',$('apiUrl').value.trim());$('settingsSaved').textContent='API address saved on this device.';updateLiveSource();});
function init(){
  $('today').textContent=new Intl.DateTimeFormat('en-PH',{weekday:'long',month:'short',day:'numeric',year:'numeric'}).format(new Date());
  const mode=store.get('bk_mode','demo');$('modeSelect').value=mode==='api'?'api':'demo';$('apiUrl').value=store.get('bk_api','');
  const conf=Math.min(95,Math.max(10,Number(store.get('bk_conf','40'))||40));$('confidence').value=String(conf);$('confidenceValue').textContent=conf+'%';
  $('showLabels').checked=store.get('bk_labels','true')!=='false';$('liveConfidence').value=String(conf);$('liveConfidenceValue').textContent=conf+'%';$('liveLabels').checked=$('showLabels').checked;
  updateSource();updateConnectivity();renderOverview();renderHistory();
  let deferredPrompt=null;
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;$('installBtn').hidden=false;});
  $('installBtn').addEventListener('click',async()=>{if(!deferredPrompt)return;deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;$('installBtn').hidden=true;});
  window.addEventListener('appinstalled',()=>{$('installBtn').hidden=true;});
  if('serviceWorker' in navigator&&(location.protocol==='https:'||location.hostname==='localhost'||location.hostname==='127.0.0.1')){
    window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
  }
  navigate(location.hash.slice(1).replace(/[^a-z]/g,'')||'overview');
}
init();
