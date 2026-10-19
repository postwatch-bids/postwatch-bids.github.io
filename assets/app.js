(async()=>{
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
$('#yr').textContent=new Date().getFullYear();
const d=await (await fetch('data/latest.json',{cache:'no-cache'})).json();
const now=Date.now(),DAY=864e5,bids=d.bids;
const fmt=s=>s?new Date(s).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'—';
const soon=b=>b.deadline&&new Date(b.deadline)-now<14*DAY, fresh=b=>b.posted&&now-new Date(b.posted)<7*DAY;
const usd=n=>n==null?'—':'$'+(Math.abs(n)>=1e6?(n/1e6).toFixed(2)+'M':Math.round(n).toLocaleString());
$('#stats').innerHTML=[[d.counts.total,'Open bids'],[d.counts.federal,'Federal'],[d.counts.state,'State/local'],[d.counts.ca??0,'California'],[d.counts.socal??0,'SoCal'],[d.counts.la??0,'LA area'],[bids.filter(soon).length,'Closing in 14d'],[d.counts.awards,'Recent awards']].map(([n,l])=>`<div class="stat"><b>${n}</b><span>${l}</span></div>`).join('');
$('#updated').textContent='Updated '+new Date(d.generatedAt).toLocaleString();
const opts=(id,vals)=>$(id).insertAdjacentHTML('beforeend',[...new Set(vals.filter(Boolean))].sort().map(v=>`<option>${esc(v)}</option>`).join(''));
opts('#fState',bids.map(b=>b.state));opts('#fType',bids.map(b=>b.type));opts('#fSet',bids.map(b=>b.setAside));opts('#fCounty',bids.map(b=>b.county));opts('#fSource',bids.map(b=>b.source));
let view='all',sortK='deadline',dir=1;
function render(){
 const q=$('#q').value.toLowerCase(),st=$('#fState').value,ty=$('#fType').value,sa=$('#fSet').value,sr=$('#fSrc').value,so=$('#fSource').value,co=$('#fCounty').value;
 let r=bids.filter(b=>(view!='soon'||soon(b))&&(view!='new'||fresh(b))&&(view!='ca'||b.state=='CA')&&(view!='la'||b.la)&&(view!='socal'||b.socal)&&(!co||b.county==co)&&(!so||b.source==so)&&(!st||b.state==st)&&(!ty||b.type==ty)&&(!sa||b.setAside==sa)&&(!sr||(sr=='state'?b.src!='federal':b.src==sr))&&
  (!q||[b.title,b.agency,b.subAgency,b.office,b.city,b.solicitation].join(' ').toLowerCase().includes(q)));
 r.sort((a,b)=>{const x=String(a[sortK]||'\uffff'),y=String(b[sortK]||'\uffff');return (x<y?-1:x>y?1:0)*dir});
 $('#count').textContent=`${r.length} of ${bids.length} open opportunities`;
 $('#tbl tbody').innerHTML=r.map(b=>`<tr><td class="t"><a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.title)}</a><div class="sub"><span class="badge ${b.src}">${esc(b.source)}</span>${b.socal?'<span class="badge socal">SoCal</span>':''}${b.la?'<span class="badge la">LA area</span>':''}${b.county?`<span class="badge cty">${esc(b.county)} Co.</span>`:''}${b.category=='systems'?'<span class="badge sys">Alarm/CCTV systems</span>':''}${esc(b.subAgency||b.agency)}${b.solicitation?' · '+esc(b.solicitation):''}${b.naics?' · NAICS '+esc(b.naics):''}</div></td>
 <td>${esc([b.city,b.state].filter(Boolean).join(', ')||'—')}</td><td>${esc(b.type)}</td><td>${esc(b.setAside)}</td><td>${fmt(b.posted)}</td><td class="${soon(b)?'soon':''}">${b.deadline?fmt(b.deadline):'Not stated'}</td></tr>`).join('')||'<tr><td colspan="6">No matches.</td></tr>';
}
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));t.classList.add('active');view=t.dataset.view;render()});
['#q','#fState','#fType','#fSet','#fSrc','#fSource','#fCounty'].forEach(s=>$(s).addEventListener('input',render));
document.querySelectorAll('#tbl th').forEach(th=>th.onclick=()=>{const k=th.dataset.k;dir=sortK==k?-dir:1;sortK=k;render()});
$('#stateList').innerHTML=Object.entries(d.byState).sort((a,b)=>b[1]-a[1]).map(([s,n])=>`<span class="chip" data-s="${esc(s)}">${esc(s)} <b>${n}</b></span>`).join('');
document.querySelectorAll('.chip').forEach(c=>c.onclick=()=>{$('#fState').value=c.dataset.s;render();$('#bids').scrollIntoView({behavior:'smooth'})});
const aw=d.awards.filter(a=>a.amount>0).sort((a,b)=>(b.start||'').localeCompare(a.start||''));
const amts=aw.map(a=>a.amount).sort((a,b)=>a-b),med=amts[Math.floor(amts.length/2)];
$('#awardsNote').textContent=`${d.awards.length} contract awards in the last 180 days (USAspending.gov). Median award ${usd(med)}. Award amounts are total obligations, not hourly rates. Use them as rough context only.`;
$('#awTbl tbody').innerHTML=aw.slice(0,25).map(a=>`<tr><td><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.recipient)}</a></td><td>${esc(a.subAgency||a.agency)}</td><td>${esc(a.state||'—')}</td><td>${esc(a.start||'')} → ${esc(a.end||'')}</td><td class="r">${usd(a.amount)}</td></tr>`).join('');
render();
const hv=(location.hash.match(/^#view=(\w+)/)||[])[1];if(hv)document.querySelector(`.tab[data-view="${hv}"]`)?.click();
})();

(()=>{const f=document.getElementById('subForm');if(!f)return;let via='email';
f.querySelectorAll('button[data-via]').forEach(b=>b.addEventListener('click',()=>via=b.dataset.via));
f.addEventListener('submit',e=>{e.preventDefault();const v=Object.fromEntries(new FormData(f));v.state=v.state.toUpperCase();
 const body=`Bid title: ${v.title}\nAgency / city: ${v.agency}\nCity: ${v.city}\nState: ${v.state}\nDeadline: ${v.deadline}\nLink: ${v.link}\nSubmitter email: ${v.email}\n\n(Submitted via PostWatch. Reviewed before publishing.)`;
 if(via==='email'){location.href='mailto:octopuslaboratoryllc@gmail.com?subject='+encodeURIComponent('PostWatch bid submission: '+v.title)+'&body='+encodeURIComponent(body);
  document.getElementById('subMsg').textContent='Your email app should open with the bid filled in. Press send. Thanks!';}
 else{const q=new URLSearchParams({template:'submit-bid.yml',title:'[Bid] '+v.title,...v});
  window.open('https://github.com/postwatch-bids/postwatch-bids.github.io/issues/new?'+q,'_blank','noopener');}
});})();
