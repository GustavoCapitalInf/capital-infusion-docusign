export const documentsPage = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>DocuSign Documents</title>
  <style>
    :root{color-scheme:light;--ink:#17211b;--muted:#68736c;--line:#dce3de;--paper:#fff;--wash:#f4f7f5;--brand:#145c3c;--brand-soft:#e6f2eb;--warning:#8a5a18}
    *{box-sizing:border-box}body{margin:0;background:var(--wash);color:var(--ink);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    main{width:min(980px,calc(100% - 32px));margin:0 auto;padding:48px 0 80px}header{margin-bottom:28px}.eyebrow{color:var(--brand);font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:12px}
    h1{font-size:clamp(28px,4vw,42px);line-height:1.1;margin:8px 0}h2{margin:0;font-size:20px}.subtle,.meta{color:var(--muted)}.toolbar{display:flex;gap:12px;margin:24px 0;flex-wrap:wrap}
    input,select{border:1px solid var(--line);background:var(--paper);border-radius:9px;padding:11px 13px;font:inherit;color:inherit}input{flex:1;min-width:220px}select{min-width:180px}
    .grid{display:grid;gap:12px}.card{display:block;background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:20px;text-decoration:none;color:inherit;box-shadow:0 1px 2px rgb(20 40 28/.04)}
    a.card:hover{border-color:#9eb8a8;box-shadow:0 5px 18px rgb(20 40 28/.08)}.card-row{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.count{color:var(--brand);font-weight:700;white-space:nowrap}
    .back{display:inline-block;color:var(--brand);font-weight:650;text-decoration:none;margin-bottom:20px}.pill{display:inline-block;border-radius:999px;padding:3px 9px;background:var(--brand-soft);color:var(--brand);font-size:12px;font-weight:700;text-transform:capitalize}
    .pill.certificate{background:#f5ead9;color:var(--warning)}.documents{margin-top:24px}.document{display:flex;justify-content:space-between;align-items:center;gap:20px}.actions{display:flex;gap:8px}.button{border:1px solid var(--brand);border-radius:8px;padding:8px 12px;color:var(--brand);text-decoration:none;font-weight:650}.button.primary{background:var(--brand);color:white}
    code{font-size:12px;color:var(--muted);overflow-wrap:anywhere}.empty{padding:40px;text-align:center;border:1px dashed #bac5bd;border-radius:12px;color:var(--muted)}.error{padding:16px;border-radius:10px;background:#fff1f0;color:#8f2720}
    @media(max-width:620px){main{padding-top:28px}.card-row,.document{display:block}.count,.actions{margin-top:14px}.actions{display:flex}}
  </style>
</head>
<body><main id="app"><div class="subtle">Loading documents…</div></main>
<script>
const app=document.querySelector('#app');
const esc=(value='')=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>value?new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'Unknown';
async function api(path){const response=await fetch(path);const body=await response.json();if(!response.ok)throw new Error(body.error||'Request failed');return body}
function shell(title,subtitle,content,back=''){app.innerHTML=(back?'<a class="back" href="'+back+'">← Back</a>':'')+'<header><div class="eyebrow">Capital Infusion</div><h1>'+esc(title)+'</h1><div class="subtle">'+esc(subtitle)+'</div></header>'+content}
function error(error){app.innerHTML='<div class="error">'+esc(error.message)+'</div>'}
async function reps(){
  shell('DocuSign Documents','Completed envelopes grouped by signer','<div class="toolbar"><input id="search" placeholder="Search reps by name or email"><select id="sort"><option value="recent">Recent activity</option><option value="name">Rep name</option><option value="count">Envelope count</option></select></div><div id="results" class="grid"></div>');
  const load=async()=>{const query=new URLSearchParams({search:document.querySelector('#search').value,sort:document.querySelector('#sort').value});const {reps}=await api('/api/reps?'+query);document.querySelector('#results').innerHTML=reps.length?reps.map(rep=>'<a class="card" href="/documents/reps/'+encodeURIComponent(rep.repId)+'"><div class="card-row"><div><h2>'+esc(rep.name)+'</h2><div class="meta">'+esc(rep.email||(rep.type==='requires_resolution'?'Multiple completed signers':'No completed signer resolved'))+'</div><div class="meta">Last activity: '+esc(date(rep.latestCompletedAt))+'</div></div><div class="count">'+rep.completedEnvelopeCount+' completed envelope'+(rep.completedEnvelopeCount===1?'':'s')+'</div></div></a>').join(''):'<div class="empty">No completed envelopes found.</div>'};
  document.querySelector('#search').addEventListener('input',load);document.querySelector('#sort').addEventListener('change',load);await load();
}
async function repPage(repId){
  const data=await api('/api/reps/'+encodeURIComponent(repId)+'/envelopes');
  shell(data.rep.name,data.rep.email||(data.rep.type==='requires_resolution'?'Multiple completed signers require resolution':'No completed signer resolved'),'<div class="toolbar"><input id="search" placeholder="Search document, envelope ID, or date"><select id="sort"><option value="newest">Newest completed</option><option value="oldest">Oldest completed</option><option value="name">Document name</option></select></div><div id="results" class="grid"></div>','/documents');
  const load=async()=>{const query=new URLSearchParams({search:document.querySelector('#search').value,sort:document.querySelector('#sort').value});const next=await api('/api/reps/'+encodeURIComponent(repId)+'/envelopes?'+query);document.querySelector('#results').innerHTML=next.envelopes.length?next.envelopes.map(env=>'<a class="card" href="/documents/envelopes/'+encodeURIComponent(env.envelopeId)+'"><div class="card-row"><div><h2>'+esc(env.primaryDocumentName||'Completed envelope')+'</h2><div class="meta">Completed '+esc(date(env.completedAt))+'</div><code>'+esc(env.envelopeId)+'</code></div><div class="count">'+env.documentCount+' document'+(env.documentCount===1?'':'s')+'</div></div></a>').join(''):'<div class="empty">No matching envelopes.</div>'};
  document.querySelector('#search').addEventListener('input',load);document.querySelector('#sort').addEventListener('change',load);await load();
}
async function envelopePage(envelopeId){
  const env=await api('/api/docusign/envelopes/'+encodeURIComponent(envelopeId));
  const docs=env.documents.map(doc=>'<div class="card document"><div><h2>'+esc(doc.name)+'</h2><span class="pill '+esc(doc.classification)+'">'+esc(doc.classification.replace('_',' '))+'</span></div><div class="actions"><a class="button primary" target="_blank" rel="noopener" href="/api/docusign/envelopes/'+encodeURIComponent(envelopeId)+'/documents/'+encodeURIComponent(doc.documentId)+'">View</a><a class="button" href="/api/docusign/envelopes/'+encodeURIComponent(envelopeId)+'/documents/'+encodeURIComponent(doc.documentId)+'?download=true">Download</a></div></div>').join('');
  shell(env.rep.name,(env.rep.email||'Signer resolution pending')+' · Completed '+date(env.completedAt),'<div class="card"><div class="meta">Sent by: '+esc(env.sender?.email||'Unknown sender')+'</div><div class="meta" style="margin-top:10px">Envelope ID</div><code>'+esc(env.envelopeId)+'</code></div><section class="documents"><h2>Documents</h2><div class="grid" style="margin-top:12px">'+(docs||'<div class="empty">No documents found.</div>')+'</div></section>','/documents/reps/'+encodeURIComponent(env.rep.repId));
}
const path=location.pathname;
Promise.resolve().then(()=>{let match;if(path==='/documents'||path==='/documents/')return reps();if(match=path.match(new RegExp('^/documents/reps/([^/]+)$')))return repPage(decodeURIComponent(match[1]));if(match=path.match(new RegExp('^/documents/envelopes/([^/]+)$')))return envelopePage(decodeURIComponent(match[1]));throw new Error('Page not found')}).catch(error);
</script></body></html>`;
