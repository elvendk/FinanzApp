// ═══════════════════════════════════════════════════════════
//  FINANZAS APP v2 — app.js
// ═══════════════════════════════════════════════════════════

// ── State ──────────────────────────────────────────────────
let state = {
  people: [],
  creditCards: [],
  // category: 'tarjeta'|'prestamo'|'recurrente'|'servicio'
  transactions: [],
  incomes: [],          // {id,description,amount,period,category}
  cardGroups: [],       // {id,name,cardIds[]} — for summary merging
  tags: [],             // {id,name,emoji,color} — user-defined labels
  currentPeriod: getCurrentPeriod(),
};

let editingTx = null, editingPerson = null, editingCard = null;
let editingIncome = null;
let summaryMode = 'detail'; // 'card' | 'detail'
let txFilter = { search:'', card:'', period:'', category:'' };
let annualYear = new Date().getFullYear();

// ── Persistence ────────────────────────────────────────────
function save() { localStorage.setItem('finanzas_v2', JSON.stringify(state)); }
function load() {
  const raw = localStorage.getItem('finanzas_v2');
  // migrate from v1
  const old = localStorage.getItem('finanzas_state');
  if (raw) { try { state = { ...state, ...JSON.parse(raw) }; } catch(e) {} }
  else if (old) { try { const o=JSON.parse(old); state.people=o.people||[]; state.creditCards=o.creditCards||[]; state.transactions=o.transactions||[]; state.currentPeriod=o.currentPeriod||state.currentPeriod; } catch(e) {} }
  // ensure new fields
  if (!state.incomes) state.incomes = [];
  if (!state.cardGroups) state.cardGroups = [];
  if (!state.tags) state.tags = [];
}

// ── Helpers ────────────────────────────────────────────────
function getCurrentPeriod() { const n=new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`; }
function formatPeriod(p) {
  if (!p) return '';
  const [yr,mo] = p.split('-');
  return ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][+mo-1]+' '+yr;
}
function fmtCLP(n) { if (isNaN(n)||n==null) return '$0'; return '$'+Math.round(n).toLocaleString('es-CL'); }
function uid() { return Date.now().toString(36)+Math.random().toString(36).slice(2); }
function initials(name) { return name.trim().split(/\s+/).map(w=>w[0]).join('').toUpperCase().slice(0,2); }
function getPerson(id) { return state.people.find(p=>p.id===id); }
function getCard(id)   { return state.creditCards.find(c=>c.id===id); }

const COLORS = [
  {hex:'#6c63ff',bg:'rgba(108,99,255,0.2)'},{hex:'#10b981',bg:'rgba(16,185,129,0.2)'},
  {hex:'#3b82f6',bg:'rgba(59,130,246,0.2)'},{hex:'#f59e0b',bg:'rgba(245,158,11,0.2)'},
  {hex:'#ef4444',bg:'rgba(239,68,68,0.2)'},{hex:'#ec4899',bg:'rgba(236,72,153,0.2)'},
  {hex:'#14b8a6',bg:'rgba(20,184,166,0.2)'},{hex:'#f97316',bg:'rgba(249,115,22,0.2)'},
];
const CC_GRADIENTS = [
  'linear-gradient(135deg,#1a1a2e,#16213e)','linear-gradient(135deg,#0d1b2a,#1b4332)',
  'linear-gradient(135deg,#2d1b69,#11998e)','linear-gradient(135deg,#7c2d12,#9a3412)',
  'linear-gradient(135deg,#1e1b4b,#3730a3)','linear-gradient(135deg,#064e3b,#065f46)',
];
function getColor(idx) { return COLORS[idx%COLORS.length]; }

// ── Period helpers ─────────────────────────────────────────
function getPeriods() {
  const s = new Set([getCurrentPeriod(), state.currentPeriod]);
  state.transactions.forEach(t=>s.add(t.period));
  state.incomes.forEach(t=>s.add(t.period));
  return [...s].filter(Boolean).sort().reverse();
}
function populatePeriodSelects() {
  const periods = getPeriods();
  ['period-select','filter-period'].forEach(id=>{
    const el=document.getElementById(id); if(!el) return;
    const cur=el.value||state.currentPeriod;
    el.innerHTML=periods.map(p=>`<option value="${p}" ${p===cur?'selected':''}>${formatPeriod(p)}</option>`).join('');
  });
}

// ── Installment amount for a given period ──────────────────
function getTxAmountForPeriod(tx, period) {
  if (tx.category==='recurrente' || tx.category==='servicio') {
    const [tY,tM]=tx.period.split('-').map(Number);
    const [pY,pM]=period.split('-').map(Number);
    const elapsed=(pY*12+pM)-(tY*12+tM);
    if (elapsed<0) return 0;
    if (tx.months && tx.months>0 && elapsed>=tx.months) return 0;
    return tx.amount;
  }
  if (tx.type==='single') return tx.period===period ? tx.amount : 0;
  const [tY,tM]=tx.period.split('-').map(Number);
  const [pY,pM]=period.split('-').map(Number);
  const elapsed=(pY-tY)*12+(pM-tM);
  if (elapsed<0||elapsed>=tx.installments) return 0;
  return tx.amount/tx.installments;
}

function getInstallmentLabel(tx, period) {
  if (tx.category==='recurrente' || tx.category==='servicio') {
    const [tY,tM]=tx.period.split('-').map(Number);
    const [pY,pM]=period.split('-').map(Number);
    const n=(pY*12+pM)-(tY*12+tM)+1;
    const label=tx.category==='servicio'?'Servicio':'Recurrente';
    if (tx.months && tx.months>0) return `${label} ${n}/${tx.months}`;
    return `${label} mes ${n}`;
  }
  if (tx.type==='single') return 'Pago único';
  const [tY,tM]=tx.period.split('-').map(Number);
  const [pY,pM]=period.split('-').map(Number);
  const n=(pY-tY)*12+(pM-tM)+1;
  return `Cuota ${n}/${tx.installments}`;
}

// ── Core period calculations ───────────────────────────────
function calcPeriod(period) {
  let myTotal=0;
  const perPerson={};
  state.people.forEach(p=>{perPerson[p.id]=0;});
  state.transactions.forEach(tx=>{
    const amount=getTxAmountForPeriod(tx,period);
    if (!amount) return;
    (tx.splits||[]).forEach(s=>{
      const portion=amount*(s.pct/100);
      if (s.personId==='me') myTotal+=portion;
      else { perPerson[s.personId]=(perPerson[s.personId]||0)+portion; }
    });
  });
  return {myTotal,perPerson};
}

function calcIncomePeriod(period) {
  return state.incomes.filter(i=>i.period===period).reduce((a,i)=>a+i.amount,0);
}

function calcCardUsage(cardId, period) {
  return state.transactions
    .filter(t=>t.cardId===cardId && (t.category==='tarjeta'||!t.category))
    .reduce((a,t)=>a+getTxAmountForPeriod(t,period),0);
}

// ── Toasts ─────────────────────────────────────────────────
function toast(msg, type='success') {
  const c=document.getElementById('toast-container');
  const t=document.createElement('div');
  t.className=`toast ${type}`;
  t.innerHTML=`<span>${type==='success'?'✓':'✕'}</span> ${msg}`;
  c.appendChild(t);
  setTimeout(()=>{t.style.opacity='0';t.style.transition='opacity 0.3s';setTimeout(()=>t.remove(),300);},3000);
}

// ── Navigation ─────────────────────────────────────────────
function navigate(page) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const pg=document.getElementById('page-'+page);
  if (pg) pg.classList.add('active');
  document.querySelectorAll(`.nav-item[data-page="${page}"]`).forEach(n=>n.classList.add('active'));
  renderPage(page);
}
function renderPage(page) {
  const map={dashboard:renderDashboard,transactions:renderTransactions,people:renderPeople,
    cards:renderCards,summary:renderSummary,incomes:renderIncomes,annual:renderAnnual};
  if (map[page]) map[page]();
}

// ── Tag spend breakdown ────────────────────────────────────
function calcTagBreakdown(period) {
  const map={};
  state.transactions.forEach(tx=>{
    const amt=getTxAmountForPeriod(tx,period);
    if (!amt) return;
    const key=tx.tag||'__none__';
    map[key]=(map[key]||0)+amt;
  });
  return map;
}

// ══════════════════════════════════════════════════════════
//  DASHBOARD
// ══════════════════════════════════════════════════════════
function renderDashboard() {
  const period=state.currentPeriod;
  // Show period in header
  const hdr=document.getElementById('dash-period-label');
  if(hdr) hdr.textContent=formatPeriod(period);

  const {myTotal,perPerson}=calcPeriod(period);
  const totalOthers=Object.values(perPerson).reduce((a,b)=>a+b,0);
  const grandTotal=myTotal+totalOthers;
  const totalIncome=calcIncomePeriod(period);
  const balance=totalIncome-myTotal;

  document.getElementById('dash-my-total').textContent=fmtCLP(myTotal);
  document.getElementById('dash-others-total').textContent=fmtCLP(totalOthers);
  document.getElementById('dash-grand-total').textContent=fmtCLP(grandTotal);
  document.getElementById('dash-income-total').textContent=fmtCLP(totalIncome);
  const balEl=document.getElementById('dash-balance');
  balEl.textContent=fmtCLP(balance);
  balEl.className='stat-value '+(balance>=0?'green':'red');

  document.getElementById('dash-tx-count').textContent=
    state.transactions.filter(t=>getTxAmountForPeriod(t,period)>0).length;

  // Cards usage
  const cardsEl=document.getElementById('dash-cards-usage');
  if (state.creditCards.length) {
    cardsEl.innerHTML=state.creditCards.map((c,i)=>{
      const usage=calcCardUsage(c.id,period);
      const limit=c.limit||0;
      const pct=limit>0?Math.min(100,(usage/limit*100)):0;
      const col=limit>0&&pct>90?'var(--red)':limit>0&&pct>70?'var(--amber)':'var(--green)';
      return `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">
        <div style="font-size:18px">💳</div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600">${c.name}</div>
          ${limit>0?`<div class="progress-bar" style="margin-top:5px"><div class="progress-fill" style="width:${pct}%;background:${col}"></div></div>
          <div style="font-size:11px;color:var(--text-3);margin-top:3px">${fmtCLP(usage)} de ${fmtCLP(limit)} (${pct.toFixed(0)}%)</div>
          `:``}
        </div>
        <div style="font-weight:700;font-size:14px">${fmtCLP(usage)}</div>
      </div>`;
    }).join('');
  } else {
    cardsEl.innerHTML=`<div class="empty-state" style="padding:20px"><p>Sin tarjetas registradas</p></div>`;
  }

  // Per-person list
  const list=document.getElementById('dash-person-list');
  const people=state.people.filter(p=>(perPerson[p.id]||0)>0).sort((a,b)=>(perPerson[b.id]||0)-(perPerson[a.id]||0));
  if (!people.length){list.innerHTML=`<div class="empty-state"><div class="empty-icon">👥</div><p>Sin gastos compartidos</p></div>`;}
  else {
    const max=Math.max(...people.map(p=>perPerson[p.id]||0));
    list.innerHTML=people.map(p=>{
      const col=getColor(state.people.indexOf(p));
      const pct=max>0?(perPerson[p.id]/max*100).toFixed(0):0;
      return `<div style="display:flex;align-items:center;gap:14px;padding:12px 0;border-bottom:1px solid var(--border)">
        <div class="person-avatar" style="background:${col.bg};color:${col.hex};width:36px;height:36px;border-radius:10px;font-size:13px">${initials(p.name)}</div>
        <div style="flex:1"><div style="font-size:13px;font-weight:600">${p.name}</div>
          <div class="progress-bar" style="margin-top:5px"><div class="progress-fill" style="width:${pct}%;background:${col.hex}"></div></div>
        </div>
        <div style="font-size:15px;font-weight:700;color:${col.hex}">${fmtCLP(perPerson[p.id])}</div>
      </div>`;
    }).join('');
  }

  // Tag breakdown
  const tagEl=document.getElementById('dash-tag-breakdown');
  const tagMap=calcTagBreakdown(period);
  const tagEntries=Object.entries(tagMap).sort((a,b)=>b[1]-a[1]);
  const totalTagged=Object.values(tagMap).reduce((a,b)=>a+b,0);
  if (!tagEntries.length) {
    tagEl.innerHTML=`<div class="empty-state" style="padding:20px"><p>Sin gastos este período</p></div>`;
  } else {
    const maxAmt=tagEntries[0][1];
    tagEl.innerHTML=tagEntries.map(([tagId,amt])=>{
      const tag=state.tags.find(t=>t.id===tagId);
      const label=tag?`${tag.emoji||'🏷️'} ${tag.name}`:'Sin etiqueta';
      const col=tag?.color||'#6c63ff';
      const pct=maxAmt>0?(amt/maxAmt*100).toFixed(0):0;
      const pctTotal=totalTagged>0?(amt/totalTagged*100).toFixed(1):0;
      return `<div style="padding:10px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;margin-bottom:5px">
          <span style="font-size:13px;font-weight:600">${label}</span>
          <span style="font-size:13px;font-weight:700;color:${col}">${fmtCLP(amt)} <span style="font-size:11px;color:var(--text-3);font-weight:400">(${pctTotal}%)</span></span>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${col}"></div></div>
      </div>`;
    }).join('');
  }
}

// ══════════════════════════════════════════════════════════
//  INCOMES
// ══════════════════════════════════════════════════════════
function renderIncomes() {
  const period=state.currentPeriod;
  const list=state.incomes.filter(i=>i.period===period).sort((a,b)=>b.amount-a.amount);
  const total=list.reduce((a,i)=>a+i.amount,0);
  document.getElementById('income-total').textContent=fmtCLP(total);
  const tb=document.getElementById('income-tbody');
  if (!list.length){tb.innerHTML=`<tr><td colspan="4"><div class="empty-state"><div class="empty-icon">💰</div><p>Sin ingresos para este período</p></div></td></tr>`;return;}
  tb.innerHTML=list.map(i=>`<tr>
    <td><div style="font-weight:600">${i.description}</div></td>
    <td><span class="badge badge-gray">${i.category||'General'}</span></td>
    <td style="font-weight:700;color:var(--green)">${fmtCLP(i.amount)}</td>
    <td><div style="display:flex;gap:6px">
      <button class="icon-btn" onclick="openEditIncome('${i.id}')">✏️</button>
      <button class="icon-btn danger" onclick="deleteIncome('${i.id}')">🗑️</button>
    </div></td>
  </tr>`).join('');
}

function openAddIncome() {
  editingIncome=null;
  document.getElementById('income-modal-title').textContent='Nuevo Ingreso';
  document.getElementById('income-desc').value='';
  document.getElementById('income-amount').value='';
  document.getElementById('income-category').value='Sueldo';
  document.getElementById('income-period').value=state.currentPeriod;
  openModal('income-modal');
}
function openEditIncome(id) {
  editingIncome=state.incomes.find(i=>i.id===id);
  if(!editingIncome)return;
  document.getElementById('income-modal-title').textContent='Editar Ingreso';
  document.getElementById('income-desc').value=editingIncome.description;
  document.getElementById('income-amount').value=editingIncome.amount;
  document.getElementById('income-category').value=editingIncome.category||'Sueldo';
  document.getElementById('income-period').value=editingIncome.period;
  openModal('income-modal');
}
function saveIncome() {
  const description=document.getElementById('income-desc').value.trim();
  const amount=parseFloat(document.getElementById('income-amount').value);
  const category=document.getElementById('income-category').value;
  const period=document.getElementById('income-period').value;
  if (!description){toast('Ingresa descripción','error');return;}
  if (!amount||amount<=0){toast('Monto inválido','error');return;}
  if (editingIncome) Object.assign(editingIncome,{description,amount,category,period});
  else state.incomes.push({id:uid(),description,amount,category,period});
  save(); closeModal('income-modal'); populatePeriodSelects(); renderPage('incomes');
  toast(editingIncome?'Ingreso actualizado':'Ingreso agregado');
}
function deleteIncome(id) {
  askConfirm('¿Eliminar este ingreso?', () => {
    state.incomes = state.incomes.filter(i => i.id !== id);
    save(); renderPage('incomes'); toast('Ingreso eliminado');
  });
}

// ══════════════════════════════════════════════════════════
//  TRANSACTIONS (tarjeta + préstamo + recurrente)
// ══════════════════════════════════════════════════════════
let selectedTxs = new Set();

function renderTransactions() {
  const period=txFilter.period||state.currentPeriod;
  let txs=state.transactions.filter(t=>getTxAmountForPeriod(t,period)>0||t.period===period);
  const cardSel=document.getElementById('filter-card');
  const curCard=cardSel?cardSel.value:'';
  if(cardSel){
    cardSel.innerHTML=`<option value="">Todas las tarjetas</option>`+
      state.creditCards.map(c=>`<option value="${c.id}" ${c.id===curCard?'selected':''}>${c.name}</option>`).join('');
  }
  if(txFilter.card) txs=txs.filter(t=>t.cardId===txFilter.card);
  if(txFilter.category) txs=txs.filter(t=>(t.category||'tarjeta')===txFilter.category);
  if(txFilter.search){const q=txFilter.search.toLowerCase();txs=txs.filter(t=>t.description.toLowerCase().includes(q));}
  txs.sort((a,b)=>b.date.localeCompare(a.date));

  const tbody=document.getElementById('tx-tbody');
  
  // Clear selection on re-render to avoid hidden selected items
  selectedTxs.clear();
  const selectAllCb = document.getElementById('tx-select-all');
  if(selectAllCb) selectAllCb.checked = false;
  updateBulkActionsUI();

  if(!txs.length){tbody.innerHTML=`<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">📋</div><p>Sin registros para este período</p></div></td></tr>`;return;}

  tbody.innerHTML=txs.map(tx=>{
    const card=getCard(tx.cardId);
    const cat=tx.category||'tarjeta';
    const catBadge=cat==='tarjeta'?'badge-blue':cat==='prestamo'?'badge-amber':cat==='servicio'?'badge-teal':'badge-green';
    const catLabel=cat==='tarjeta'?'Tarjeta':cat==='prestamo'?'Préstamo':cat==='servicio'?'Servicio':'Recurrente';
    const cuotaAmt=getTxAmountForPeriod(tx,period);
    const quotaLabel=getInstallmentLabel(tx,period);
    const splits=(tx.splits||[]).map(s=>{
      if(s.personId==='me')return`<span class="badge badge-purple" style="font-size:11px">Yo ${s.pct}%</span>`;
      const p=getPerson(s.personId); if(!p)return'';
      const col=getColor(state.people.indexOf(p));
      return`<span class="person-chip" style="background:${col.bg};color:${col.hex};font-size:11px">${initials(p.name)} ${s.pct}%</span>`;
    }).join(' ');
    return`<tr>
      <td style="text-align:center"><input type="checkbox" class="tx-row-cb" value="${tx.id}" style="accent-color:var(--accent);width:16px;height:16px" onchange="toggleTxSelect('${tx.id}')"></td>
      <td><div style="font-weight:600">${tx.description}</div><div style="font-size:12px;color:var(--text-3)">${tx.date}</div></td>
      <td><span class="badge ${catBadge}">${catLabel}</span></td>
      <td>${card?`<span class="badge badge-gray">${card.name}</span>`:'-'}</td>
      <td style="font-weight:700">${fmtCLP(cuotaAmt)}<div style="font-size:11px;color:var(--text-3)">${tx.type==='installment'?'de '+fmtCLP(tx.amount)+' total':''}</div></td>
      <td><span class="badge badge-gray">${quotaLabel}</span></td>
      <td style="max-width:160px"><div style="display:flex;flex-wrap:wrap;gap:3px">${splits}</div></td>
      <td><div style="display:flex;gap:5px"><button class="icon-btn" onclick="openEditTx('${tx.id}')">✏️</button><button class="icon-btn danger" onclick="deleteTx('${tx.id}')">🗑️</button></div></td>
    </tr>`;
  }).join('');
}

// ── Bulk Actions ───────────────────────────────────────────
function toggleTxSelect(id) {
  if (selectedTxs.has(id)) selectedTxs.delete(id);
  else selectedTxs.add(id);
  updateBulkActionsUI();
}

function toggleAllTxs() {
  const isChecked = document.getElementById('tx-select-all').checked;
  const cbs = document.querySelectorAll('.tx-row-cb');
  selectedTxs.clear();
  cbs.forEach(cb => {
    cb.checked = isChecked;
    if (isChecked) selectedTxs.add(cb.value);
  });
  updateBulkActionsUI();
}

function updateBulkActionsUI() {
  const bulk = document.getElementById('tx-bulk-actions');
  const normal = document.getElementById('tx-normal-actions');
  if(!bulk || !normal) return;
  const count = selectedTxs.size;
  if(count > 0) {
    bulk.style.display = 'flex';
    normal.style.display = 'none';
    document.getElementById('tx-bulk-count').textContent = count + (count===1?' sel.':' sels.');
  } else {
    bulk.style.display = 'none';
    normal.style.display = 'flex';
  }
}

function deleteSelectedTxs() {
  if(selectedTxs.size===0) return;
  askConfirm(`¿Eliminar ${selectedTxs.size} transacciones seleccionadas?`, () => {
    state.transactions = state.transactions.filter(t => !selectedTxs.has(t.id));
    save(); renderPage('transactions'); toast(`${selectedTxs.size} eliminadas`);
  });
}

function openMergeTxsModal() {
  if(selectedTxs.size < 2) {
    toast('Selecciona al menos 2 gastos para fusionar','error');
    return;
  }
  document.getElementById('merge-desc').value = '';
  openModal('merge-modal');
}

function executeMerge() {
  const desc = document.getElementById('merge-desc').value.trim();
  if(!desc) { toast('Ingresa un nombre para el nuevo gasto','error'); return; }
  
  const ids = Array.from(selectedTxs);
  const txsToMerge = state.transactions.filter(t => selectedTxs.has(t.id));
  if(txsToMerge.length === 0) return;
  
  // Base properties from the first selected transaction
  const base = txsToMerge[0];
  const totalAmount = txsToMerge.reduce((sum, t) => sum + (t.amount || 0), 0);
  
  state.transactions.push({
    id: uid(),
    description: desc,
    amount: totalAmount,
    date: base.date,
    cardId: base.cardId,
    category: base.category,
    type: base.type,
    period: base.period,
    installments: base.installments,
    months: base.months,
    tag: base.tag,
    splits: JSON.parse(JSON.stringify(base.splits || [])) // Deep copy splits of the first
  });
  
  // Delete merged
  state.transactions = state.transactions.filter(t => !selectedTxs.has(t.id));
  
  save(); 
  closeModal('merge-modal');
  renderPage('transactions');
  toast(`Gastos fusionados exitosamente en "${desc}"`);
}

// ══════════════════════════════════════════════════════════
//  PEOPLE
// ══════════════════════════════════════════════════════════
function renderPeople() {
  const grid=document.getElementById('people-grid');
  const period=state.currentPeriod;
  const {perPerson}=calcPeriod(period);
  grid.innerHTML=state.people.map((p,i)=>{
    const col=getColor(i);
    const total=perPerson[p.id]||0;
    const txCount=state.transactions.filter(t=>(t.splits||[]).some(s=>s.personId===p.id)).length;
    return`<div class="person-card">
      <div class="person-avatar-lg" style="background:${col.bg};color:${col.hex}">${initials(p.name)}</div>
      <div style="flex:1"><div class="person-name">${p.name}</div>
        <div class="person-stats">${txCount} gastos • ${fmtCLP(total)} este mes</div>
      </div>
      <div class="person-card-actions">
        <button class="icon-btn" onclick="openEditPerson('${p.id}')">✏️</button>
        <button class="icon-btn danger" onclick="deletePerson('${p.id}')">🗑️</button>
      </div>
    </div>`;
  }).join('')+`<div class="add-person-card" onclick="openAddPerson()"><span style="font-size:22px">+</span> Agregar Persona</div>`;
}

// ══════════════════════════════════════════════════════════
//  CARDS
// ══════════════════════════════════════════════════════════
function renderCards() {
  const period=state.currentPeriod;
  const grid=document.getElementById('cards-grid');
  grid.innerHTML=state.creditCards.map((c,i)=>{
    const usage=calcCardUsage(c.id,period);
    const limit=c.limit||0;
    const pct=limit>0?Math.min(100,(usage/limit*100)):0;
    const col=limit>0&&pct>90?'#ef4444':limit>0&&pct>70?'#f59e0b':'#10b981';
    return`<div class="cc-card" style="background:${CC_GRADIENTS[i%CC_GRADIENTS.length]}">
      <div>
        <div class="cc-name">${c.name}</div>
        ${limit>0?`<div style="font-size:12px;opacity:0.7;margin-top:4px">Cupo: ${fmtCLP(limit)}</div>
        <div style="height:4px;background:rgba(255,255,255,0.15);border-radius:99px;margin-top:8px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${col};border-radius:99px"></div>
        </div>
        <div style="font-size:11px;opacity:0.6;margin-top:4px">${fmtCLP(usage)} usado (${pct.toFixed(0)}%)</div>`:''}
      </div>
      <div class="cc-bottom">
        <div style="display:flex;gap:8px">
          <button class="icon-btn" style="background:rgba(255,255,255,0.1);border-color:rgba(255,255,255,0.2);color:white" onclick="openEditCard('${c.id}')">✏️</button>
          <button class="icon-btn" style="background:rgba(239,68,68,0.2);border-color:rgba(239,68,68,0.3);color:#ef4444" onclick="deleteCard('${c.id}')">🗑️</button>
        </div>
        <span style="font-size:26px">💳</span>
      </div>
    </div>`;
  }).join('')+`<div class="add-cc-card" onclick="openAddCard()"><span style="font-size:22px">+</span> Agregar Tarjeta</div>`;
}

// ══════════════════════════════════════════════════════════
//  SUMMARY
// ══════════════════════════════════════════════════════════
function renderSummary() {
  const period=state.currentPeriod;
  const {myTotal,perPerson}=calcPeriod(period);

  // My section
  const myLines=state.transactions.filter(tx=>{
    if(!getTxAmountForPeriod(tx,period))return false;
    const s=(tx.splits||[]).find(s=>s.personId==='me');
    return s&&s.pct>0;
  }).map(tx=>({tx, portion:getTxAmountForPeriod(tx,period)*((tx.splits.find(s=>s.personId==='me').pct)/100)}));

  document.getElementById('my-summary-total').textContent=fmtCLP(myTotal);
  document.getElementById('my-summary-items').innerHTML=myLines.length?myLines.map(l=>{
    const card=getCard(l.tx.cardId);
    return`<div class="person-summary-item">
      <div><div class="item-desc">${l.tx.description}</div>
        <div class="item-quota">${getInstallmentLabel(l.tx,period)}${card?' · '+card.name:''}</div>
      </div>
      <div class="item-amount">${fmtCLP(l.portion)}</div>
    </div>`;
  }).join(''):`<div style="padding:14px 20px;font-size:13px;color:var(--text-3)">Sin gastos propios este período</div>`;

  // Mode toggle buttons
  document.getElementById('sum-btn-detail').className='btn '+(summaryMode==='detail'?'btn-primary':'btn-ghost')+' btn-sm';
  document.getElementById('sum-btn-card').className='btn '+(summaryMode==='card'?'btn-primary':'btn-ghost')+' btn-sm';

  const grid=document.getElementById('summary-people-grid');
  const activePeople=state.people.filter(p=>(perPerson[p.id]||0)>0).sort((a,b)=>(perPerson[b.id]||0)-(perPerson[a.id]||0));
  if(!activePeople.length){grid.innerHTML=`<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">🎉</div><p>Sin gastos compartidos este período</p></div>`;return;}

  if(summaryMode==='detail') renderSummaryDetail(activePeople,perPerson,period,grid);
  else renderSummaryByCard(activePeople,perPerson,period,grid);
}

function renderSummaryDetail(people,perPerson,period,grid) {
  grid.innerHTML=people.map(p=>{
    const col=getColor(state.people.indexOf(p));
    const total=perPerson[p.id]||0;
    const lines=state.transactions.filter(tx=>{
      if(!getTxAmountForPeriod(tx,period))return false;
      const s=(tx.splits||[]).find(s=>s.personId===p.id);
      return s&&s.pct>0;
    }).map(tx=>{
      const s=tx.splits.find(s=>s.personId===p.id);
      return{tx,portion:getTxAmountForPeriod(tx,period)*(s.pct/100)};
    });
    return`<div class="person-summary-card">
      <div class="person-summary-header" style="background:${col.bg}">
        <div class="person-summary-info">
          <div class="person-avatar" style="background:${col.hex};color:#fff;width:40px;height:40px;border-radius:11px;font-size:15px">${initials(p.name)}</div>
          <div><div style="font-weight:700;font-size:15px">${p.name}</div>
            <div style="font-size:12px;opacity:0.7">${lines.length} concepto(s)</div>
          </div>
        </div>
        <div style="text-align:right">
          <div class="person-summary-total" style="color:${col.hex}">${fmtCLP(total)}</div>
          <div style="font-size:11px;color:var(--text-3);margin-top:2px">a cobrar</div>
        </div>
      </div>
      <div class="person-summary-items">
        ${lines.map(l=>{
          const card=getCard(l.tx.cardId);
          const cat=l.tx.category||'tarjeta';
          const catLabel=cat==='tarjeta'?'💳':cat==='prestamo'?'🏦':'🔄';
          return`<div class="person-summary-item">
            <div><div class="item-desc">${catLabel} ${l.tx.description}</div>
              <div class="item-quota">${getInstallmentLabel(l.tx,period)}${card?' · '+card.name:''}</div>
            </div>
            <div class="item-amount" style="color:${col.hex}">${fmtCLP(l.portion)}</div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');
}

function renderSummaryByCard(people,perPerson,period,grid) {
  // Build effective card groups: user-defined groups + ungrouped cards + loans + recurring
  const groupedCardIds=new Set(state.cardGroups.flatMap(g=>g.cardIds));
  const ungroupedCards=state.creditCards.filter(c=>!groupedCardIds.has(c.id));

  // Each "bucket": {label, cardIds or null, category override}
  const buckets=[
    ...state.cardGroups.map(g=>({label:g.name,cardIds:g.cardIds,cat:'tarjeta'})),
    ...ungroupedCards.map(c=>({label:c.name,cardIds:[c.id],cat:'tarjeta'})),
    {label:'Préstamos',cardIds:null,cat:'prestamo'},
    {label:'Gastos Recurrentes',cardIds:null,cat:'recurrente'},
    {label:'Cuentas de Servicios',cardIds:null,cat:'servicio'},
  ];

  grid.innerHTML=people.map(p=>{
    const col=getColor(state.people.indexOf(p));
    const total=perPerson[p.id]||0;
    const bucketRows=buckets.map(b=>{
      const txs=state.transactions.filter(tx=>{
        if(!getTxAmountForPeriod(tx,period))return false;
        const s=(tx.splits||[]).find(s=>s.personId===p.id);
        if(!s||s.pct===0)return false;
        const cat=tx.category||'tarjeta';
        if(b.cardIds) return cat==='tarjeta'&&b.cardIds.includes(tx.cardId);
        return cat===b.cat;
      });
      if(!txs.length)return'';
      const subtotal=txs.reduce((a,tx)=>{
        const s=tx.splits.find(s=>s.personId===p.id);
        return a+getTxAmountForPeriod(tx,period)*(s.pct/100);
      },0);
      return`<div class="person-summary-item" style="background:rgba(0,0,0,0.15)">
        <div style="font-weight:700;font-size:13px;color:var(--text-2)">${b.label}</div>
        <div class="item-amount" style="font-size:15px;font-weight:800;color:${col.hex}">${fmtCLP(subtotal)}</div>
      </div>`;
    }).filter(Boolean).join('');

    return`<div class="person-summary-card">
      <div class="person-summary-header" style="background:${col.bg}">
        <div class="person-summary-info">
          <div class="person-avatar" style="background:${col.hex};color:#fff;width:40px;height:40px;border-radius:11px;font-size:15px">${initials(p.name)}</div>
          <div><div style="font-weight:700;font-size:15px">${p.name}</div>
            <div style="font-size:12px;opacity:0.7">Resumen por tarjeta/categoría</div>
          </div>
        </div>
        <div style="text-align:right">
          <div class="person-summary-total" style="color:${col.hex}">${fmtCLP(total)}</div>
          <div style="font-size:11px;color:var(--text-3);margin-top:2px">a cobrar</div>
        </div>
      </div>
      <div class="person-summary-items">${bucketRows||`<div style="padding:12px 20px;font-size:12px;color:var(--text-3)">Sin gastos</div>`}</div>
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════
//  CARD GROUPS (for summary merging)
// ══════════════════════════════════════════════════════════
function renderCardGroups() {
  const list=document.getElementById('card-groups-list');
  if(!state.cardGroups.length){
    list.innerHTML=`<div style="padding:10px;font-size:13px;color:var(--text-3)">Sin grupos definidos. Crea un grupo para fusionar tarjetas en el resumen.</div>`;
    return;
  }
  list.innerHTML=state.cardGroups.map(g=>{
    const names=g.cardIds.map(id=>getCard(id)?.name||'?').join(', ');
    return`<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
      <div style="flex:1"><div style="font-weight:600;font-size:13px">${g.name}</div>
        <div style="font-size:12px;color:var(--text-3)">${names}</div>
      </div>
      <button class="icon-btn danger" onclick="deleteCardGroup('${g.id}')">🗑️</button>
    </div>`;
  }).join('');
}

function openAddCardGroup() {
  // Populate checkboxes
  const cb=document.getElementById('group-cards-cb');
  cb.innerHTML=state.creditCards.map(c=>`
    <label style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:13px;cursor:pointer">
      <input type="checkbox" value="${c.id}" style="accent-color:var(--accent)"> ${c.name}
    </label>`).join('');
  document.getElementById('group-name').value='';
  openModal('card-group-modal');
}
function saveCardGroup() {
  const name=document.getElementById('group-name').value.trim();
  const cardIds=[...document.querySelectorAll('#group-cards-cb input:checked')].map(i=>i.value);
  if(!name){toast('Ingresa nombre del grupo','error');return;}
  if(cardIds.length<2){toast('Selecciona al menos 2 tarjetas','error');return;}
  state.cardGroups.push({id:uid(),name,cardIds});
  save(); closeModal('card-group-modal'); renderCardGroups(); toast('Grupo creado');
}
function deleteCardGroup(id) {
  askConfirm('¿Eliminar este grupo de tarjetas?', () => {
    state.cardGroups = state.cardGroups.filter(g => g.id !== id);
    save(); renderCardGroups(); toast('Grupo eliminado');
  });
}

// ══════════════════════════════════════════════════════════
//  MODAL — People
// ══════════════════════════════════════════════════════════
let selectedPersonColor=0;
function openAddPerson() {
  editingPerson=null;
  document.getElementById('person-modal-title').textContent='Nueva Persona';
  document.getElementById('person-name').value='';
  selectedPersonColor=0; renderColorPicker(); openModal('person-modal');
}
function openEditPerson(id) {
  editingPerson=state.people.find(p=>p.id===id); if(!editingPerson)return;
  document.getElementById('person-modal-title').textContent='Editar Persona';
  document.getElementById('person-name').value=editingPerson.name;
  selectedPersonColor=editingPerson.colorIdx||0; renderColorPicker(); openModal('person-modal');
}
function renderColorPicker() {
  document.getElementById('color-picker').innerHTML=COLORS.map((c,i)=>
    `<div class="color-dot ${i===selectedPersonColor?'selected':''}" style="background:${c.hex}" onclick="selectColor(${i})"></div>`).join('');
}
function selectColor(i){selectedPersonColor=i;renderColorPicker();}
function savePerson() {
  const name=document.getElementById('person-name').value.trim();
  if(!name){toast('Ingresa un nombre','error');return;}
  if(editingPerson){editingPerson.name=name;editingPerson.colorIdx=selectedPersonColor;}
  else state.people.push({id:uid(),name,colorIdx:selectedPersonColor});
  save(); closeModal('person-modal'); renderPage('people');
  toast(editingPerson?'Persona actualizada':'Persona agregada');
}
function deletePerson(id) {
  askConfirm('¿Eliminar esta persona?', () => {
    state.people = state.people.filter(p => p.id !== id);
    state.transactions.forEach(t => { t.splits = (t.splits || []).filter(s => s.personId !== id); });
    save(); renderPage('people'); toast('Persona eliminada');
  });
}

// ══════════════════════════════════════════════════════════
//  MODAL — Credit Cards
// ══════════════════════════════════════════════════════════
function openAddCard() {
  editingCard=null;
  document.getElementById('card-modal-title').textContent='Nueva Tarjeta';
  document.getElementById('card-name').value='';
  document.getElementById('card-limit').value='';
  openModal('card-modal');
}
function openEditCard(id) {
  editingCard=state.creditCards.find(c=>c.id===id); if(!editingCard)return;
  document.getElementById('card-modal-title').textContent='Editar Tarjeta';
  document.getElementById('card-name').value=editingCard.name;
  document.getElementById('card-limit').value=editingCard.limit||'';
  openModal('card-modal');
}
function saveCard() {
  const name=document.getElementById('card-name').value.trim();
  const limit=parseFloat(document.getElementById('card-limit').value)||0;
  if(!name){toast('Ingresa un nombre','error');return;}
  if(editingCard){editingCard.name=name;editingCard.limit=limit;}
  else state.creditCards.push({id:uid(),name,limit});
  save(); closeModal('card-modal'); renderPage('cards'); toast('Tarjeta guardada');
}
function deleteCard(id) {
  askConfirm('¿Eliminar esta tarjeta?', () => {
    state.creditCards = state.creditCards.filter(c => c.id !== id);
    state.transactions.forEach(t => { if (t.cardId === id) t.cardId = ''; });
    save(); renderPage('cards'); toast('Tarjeta eliminada');
  });
}

// ══════════════════════════════════════════════════════════
//  MODAL — Transactions (tarjeta / préstamo / recurrente)
// ══════════════════════════════════════════════════════════
function openAddTx(category='tarjeta') {
  editingTx=null;
  const labels={tarjeta:'Nueva Transacción de Tarjeta',prestamo:'Nuevo Crédito de Consumo',recurrente:'Nuevo Gasto Recurrente',servicio:'Nueva Cuenta de Servicio'};
  document.getElementById('tx-modal-title').textContent=labels[category]||'Nueva Transacción';
  document.getElementById('tx-description').value='';
  document.getElementById('tx-amount').value='';
  document.getElementById('tx-date').value=new Date().toISOString().slice(0,10);
  document.getElementById('tx-category').value=category;
  document.getElementById('tx-type').value=category==='prestamo'?'installment':'single';
  document.getElementById('tx-period').value=state.currentPeriod;
  document.getElementById('tx-installments').value='12';
  document.getElementById('tx-months').value='';
  populateTxCardSelect();
  populateTxTagSelect();
  onTxTypeChange(); onTxCategoryChange();
  buildSplitsEditor([]);
  openModal('tx-modal');
}
function openEditTx(id) {
  editingTx=state.transactions.find(t=>t.id===id); if(!editingTx)return;
  document.getElementById('tx-modal-title').textContent='Editar Registro';
  document.getElementById('tx-description').value=editingTx.description;
  document.getElementById('tx-amount').value=editingTx.amount;
  document.getElementById('tx-date').value=editingTx.date;
  document.getElementById('tx-category').value=editingTx.category||'tarjeta';
  document.getElementById('tx-type').value=editingTx.type;
  document.getElementById('tx-period').value=editingTx.period;
  document.getElementById('tx-installments').value=editingTx.installments||'12';
  document.getElementById('tx-months').value=editingTx.months||'';
  populateTxCardSelect(editingTx.cardId);
  populateTxTagSelect(editingTx.tag);
  onTxTypeChange(); onTxCategoryChange();
  buildSplitsEditor(editingTx.splits||[]);
  openModal('tx-modal');
}
function populateTxTagSelect(sel) {
  const el=document.getElementById('tx-tag');
  if(!el) return;
  el.innerHTML=`<option value="">Sin etiqueta</option>`+
    state.tags.map(t=>`<option value="${t.id}" ${t.id===sel?'selected':''}>${t.emoji||'🏷️'} ${t.name}</option>`).join('');
}
function populateTxCardSelect(sel) {
  const el=document.getElementById('tx-card');
  el.innerHTML=`<option value="">Sin tarjeta</option>`+
    state.creditCards.map(c=>`<option value="${c.id}" ${c.id===sel?'selected':''}>${c.name}</option>`).join('');
}
function onTxCategoryChange() {
  const cat=document.getElementById('tx-category').value;
  const isMonthly=cat==='recurrente'||cat==='servicio';
  document.getElementById('tx-card-group').style.display=cat==='tarjeta'?'block':'none';
  document.getElementById('tx-type-group').style.display=isMonthly?'none':'block';
  document.getElementById('tx-months-group').style.display=isMonthly?'block':'none';
  if(cat==='prestamo'){document.getElementById('tx-type').value='installment';onTxTypeChange();}
  if(isMonthly){document.getElementById('tx-type').value='single';document.getElementById('installments-group').style.display='none';}
}
function onTxTypeChange() {
  document.getElementById('installments-group').style.display=
    document.getElementById('tx-type').value==='installment'?'block':'none';
}
function buildSplitsEditor(existing) {
  const participants=[{id:'me',name:'Yo (Mi parte)'},...state.people.map(p=>({id:p.id,name:p.name}))];
  const map={}; existing.forEach(s=>{map[s.personId]=s.pct;});
  if(!existing.length&&participants.length){
    const eq=parseFloat((100/participants.length).toFixed(2));
    participants.forEach((p,i)=>{map[p.id]=i===participants.length-1?100-eq*(participants.length-1):eq;});
  }
  document.getElementById('splits-rows').innerHTML=participants.map(p=>{
    const idx=p.id==='me'?-1:state.people.findIndex(x=>x.id===p.id);
    const col=p.id==='me'?{hex:'#a78bfa',bg:'rgba(167,139,250,0.2)'}:getColor(idx);
    const pct=map[p.id]||0;
    return`<div class="split-row" data-pid="${p.id}">
      <div class="split-person-label">
        <div class="person-avatar" style="background:${col.bg};color:${col.hex};width:28px;height:28px;border-radius:8px;font-size:11px">${p.id==='me'?'Yo':initials(p.name)}</div>
        <span style="font-size:13px;font-weight:500">${p.name}</span>
      </div>
      <input class="split-input" type="number" min="0" max="100" step="0.01" value="${pct}"
        oninput="updateSplitAmount()" data-pid="${p.id}" style="text-align:right" placeholder="%">
      <div class="split-amount-display" id="split-amt-${p.id}">—</div>
      <div></div>
    </div>`;
  }).join('');
  updateSplitAmount();
}
function updateSplitAmount() {
  const amount=parseFloat(document.getElementById('tx-amount').value)||0;
  const type=document.getElementById('tx-type').value;
  const inst=parseInt(document.getElementById('tx-installments').value)||1;
  const cuota=type==='installment'?amount/inst:amount;
  let total=0;
  document.querySelectorAll('.split-input').forEach(inp=>{
    const pct=parseFloat(inp.value)||0; total+=pct;
    const el=document.getElementById('split-amt-'+inp.dataset.pid);
    if(el)el.textContent=fmtCLP(cuota*(pct/100));
  });
  const el=document.getElementById('splits-total-val');
  if(el){el.textContent=total.toFixed(2)+'%';el.className=Math.abs(total-100)<0.1?'splits-total-ok':'splits-total-err';}
}
function saveTx() {
  const description=document.getElementById('tx-description').value.trim();
  const amount=parseFloat(document.getElementById('tx-amount').value);
  const date=document.getElementById('tx-date').value;
  const cardId=document.getElementById('tx-card').value;
  const category=document.getElementById('tx-category').value;
  const type=category==='recurrente'?'single':document.getElementById('tx-type').value;
  const period=document.getElementById('tx-period').value;
  const installments=parseInt(document.getElementById('tx-installments').value)||1;
  const months=parseInt(document.getElementById('tx-months').value)||0;
  const tag=document.getElementById('tx-tag')?.value||'';
  if(!description){toast('Ingresa descripción','error');return;}
  if(!amount||amount<=0){toast('Monto inválido','error');return;}
  if(!period){toast('Ingresa período','error');return;}
  const splits=[]; let totalPct=0;
  document.querySelectorAll('.split-input').forEach(inp=>{
    const pct=parseFloat(inp.value)||0;
    if(pct>0){splits.push({personId:inp.dataset.pid,pct});totalPct+=pct;}
  });
  if(Math.abs(totalPct-100)>0.5){toast(`Los % deben sumar 100% (actual: ${totalPct.toFixed(1)}%)`,'error');return;}
  if(editingTx) Object.assign(editingTx,{description,amount,date,cardId,category,type,period,installments,months,tag,splits});
  else state.transactions.push({id:uid(),description,amount,date,cardId,category,type,period,installments,months,tag,splits});
  save(); closeModal('tx-modal'); populatePeriodSelects(); renderPage('transactions');
  toast(editingTx?'Actualizado':'Agregado');
}
function deleteTx(id) {
  askConfirm('¿Eliminar registro?', () => {
    state.transactions = state.transactions.filter(t => t.id !== id);
    save(); renderPage('transactions'); toast('Eliminado');
  });
}

// ══════════════════════════════════════════════════════════
//  TAGS (etiquetas)
// ══════════════════════════════════════════════════════════
const TAG_COLORS=['#6c63ff','#10b981','#3b82f6','#f59e0b','#ef4444','#ec4899','#14b8a6','#f97316','#8b5cf6','#84cc16'];
const TAG_EMOJIS=['🛒','🍽️','✈️','🚗','🏠','💊','🎮','👕','📚','💪','🐾','🎬','🔧','🎁','📱','💡','⛽','🍕'];

function renderTagList() {
  const list=document.getElementById('tag-list');
  if (!list) return;
  if (!state.tags.length) {
    list.innerHTML=`<div style="padding:12px;font-size:13px;color:var(--text-3)">Sin etiquetas. Crea una para empezar.</div>`;
    return;
  }
  list.innerHTML=state.tags.map(t=>`<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
    <div style="width:10px;height:10px;border-radius:50%;background:${t.color||'#6c63ff'}"></div>
    <span style="font-size:16px">${t.emoji||'🏷️'}</span>
    <span style="flex:1;font-size:13px;font-weight:600">${t.name}</span>
    <button class="icon-btn danger" onclick="deleteTag('${t.id}')">🗑️</button>
  </div>`).join('');
}
function openTagModal() {
  document.getElementById('tag-name-input').value='';
  // render emoji picker
  document.getElementById('tag-emoji-picker').innerHTML=TAG_EMOJIS.map((e,i)=>
    `<span class="tag-emoji-opt" onclick="selectTagEmoji('${e}',this)" style="cursor:pointer;font-size:20px;padding:4px;border-radius:6px">${e}</span>`
  ).join('');
  // render color picker
  document.getElementById('tag-color-picker').innerHTML=TAG_COLORS.map(c=>
    `<div class="color-dot" style="background:${c}" onclick="selectTagColor('${c}',this)"></div>`
  ).join('');
  window._tagEmoji='🏷️'; window._tagColor=TAG_COLORS[0];
  openModal('tag-modal');
}
function selectTagEmoji(e,el){window._tagEmoji=e;document.querySelectorAll('.tag-emoji-opt').forEach(x=>x.style.background='');el.style.background='var(--bg-600)';}
function selectTagColor(c,el){window._tagColor=c;document.querySelectorAll('#tag-color-picker .color-dot').forEach(x=>x.classList.remove('selected'));el.classList.add('selected');}
function saveTag() {
  const name=document.getElementById('tag-name-input').value.trim();
  if (!name){toast('Ingresa un nombre','error');return;}
  state.tags.push({id:uid(),name,emoji:window._tagEmoji||'🏷️',color:window._tagColor||TAG_COLORS[0]});
  save(); closeModal('tag-modal'); renderTagList();
  toast('Etiqueta creada');
}
function deleteTag(id) {
  askConfirm('¿Eliminar esta etiqueta?', () => {
    state.tags = state.tags.filter(t => t.id !== id);
    state.transactions.forEach(tx => { if (tx.tag === id) tx.tag = ''; });
    save(); renderTagList(); toast('Etiqueta eliminada');
  });
}

// ── Modal helpers ──────────────────────────────────────────
function openModal(id){document.getElementById(id).classList.add('open');}
function closeModal(id){document.getElementById(id).classList.remove('open');}
document.addEventListener('click',e=>{if(e.target.classList.contains('modal-overlay'))e.target.classList.remove('open');});

// ── Custom Confirm ─────────────────────────────────────────
let _confirmCallback = null;
function askConfirm(msg, callback) {
  document.getElementById('confirm-msg').textContent = msg;
  _confirmCallback = callback;
  openModal('confirm-modal');
}
function doConfirm() {
  closeModal('confirm-modal');
  if (_confirmCallback) _confirmCallback();
  _confirmCallback = null;
}

function onPeriodChange(val) {
  state.currentPeriod=val; save();
  const fp=document.getElementById('filter-period');
  if(fp)fp.value=val;
  const active=document.querySelector('.page.active');
  if(active)renderPage(active.id.replace('page-',''));
}

// ══════════════════════════════════════════════════════════
//  ANNUAL VIEW — por tarjeta, mes a mes
// ══════════════════════════════════════════════════════════
function renderAnnual() {
  const MONTHS=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const yr=annualYear;
  const periods=MONTHS.map((_,i)=>`${yr}-${String(i+1).padStart(2,'0')}`);

  document.getElementById('annual-year-label').textContent=yr;

  // ── Build rows ─────────────────────────────────────────
  // Each "bucket": tarjeta|grupo, prestamo, recurrente, income
  const groupedCardIds=new Set((state.cardGroups||[]).flatMap(g=>g.cardIds));
  const ungroupedCards=state.creditCards.filter(c=>!groupedCardIds.has(c.id));

  const buckets=[
    ...(state.cardGroups||[]).map(g=>({key:'cg_'+g.id,label:'💳 '+g.name,cardIds:g.cardIds,cat:'tarjeta'})),
    ...ungroupedCards.map(c=>({key:'c_'+c.id,label:'💳 '+c.name,cardIds:[c.id],cat:'tarjeta'})),
    {key:'prestamo',label:'🏦 Préstamos',cardIds:null,cat:'prestamo'},
    {key:'recurrente',label:'🔄 Recurrentes',cardIds:null,cat:'recurrente'},
    {key:'servicio',label:'🔌 Servicios',cardIds:null,cat:'servicio'},
  ];

  // Compute matrix: buckets × periods
  function bucketAmountForPeriod(b, period) {
    return state.transactions.reduce((sum,tx)=>{
      const amt=getTxAmountForPeriod(tx,period);
      if(!amt)return sum;
      const cat=tx.category||'tarjeta';
      if(b.cardIds){
        if(cat!=='tarjeta'||!b.cardIds.includes(tx.cardId))return sum;
      } else {
        if(cat!==b.cat)return sum;
      }
      return sum+amt;
    },0);
  }

  // Filter out empty buckets for this year
  const activeBuckets=buckets.filter(b=>periods.some(p=>bucketAmountForPeriod(b,p)>0));

  // Monthly totals (gastos)
  const monthlyGastos=periods.map(p=>state.transactions.reduce((s,tx)=>s+getTxAmountForPeriod(tx,p),0));
  const monthlyIncome=periods.map(p=>calcIncomePeriod(p));
  const monthlyBalance=periods.map((_,i)=>monthlyIncome[i]-monthlyGastos[i]);

  // Column max for color scaling
  const maxGasto=Math.max(1,...monthlyGastos);

  // ── Render header ──────────────────────────────────────
  const headerCols=MONTHS.map((m,i)=>`<th style="min-width:90px;text-align:right">${m}</th>`).join('');

  // ── Render bucket rows ──────────────────────────────────
  function colorCell(val,max){
    if(!val)return'color:var(--text-3)';
    const pct=val/max;
    if(pct>0.7)return'color:#ef4444;font-weight:700';
    if(pct>0.4)return'color:#f59e0b;font-weight:600';
    return'color:var(--text-1);font-weight:600';
  }

  const bucketRows=activeBuckets.map(b=>{
    const cells=periods.map((p,i)=>{
      const amt=bucketAmountForPeriod(b,p);
      return`<td style="text-align:right;${colorCell(amt,maxGasto)};font-size:13px">${amt?fmtCLP(amt):'—'}</td>`;
    }).join('');
    const rowTotal=periods.reduce((s,p)=>s+bucketAmountForPeriod(b,p),0);
    return`<tr>
      <td style="font-size:13px;font-weight:500;white-space:nowrap;padding-right:12px">${b.label}</td>
      ${cells}
      <td style="text-align:right;font-weight:700;color:var(--accent);font-size:13px;border-left:1px solid var(--border)">${fmtCLP(rowTotal)}</td>
    </tr>`;
  }).join('');

  // ── Total row ──────────────────────────────────────────
  const totalCols=monthlyGastos.map((v,i)=>{
    return`<td style="text-align:right;font-weight:800;font-size:14px;color:#ef4444">${v?fmtCLP(v):'—'}</td>`;
  }).join('');
  const grandTotal=monthlyGastos.reduce((a,b)=>a+b,0);

  // ── Income row ─────────────────────────────────────────
  const incomeCols=monthlyIncome.map(v=>
    `<td style="text-align:right;font-size:13px;font-weight:600;color:#10b981">${v?fmtCLP(v):'—'}</td>`
  ).join('');
  const totalIncome=monthlyIncome.reduce((a,b)=>a+b,0);

  // ── Balance row ────────────────────────────────────────
  const balanceCols=monthlyBalance.map(v=>{
    const col=v>=0?'#10b981':'#ef4444';
    return`<td style="text-align:right;font-size:13px;font-weight:700;color:${col}">${(v>=0?'+':'')+fmtCLP(v)}</td>`;
  }).join('');
  const totalBalance=totalIncome-grandTotal;

  const html=`
    <div style="overflow-x:auto">
      <table class="data-table" style="min-width:900px">
        <thead>
          <tr>
            <th style="min-width:160px">Tarjeta / Concepto</th>
            ${headerCols}
            <th style="text-align:right;border-left:1px solid var(--border)">Total año</th>
          </tr>
        </thead>
        <tbody>
          ${bucketRows||`<tr><td colspan="14" style="text-align:center;padding:30px;color:var(--text-3)">Sin gastos registrados para ${yr}</td></tr>`}
          <!-- Separator -->
          <tr style="border-top:2px solid var(--border-hover)">
            <td style="font-size:13px;font-weight:700;color:var(--text-2)">📊 Total Gastos</td>
            ${totalCols}
            <td style="text-align:right;font-weight:800;color:#ef4444;font-size:14px;border-left:1px solid var(--border)">${fmtCLP(grandTotal)}</td>
          </tr>
          <tr>
            <td style="font-size:13px;font-weight:700;color:#10b981">💰 Ingresos</td>
            ${incomeCols}
            <td style="text-align:right;font-weight:800;color:#10b981;font-size:14px;border-left:1px solid var(--border)">${fmtCLP(totalIncome)}</td>
          </tr>
          <tr style="border-top:2px solid var(--border-hover)">
            <td style="font-size:13px;font-weight:800;color:${totalBalance>=0?'#10b981':'#ef4444'}">⚖️ Balance</td>
            ${balanceCols}
            <td style="text-align:right;font-weight:900;font-size:15px;color:${totalBalance>=0?'#10b981':'#ef4444'};border-left:1px solid var(--border)">${(totalBalance>=0?'+':'')+fmtCLP(totalBalance)}</td>
          </tr>
        </tbody>
      </table>
    </div>`;

  document.getElementById('annual-table').innerHTML=html;

  // ── Mini stats ─────────────────────────────────────────
  const bestMonth=monthlyGastos.indexOf(Math.max(...monthlyGastos));
  const activeMonths=monthlyGastos.filter(v=>v>0).length;
  document.getElementById('annual-stats').innerHTML=`
    <div class="stat-card red" style="flex:1"><div class="stat-label">Gasto total ${yr}</div><div class="stat-value red">${fmtCLP(grandTotal)}</div></div>
    <div class="stat-card green" style="flex:1"><div class="stat-label">Ingresos ${yr}</div><div class="stat-value green">${fmtCLP(totalIncome)}</div></div>
    <div class="stat-card ${totalBalance>=0?'green':'red'}" style="flex:1"><div class="stat-label">Balance ${yr}</div><div class="stat-value ${totalBalance>=0?'green':'red'}">${(totalBalance>=0?'+':'')+fmtCLP(totalBalance)}</div></div>
    <div class="stat-card amber" style="flex:1"><div class="stat-label">Mes más caro</div><div class="stat-value amber" style="font-size:18px">${activeMonths?MONTHS[bestMonth]+' '+fmtCLP(monthlyGastos[bestMonth]):'—'}</div></div>`;
}

function annualChangeYear(delta){
  annualYear+=delta;
  renderAnnual();
}

// ══════════════════════════════════════════════════════════
//  IMPORT / EXPORT (Backup)
// ══════════════════════════════════════════════════════════
async function exportData() {
// ... existing exportData ...
  const dataStr = JSON.stringify(state, null, 2);
  const fileName = `finanzapp_backup_${new Date().toISOString().slice(0,10)}.json`;

  try {
    // 1. Desktop Chrome/Edge Native Save File Picker
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: fileName,
          types: [{ description: 'JSON Backup', accept: {'application/json': ['.json']} }]
        });
        const writable = await handle.createWritable();
        await writable.write(dataStr);
        await writable.close();
        toast('Copia de seguridad guardada');
        return;
      } catch (err) {
        if (err.name !== 'AbortError') console.error('Error SaveFilePicker:', err);
        return;
      }
    }

    // 2. Mobile / PWA Native Share (iOS/Android WebViews)
    if (navigator.share && navigator.canShare) {
      const file = new File([dataStr], fileName, { type: 'application/json' });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: 'Respaldo KePago!',
            text: 'Copia de seguridad de tus datos.'
          });
          toast('Guardado / Compartido exitosamente');
          return;
        } catch (err) {
          if (err.name !== 'AbortError') console.error('Error Web Share:', err);
        }
      }
    }
  } catch(e) {}

  // 3. Fallback: Data URI download para versiones antiguas
  const base64 = btoa(unescape(encodeURIComponent(dataStr)));
  const url = 'data:application/json;base64,' + base64;
  const dl = document.createElement('a');
  dl.style.display = 'none';
  dl.href = url;
  dl.download = fileName;
  document.body.appendChild(dl);
  dl.click();
  document.body.removeChild(dl);
  toast('Descarga de respaldo iniciada');
}

function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const imported = JSON.parse(e.target.result);
      if (imported && typeof imported === 'object') {
        state = { ...state, ...imported };
        save();
        alert('Datos importados correctamente. La aplicación se recargará.');
        location.reload();
      } else {
        throw new Error('Formato inválido');
      }
    } catch (err) {
      alert('Error importando datos. Asegúrate de que el archivo es un backup válido de KePago!');
      console.error(err);
    }
    event.target.value = ''; // reset input
  };
  reader.readAsText(file);
}

// ══════════════════════════════════════════════════════════
//  PDF IMPORT / PARSER (Bank Statements)
// ══════════════════════════════════════════════════════════
let pendingImportTxs = [];

function openImportModal() {
  document.getElementById('import-step-1').style.display = 'block';
  document.getElementById('import-step-2').style.display = 'none';
  document.getElementById('pdf-upload').value = '';
  
  // Populate dropdowns
  const cardSel = document.getElementById('import-card');
  cardSel.innerHTML = `<option value="">Selecciona tarjeta...</option>` + 
    state.creditCards.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    
  const periodSel = document.getElementById('import-period');
  const now = new Date();
  const periods = [];
  for(let i=-2; i<=2; i++){
    const d = new Date(now.getFullYear(), now.getMonth()+i, 1);
    periods.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
  }
  periodSel.innerHTML = periods.map(p => `<option value="${p}">${p}</option>`).join('');
  periodSel.value = state.currentPeriod;
  
  openModal('import-modal');
}

async function handlePdfUpload(e) {
  const file = e.target.files[0];
  if(!file) return;
  
  if (!window.pdfjsLib) { toast('PDF.js no está cargado.','error'); return; }
  
  // Use a Blob worker to bypass Cross-Origin restrictions on Web Workers
  if (!pdfjsLib.GlobalWorkerOptions.workerPort) {
    const workerBlob = new Blob(
      [`importScripts('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js');`],
      { type: 'application/javascript' }
    );
    pdfjsLib.GlobalWorkerOptions.workerPort = new Worker(URL.createObjectURL(workerBlob));
  }
  
  toast('Procesando PDF, espera unos segundos...');
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({data: arrayBuffer}).promise;
    let lines = [];
    
    for(let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const items = textContent.items;
        
        // Map Y coordinate to 8-point buckets to group text accurately into rows
        items.forEach(item => { item.ry = Math.round(item.transform[5] / 8) * 8; });
        
        // Strict transitive sort: Y descending, then X ascending
        items.sort((a,b) => {
           if (a.ry !== b.ry) return b.ry - a.ry;
           return a.transform[4] - b.transform[4];
        });
        
        let currentY = null;
        let currentLine = [];
        items.forEach(item => {
            const str = item.str.trim();
            if(!str) return;
            if (currentY === null || item.ry !== currentY) {
                 if(currentLine.length) lines.push(currentLine.join(' '));
                 currentLine = [str];
                 currentY = item.ry;
            } else {
                 currentLine.push(str);
            }
        });
        if(currentLine.length) lines.push(currentLine.join(' '));
    }
    parsePdfText(lines);
  } catch (err) {
    console.error(err);
    toast('Error procesando PDF: ' + err.message, 'error');
  }
}

function isMoney(str) {
   if (str.includes('/')) return false;
   if (/^[A-Za-z]+$/.test(str)) return false;
   return /^[\$\-]?\d{1,3}(?:[\.,]\d{3})*(?:[\.,]\d{1,2})?$/.test(str) || /^[\$\-]?\d+(?:[\.,]\d{1,2})?$/.test(str);
}

function parsePdfText(lines) {
   pendingImportTxs = [];
   const dateRegex = /\b(\d{2}[\/\-]\d{2}(?:[\/\-]\d{2,4})?)\b/;

   lines.forEach((line, index) => {
      const dateMatch = line.match(dateRegex);
      if(!dateMatch) return;
      
      const textAfterDate = line.substring(dateMatch.index + dateMatch[0].length).trim();
      let tokens = textAfterDate.replace(/\$\s+/g, '$').split(/\s+/);
      
      let amountToken = null;
      let amountIndex = -1;
      
      for(let i = tokens.length - 1; i >= 0; i--) {
         if (isMoney(tokens[i]) && parseBankAmount(tokens[i].replace(/[\$\+]/g,'')) > 0) {
             amountToken = tokens[i];
             amountIndex = i;
             break;
         }
      }
      
      if (!amountToken) return;
      
      let amount = parseBankAmount(amountToken.replace(/[\$\+]/g,''));
      
      let descTokens = tokens.slice(0, amountIndex).filter(t => !isMoney(t));
      let desc = descTokens.join(' ').replace(/[\$\-\+]/g, '').trim();
      
      if(desc.length < 2) return;
      
      pendingImportTxs.push({
         id: 'prev_'+index,
         dateOriginal: dateMatch[1],
         description: desc,
         amount: amount,
         selected: true
      });
   });
   
   if (!pendingImportTxs.length) {
     toast('No se encontraron transacciones en este PDF', 'error');
     return;
   }
   
   renderImportPreview();
}

function parseBankAmount(str) {
    const match = str.match(/[\\.,]/g);
    if (!match) return parseFloat(str);
    
    const lastSepIndex = Math.max(str.lastIndexOf('.'), str.lastIndexOf(','));
    const afterSep = str.length - lastSepIndex - 1;
    let clean = str;
    if (afterSep === 2) {
       clean = str.slice(0, lastSepIndex).replace(/[\\.,]/g, '') + '.' + str.slice(lastSepIndex+1);
    } else {
       clean = str.replace(/[\\.,]/g, '');
    }
    return parseFloat(clean);
}

function renderImportPreview() {
  document.getElementById('import-step-1').style.display = 'none';
  document.getElementById('import-step-2').style.display = 'block';
  
  const tbody = document.getElementById('import-tbody');
  tbody.innerHTML = pendingImportTxs.map(tx => `
    <tr>
      <td style="text-align:center"><input type="checkbox" id="cb_${tx.id}" ${tx.selected?'checked':''} style="accent-color:var(--accent);width:16px;height:16px" onchange="toggleImportTx('${tx.id}')"></td>
      <td style="font-size:12px;color:var(--text-3)">${tx.dateOriginal}</td>
      <td style="font-weight:600">${tx.description}</td>
      <td style="text-align:right;font-weight:700;color:var(--accent)">${fmtCLP(tx.amount)}</td>
    </tr>
  `).join('');
}

function toggleImportTx(id) {
  const tx = pendingImportTxs.find(t => t.id === id);
  if (tx) tx.selected = document.getElementById('cb_'+id).checked;
}

function saveImportedTxs() {
  const cardId = document.getElementById('import-card').value;
  const period = document.getElementById('import-period').value;
  
  if (!cardId) { toast('Selecciona la tarjeta destino', 'error'); return; }
  
  const toImport = pendingImportTxs.filter(t => t.selected);
  if (!toImport.length) { toast('No seleccionaste transacciones', 'error'); return; }
  
  const today = new Date().toISOString().slice(0,10);
  
  toImport.forEach(tx => {
    state.transactions.push({
      id: uid(),
      description: tx.description,
      amount: tx.amount,
      date: today, // Can't easily format bank dates natively, fallback to today
      cardId: cardId,
      category: 'tarjeta',
      type: 'single',
      period: period,
      installments: 1,
      months: 0,
      tag: '',
      splits: [{personId: 'me', pct: 100}]
    });
  });
  
  save();
  closeModal('import-modal');
  renderPage('transactions');
  toast(`${toImport.length} gastos importados exitosamente`);
}

// ── Bootstrap ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded',()=>{
  load();
  annualYear=new Date().getFullYear();
  document.querySelectorAll('.nav-item').forEach(n=>n.addEventListener('click',()=>navigate(n.dataset.page)));
  document.getElementById('period-select').addEventListener('change',e=>onPeriodChange(e.target.value));
  document.getElementById('tx-type').addEventListener('change',onTxTypeChange);
  document.getElementById('tx-category').addEventListener('change',onTxCategoryChange);
  document.getElementById('tx-amount').addEventListener('input',updateSplitAmount);
  document.getElementById('tx-installments').addEventListener('input',updateSplitAmount);
  document.getElementById('filter-search').addEventListener('input',e=>{txFilter.search=e.target.value;renderTransactions();});
  document.getElementById('filter-card').addEventListener('change',e=>{txFilter.card=e.target.value;renderTransactions();});
  document.getElementById('filter-category').addEventListener('change',e=>{txFilter.category=e.target.value;renderTransactions();});
  document.getElementById('filter-period').addEventListener('change',e=>{txFilter.period=e.target.value;onPeriodChange(e.target.value);});
  document.getElementById('sum-btn-detail').addEventListener('click',()=>{summaryMode='detail';renderSummary();});
  document.getElementById('sum-btn-card').addEventListener('click',()=>{summaryMode='card';renderSummary();});
  populatePeriodSelects();
  navigate('dashboard');
  renderTagList();
});
