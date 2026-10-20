/* StudyNest – runs fully in your browser. Notes are stored in IndexedDB on this laptop. */
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const COL=['#6c4cf1','#ff6b6b','#12b5cb','#f15bb5','#ffb703','#1fb67a'];
let notes=[],sessions=[],wrongs=[],sel=new Set(),tab='lib',S=null,draft={t:'',x:''},mins=25,tick=null,busy='';
if(window.pdfjsLib)pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

/* ---------- local database (IndexedDB) ---------- */
const dbp=new Promise((ok,no)=>{const r=indexedDB.open('studynest',1);
  r.onupgradeneeded=()=>['notes','sessions','wrong'].forEach(n=>r.result.createObjectStore(n,{keyPath:'id'}));
  r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)});
const req=r=>new Promise((ok,no)=>{r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)});
const store=async(n,m)=>(await dbp).transaction(n,m).objectStore(n);
const getAll=async n=>req((await store(n,'readonly')).getAll());
const put=async(n,o)=>req((await store(n,'readwrite')).put(o));
const rm=async(n,id)=>req((await store(n,'readwrite')).delete(id));
async function load(){
  notes=(await getAll('notes')).sort((a,b)=>b.created-a.created);
  sessions=(await getAll('sessions')).sort((a,b)=>b.date-a.date);
  wrongs=(await getAll('wrong')).sort((a,b)=>b.date-a.date);
  if(!S)render();
}

/* ---------- Claude API (your own key, stored only in this browser) ---------- */
const prov=()=>localStorage.getItem('sn_prov')||'gemini';
const key=()=>localStorage.getItem('sn_key_'+prov())||'';
const DEF={gemini:'gemini-3.5-flash',claude:'claude-sonnet-5-5'};
const model=()=>localStorage.getItem('sn_model_'+prov())||DEF[prov()];
async function ai(prompt,max,json){
  if(!key())throw new Error('Add your API key in ⚙️ Settings first.');
  const c=prov()==='claude';
  const models=c?[model()]:[...new Set([model(),'gemini-3.8-flash','gemini-3.5-flash','gemini-flash-latest','gemini-flash-lite-latest'])];
  let last='';
  for(const m of models){
    for(let t=0;t<2;t++){
      let r;
      if(c)r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',
        headers:{'content-type':'application/json','x-api-key':key(),'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
        body:JSON.stringify({model:m,max_tokens:max||4000,messages:[{role:'user',content:prompt}]})});
      else r=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(m)+':generateContent',{method:'POST',
        headers:{'content-type':'application/json','x-goog-api-key':key()},
        body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:Object.assign({maxOutputTokens:(max||4000)*2},json?{responseMimeType:'application/json'}:{})})});
      const d=await r.json();
      if(r.ok)return c?d.content.filter(x=>x.type==='text').map(x=>x.text).join(''):((d.candidates&&d.candidates[0]&&d.candidates[0].content&&d.candidates[0].content.parts)||[]).map(p=>p.text||'').join('');
      last=(d.error&&d.error.message)||('Error '+r.status);
      if(r.status===404)break;
      if([429,500,503].includes(r.status)){
        if(t===0){if(S){S.msg='Model '+m+' is busy, retrying in a few seconds…';drawSession()}await new Promise(o=>setTimeout(o,8000));continue}
        if(S){S.msg='Switching to another model…';drawSession()}break;
      }
      throw new Error(last);
    }
  }
  throw new Error(last+' (all models were busy or unavailable. Try again in a little while.)');
}
async function aiJson(prompt,max){const t=await ai(prompt,max,true);return JSON.parse(t.slice(t.indexOf('{'),t.lastIndexOf('}')+1))}
function chunks(t,size){const out=[];let cur='';
  for(let p of t.split(/\n+/)){if(cur.length+p.length>size&&cur){out.push(cur);cur=''}
    while(p.length>size){out.push(p.slice(0,size));p=p.slice(size)} cur+=p+'\n'}
  if(cur.trim())out.push(cur);return out}
const hash=s=>{let h=0;for(const c of s)h=(h*31+c.charCodeAt(0))|0;return Math.abs(h).toString(36)};

/* ---------- navigation ---------- */
$('#nav').onclick=e=>{const t=e.target.dataset.t;if(!t)return;
  if(S&&!confirm('Leave this session? Progress in it will be lost.'))return;
  clearInterval(tick);S=null;tab=t;render()};
function render(){
  document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('on',b.dataset.t===tab));
  if(S)return drawSession();
  ({lib:drawLib,study:drawSetup,rev:drawRev,prog:drawProg,set:drawSet})[tab]();
}

/* ---------- Library ---------- */
async function readFile(f){
  if(/\.pdf$/i.test(f.name)){
    if(!window.pdfjsLib)throw new Error('PDF reader did not load. Check your internet and reload.');
    const pdf=await pdfjsLib.getDocument({data:await f.arrayBuffer()}).promise;let out='';
    for(let i=1;i<=pdf.numPages;i++){busy=`Reading PDF page ${i} of ${pdf.numPages}…`;drawLib();
      const c=await(await pdf.getPage(i)).getTextContent();out+=c.items.map(x=>x.str).join(' ')+'\n\n'}
    if(out.trim().length<40)throw new Error('This PDF has no selectable text (it may be scanned images). Try a text-based PDF.');
    return out}
  return f.text();
}
function drawLib(){
  $('#main').innerHTML=`<div class="card"><h2>➕ Add notes</h2>
  <p class="mute" style="margin-top:0">Upload a PDF, .txt, .md or .csv file, or paste your notes. There is no length limit.</p>
  <div class="row" style="margin-bottom:10px"><input type="file" id="f" accept=".pdf,.txt,.md,.csv,.text"> <span class="mute">${esc(busy)}</span></div>
  <input type="text" id="t" placeholder="Title, e.g. BIT107 – Process Scheduling" value="${esc(draft.t)}" style="margin-bottom:10px">
  <textarea id="x" placeholder="…or paste your notes here">${esc(draft.x)}</textarea>
  <div class="row" style="margin-top:10px"><button class="btn" id="save">Save to library</button><span id="msg" class="mute"></span></div></div>
  <div class="card"><h2>🗂️ My library (${notes.length})</h2>
  ${notes.length?`<p class="mute" style="margin-top:0">Tap notes to select them, then start studying.</p><div class="grid">${notes.map((n,i)=>`<div class="note ${sel.has(n.id)?'sel':''}" style="--c:${COL[i%6]}" data-id="${n.id}"><b>${esc(n.title)}</b><small>${new Date(n.created).toLocaleDateString()} · ${Math.max(1,Math.round(n.text.length/6)).toLocaleString()} words</small><div class="row" style="margin-top:8px"><button class="btn ghost" style="padding:5px 10px;font-size:13px" data-del="${n.id}">Delete</button></div></div>`).join('')}</div>
  <div class="row" style="margin-top:14px"><button class="btn alt" id="go" ${sel.size?'':'disabled'}>Study ${sel.size||''} selected →</button><button class="btn ghost" id="all">Select all</button></div>`:'<p class="mute">Nothing here yet. Add your first notes above ✨</p>'}</div>`;
  $('#t').oninput=e=>draft.t=e.target.value;$('#x').oninput=e=>draft.x=e.target.value;
  $('#f').onchange=async e=>{const f=e.target.files[0];if(!f)return;
    try{draft.x=await readFile(f);if(!draft.t)draft.t=f.name.replace(/\.[^.]+$/,'')}catch(err){alert(err.message)}
    busy='';drawLib()};
  $('#save').onclick=async()=>{
    if(draft.x.trim().length<40){$('#msg').textContent='Add a bit more text first.';return}
    await put('notes',{id:'n'+Date.now(),title:draft.t.trim()||'Untitled notes',text:draft.x,created:Date.now()});
    draft={t:'',x:''};load()};
  document.querySelectorAll('.note').forEach(el=>el.onclick=async e=>{
    const d=e.target.dataset.del;
    if(d){if(e.target.dataset.sure){await rm('notes',d);sel.delete(d);load()}
      else{e.target.dataset.sure=1;e.target.textContent='Tap again';setTimeout(()=>{e.target.dataset.sure='';e.target.textContent='Delete'},3000)}return}
    const id=el.dataset.id;sel.has(id)?sel.delete(id):sel.add(id);drawLib()});
  if($('#go'))$('#go').onclick=()=>{tab='study';render()};
  if($('#all'))$('#all').onclick=()=>{notes.forEach(n=>sel.add(n.id));drawLib()};
}

/* ---------- Study setup ---------- */
function drawSetup(){
  const ch=notes.filter(n=>sel.has(n.id));
  $('#main').innerHTML=`<div class="card"><h2>🎯 Start a study session</h2>
  ${ch.length?`<p>Studying: ${ch.map(n=>`<span class="chip" style="background:${COL[notes.indexOf(n)%6]}">${esc(n.title)}</span>`).join(' ')}</p>`:'<p class="mute">Select notes in the Library first.</p>'}
  <h3>How long do you want to study?</h3>
  <div class="row">${[15,25,45,60].map(m=>`<button class="btn ${m===mins?'':'ghost'}" data-m="${m}">${m} min</button>`).join('')}</div>
  <p class="mute">Your time is split into <b>summary</b> (35%), <b>flashcards</b> (25%) and <b>quiz</b> (40%). The timer shows how long to spend on each.</p>
  ${key()?'':'<p class="banner">Add your API key in ⚙️ Settings to create summaries and quizzes.</p>'}
  <button class="btn sun" id="start" ${ch.length&&key()?'':'disabled'}>Begin session 🚀</button></div>`;
  document.querySelectorAll('[data-m]').forEach(b=>b.onclick=()=>{mins=+b.dataset.m;drawSetup()});
  $('#start').onclick=startSession;
}

/* ---------- Session ---------- */
const PH={sum:['Read the summary',.35,'var(--cya)'],cards:['Flashcards',.25,'var(--sun)'],quiz:['Quiz time',.40,'var(--pin)']};
const el=()=>Math.floor((Date.now()-S.t0)/1000);
const fmt=s=>{s=Math.max(0,s);return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0')};
async function condense(n){
  const cs=chunks(n.text,12000);let out=[];
  for(let i=0;i<cs.length;i++){S.msg=`Reading “${n.title}”: part ${i+1} of ${cs.length}…`;drawSession();
    out.push(await ai('Condense these study notes into every important fact, definition, formula and example as compact bullet lines (max 25 lines). Keep the original meaning. Notes:\n'+cs[i],1800))}
  return out.join('\n');
}
async function startSession(){
  const ch=notes.filter(n=>sel.has(n.id));
  S={phase:'load',total:mins*60,card:0,flip:false,q:0,score:0,answered:null,ids:ch.map(n=>n.id),titles:ch.map(n=>n.title),msg:'Preparing…'};render();
  try{
    const parts=[];
    for(const n of ch){
      if(n.text.length<=12000){parts.push('### '+n.title+'\n'+n.text);continue}
      if(!n.digest){n.digest=await condense(n);await put('notes',n)}   // saved so next time is instant
      parts.push('### '+n.title+' (condensed from long notes)\n'+n.digest);
    }
    S.msg='Writing your summary and quiz…';drawSession();
    const nq={15:5,25:8,45:10,60:12}[mins];
    S.pack=await aiJson(`You are a friendly study coach. From the student's notes below, create a study pack. Reply with ONLY valid JSON, no markdown fences, in this exact shape:
{"overview":"2-3 sentence plain-language summary","keyPoints":["6-12 concise key points covering everything important"],"terms":[{"term":"...","def":"short simple definition"}],"quiz":[{"q":"...","options":["A","B","C","D"],"answer":0,"why":"one-sentence explanation"}]}
Rules: 6-8 terms; exactly ${nq} quiz questions testing understanding across all the notes; answer is the index 0-3 of the correct option; vary the correct position. Use simple language.

NOTES:
${parts.join('\n\n').slice(0,150000)}`,6000);
    if(!S.pack.quiz||!S.pack.quiz.length)throw new Error('The study pack came back incomplete. Please try again.');
    S.phase='sum';S.t0=Date.now();tick=setInterval(updTimer,1000);
  }catch(e){S.phase='err';S.msg=e.message}
  render();
}
function timerHTML(){
  const p=PH[S.phase];if(!p||S.review)return'';
  const e=el(),pct=Math.min(100,e/S.total*100);
  return`<div class="card"><div class="timer"><div style="font-size:34px;font-weight:800" id="tm">${fmt(S.total-e)}</div><div style="flex:1"><div class="row" style="justify-content:space-between;margin-bottom:6px"><span class="chip" style="background:${p[2]}">${p[0]} · aim for ~${Math.round(S.total*p[1]/60)} min</span><span class="mute" id="pc">${Math.round(pct)}% of time used</span></div><div class="bar"><i id="pb" style="width:${pct}%"></i></div></div></div>${e>=S.total?'<p class="banner" style="margin:12px 0 0">⏰ Time’s up! Finish the quiz to lock in your progress.</p>':''}</div>`;
}
function updTimer(){
  if(!S||!S.t0||!$('#tm'))return;const e=el(),pct=Math.min(100,e/S.total*100);
  $('#tm').textContent=fmt(S.total-e);$('#pb').style.width=pct+'%';$('#pc').textContent=Math.round(pct)+'% of time used';
}
function drawSession(){
  const m=$('#main'),p=S.pack;
  if(S.phase==='load'){m.innerHTML=`<div class="card" style="text-align:center"><div class="spin"></div><h2>Building your study pack…</h2><p class="mute">${esc(S.msg)}</p><p class="mute">Long notes take a little longer the first time, then they’re saved.</p></div>`;return}
  if(S.phase==='err'){m.innerHTML=`<div class="card"><h2>Hmm, that didn’t work 😕</h2><p>${esc(S.msg)}</p><button class="btn" id="b">Back</button></div>`;$('#b').onclick=()=>{S=null;render()};return}
  if(S.phase==='sum'){
    m.innerHTML=timerHTML()+`<div class="card"><h2>📝 Summary</h2><p>${esc(p.overview)}</p><h3>Key points</h3><ol class="pts">${p.keyPoints.map(k=>`<li>${esc(k)}</li>`).join('')}</ol><button class="btn alt" id="n">Next: flashcards →</button></div>`;
    $('#n').onclick=()=>{S.phase='cards';render()};return}
  if(S.phase==='cards'){
    const c=p.terms[S.card];
    m.innerHTML=timerHTML()+`<div class="card"><h2>🃏 Flashcards <span class="mute" style="font-size:15px">${S.card+1} / ${p.terms.length}</span></h2><p class="mute" style="margin-top:0">Say the answer out loud first, then tap to flip.</p><div class="flash ${S.flip?'back':''}" id="fl">${esc(S.flip?c.def:c.term)}</div><div class="row" style="margin-top:12px"><button class="btn ghost" id="pv" ${S.card?'':'disabled'}>← Back</button><button class="btn ghost" id="fp">Flip</button>${S.card<p.terms.length-1?'<button class="btn" id="nx">Next →</button>':'<button class="btn sun" id="q">Start the quiz 🎯</button>'}</div></div>`;
    $('#fl').onclick=$('#fp').onclick=()=>{S.flip=!S.flip;drawSession()};
    $('#pv').onclick=()=>{S.card--;S.flip=false;drawSession()};
    if($('#nx'))$('#nx').onclick=()=>{S.card++;S.flip=false;drawSession()};
    if($('#q'))$('#q').onclick=()=>{S.phase='quiz';render()};return}
  if(S.phase==='quiz'){
    const q=p.quiz[S.q],a=S.answered;
    m.innerHTML=timerHTML()+`<div class="card"><h2>${S.review?'🔁 Review':'🎯'} Question ${S.q+1} of ${p.quiz.length}</h2><p style="font-size:18px">${esc(q.q)}</p><div class="opts">${q.options.map((o,i)=>`<button data-i="${i}" ${a!==null?'disabled':''} class="${a!==null?(i===q.answer?'good':(i===a?'bad':'')):''}">${'ABCD'[i]}. ${esc(o)}</button>`).join('')}</div>
    ${a!==null?`<p><b>${a===q.answer?'✅ Correct!':'❌ Not quite.'}</b> ${esc(q.why)}</p><button class="btn" id="nx">${S.q<p.quiz.length-1?'Next question →':'See my results 🏁'}</button>`:''}</div>`;
    document.querySelectorAll('.opts button').forEach(b=>b.onclick=async()=>{
      S.answered=+b.dataset.i;const ok=S.answered===q.answer;if(ok)S.score++;
      const id=q.id||('w'+hash(q.q));
      if(!ok)await put('wrong',{id,q:q.q,options:q.options,answer:q.answer,why:q.why,notes:q.notes||S.titles,date:Date.now()});
      else if(S.review)await rm('wrong',id);
      drawSession()});
    if($('#nx'))$('#nx').onclick=()=>{S.answered=null;if(S.q<p.quiz.length-1){S.q++;drawSession()}else finish()};return}
  if(S.phase==='done'){
    const n=p.quiz.length,pc=Math.round(S.score/n*100);
    m.innerHTML=`<div class="card" style="text-align:center"><div style="font-size:56px">${pc>=80?'🏆':pc>=50?'🌟':'💪'}</div><h2>You scored ${S.score} / ${n} (${pc}%)</h2><p>${pc>=80?'Brilliant work, you know this material well!':pc>=50?'Good progress. Open the Review tab to practise the ones you missed.':'Every session builds memory. Use the Review tab to practise what you missed.'}</p>${S.review?'':`<p class="mute">Time studied: ${Math.max(1,Math.round(S.spent/60))} min</p>`}<div class="row" style="justify-content:center"><button class="btn" id="a">Study again</button><button class="btn alt" id="b">${S.review?'Back to review':'See progress'}</button></div></div>`;
    $('#a').onclick=()=>{S=null;tab='study';load().then(render)};$('#b').onclick=()=>{S=null;tab=S0();load().then(render)}}
}
let lastReview=false;const S0=()=>lastReview?'rev':'prog';
async function finish(){
  clearInterval(tick);S.spent=S.t0?el():0;lastReview=!!S.review;S.phase='done';render();
  if(!S.review)await put('sessions',{id:'s'+Date.now(),date:Date.now(),minutes:Math.round(S.spent/60),planned:mins,score:S.score,total:S.pack.quiz.length,notes:S.titles});
  await load();
}

/* ---------- Review wrong answers ---------- */
function drawRev(){
  $('#main').innerHTML=`<div class="card"><h2>🔁 Wrong-answer review</h2>
  ${wrongs.length?`<p class="mute" style="margin-top:0">${wrongs.length} question${wrongs.length>1?'s':''} to master. Answer one correctly in review and it leaves this list.</p><button class="btn sun" id="rs">Practise them now →</button>
  ${wrongs.map(w=>`<div class="wq"><b>${esc(w.q)}</b><br><span style="color:var(--ok)">✔ ${esc(w.options[w.answer])}</span><br><small class="mute">${esc(w.why)} · ${esc((w.notes||[]).join(', '))}</small></div>`).join('')}`
  :'<p class="mute">Nothing to review. Questions you get wrong in a quiz will appear here 🎉</p>'}</div>`;
  if($('#rs'))$('#rs').onclick=()=>{
    const qs=wrongs.map(w=>({...w})).sort(()=>Math.random()-.5);
    S={phase:'quiz',review:true,pack:{quiz:qs},q:0,score:0,answered:null,titles:['Review']};render()};
}

/* ---------- Progress ---------- */
function drawProg(){
  const tot=sessions.reduce((a,s)=>a+s.minutes,0),avg=sessions.length?Math.round(sessions.reduce((a,s)=>a+s.score/s.total*100,0)/sessions.length):0;
  const last=sessions.slice(0,8).reverse();
  $('#main').innerHTML=`<div class="row" style="margin-bottom:14px">
  <div class="stat" style="background:linear-gradient(135deg,var(--vio),var(--pin))"><b>${sessions.length}</b>sessions</div>
  <div class="stat" style="background:linear-gradient(135deg,var(--cya),var(--ok))"><b>${tot}</b>minutes studied</div>
  <div class="stat" style="background:linear-gradient(135deg,var(--sun),var(--cor))"><b>${avg}%</b>average quiz score</div>
  <div class="stat" style="background:linear-gradient(135deg,var(--pin),var(--vio))"><b>${wrongs.length}</b>to review</div></div>
  <div class="card"><h2>📈 Recent quiz scores</h2>${last.length?`<div class="bars" style="margin-top:26px">${last.map(s=>{const p=Math.round(s.score/s.total*100);return`<div style="height:${Math.max(p,6)}%"><span>${p}%</span></div>`}).join('')}</div>`:'<p class="mute">Finish a session to see your progress here.</p>'}</div>
  <div class="card"><h2>🕑 History</h2>${sessions.length?sessions.slice(0,15).map(s=>`<div class="row" style="justify-content:space-between;border-bottom:1px solid var(--line);padding:8px 0"><span><b>${esc((s.notes||[]).join(', ')||'Session')}</b><br><small class="mute">${new Date(s.date).toLocaleString()} · ${s.minutes} min</small></span><span class="chip" style="background:${s.score/s.total>=.5?'var(--ok)':'var(--cor)'}">${s.score}/${s.total}</span></div>`).join(''):'<p class="mute">No sessions yet.</p>'}</div>`;
}

/* ---------- Settings ---------- */
function drawSet(){
  const p=prov();
  $('#main').innerHTML=`<div class="card"><h2>⚙️ Settings</h2>
  <p class="mute" style="margin-top:0">StudyNest uses an AI key to write summaries and quizzes. The key is stored only in this browser on this laptop and is never part of the code you upload to GitHub.</p>
  <h3>AI provider</h3><div class="row"><button class="btn ${p==='gemini'?'':'ghost'}" id="pg">Google Gemini (free)</button><button class="btn ${p==='claude'?'':'ghost'}" id="pc">Claude (paid)</button></div>
  <p class="mute">${p==='gemini'?'Get a free key at aistudio.google.com → “Get API key”. No card needed. Free-tier prompts may be used by Google to improve its products, so avoid private material.':'Get a key at console.anthropic.com (needs paid credit).'}</p>
  <h3>API key</h3><input type="password" id="k" placeholder="paste your key here" value="${esc(key())}">
  <h3>Model</h3><input type="text" id="m" value="${esc(model())}">
  <div class="row" style="margin-top:12px"><button class="btn" id="s">Save</button><span id="ok" class="mute"></span></div></div>`;
  $('#pg').onclick=()=>{localStorage.setItem('sn_prov','gemini');drawSet()};
  $('#pc').onclick=()=>{localStorage.setItem('sn_prov','claude');drawSet()};
  $('#s').onclick=()=>{localStorage.setItem('sn_key_'+p,$('#k').value.trim());localStorage.setItem('sn_model_'+p,$('#m').value.trim()||DEF[p]);$('#ok').textContent='Saved ✓'};
}
load();
