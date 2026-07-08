/* =========================================================
   BATTERY TRACKING SYSTEM PRO
   Multi-property edition — data isolated per property,
   all reads/writes go through the Vercel API backend.
   Security enforced server-side via JWT + SQL property_id
   scoping. Nothing sensitive lives in this file.
========================================================= */

/* ---------- CONFIG — point to your Vercel deployment ---------- */
const API_BASE = window.BATTERY_API_BASE || 'https://battery-tracker-pro.vercel.app';

/* ---------- GLOBAL STATE ---------- */
let batteries  = [];
let stockCount = 0;
let authToken  = null;       // JWT, kept in memory only (not localStorage)
let currentUserName    = '';
let currentUserRole    = '';
let currentPropertyName = '';
let chartInstance = null;
let forecastChartInstance = null;

/* =========================================================
   API HELPER
========================================================= */
async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = 'Bearer ' + authToken;

  const res = await fetch(API_BASE + path, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) }
  });

  if (res.status === 401) {
    // Token expired or invalid — force re-login
    authToken = null;
    currentUserName = '';
    currentUserRole = '';
    showLoginModal();
    throw new Error('Session expired. Please log in again.');
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

/* =========================================================
   TOASTS + SYNC STATE
========================================================= */
function toast(msg, type) {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s';
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

function setSyncState(state) {
  const dot  = document.getElementById('syncDot');
  const text = document.getElementById('syncText');
  dot.className = 'sync-dot' + (state === 'syncing' ? ' syncing' : state === 'error' ? ' error' : '');
  text.textContent = state === 'syncing' ? 'Syncing...' : state === 'error' ? 'Error' : 'Synced';
}

/* =========================================================
   DATA LAYER — backed by the Vercel API
   All functions keep the same signatures as the original
   window.storage version so no rendering code needs changes.
========================================================= */
async function loadAllData() {
  if (!authToken) return;
  setSyncState('syncing');
  try {
    const [batData, stockData] = await Promise.all([
      api('/api/batteries'),
      api('/api/stock')
    ]);
    batteries  = batData.batteries || [];
    stockCount = stockData.count   || 0;
    setSyncState('idle');
  } catch (err) {
    console.error('Load failed:', err);
    setSyncState('error');
    toast('Could not load data: ' + err.message, 'error');
  }
}

async function saveBatteries() {
  // Batteries are saved atomically per-operation via /api/batteries and /api/readings
  // This stub exists so unchanged code paths that call saveBatteries() still work.
}

async function saveStock() {
  try {
    setSyncState('syncing');
    await api('/api/stock', { method: 'POST', body: JSON.stringify({ count: stockCount }) });
    setSyncState('idle');
  } catch (err) {
    setSyncState('error');
    toast('Could not save stock: ' + err.message, 'error');
  }
}

async function saveUsers() {
  // Users are managed via /api/users — this stub exists for compatibility.
}

async function forceSync() {
  await loadAllData();
  renderDashboard();
  toast('Refreshed from server', 'success');
}

async function confirmResetAll() {
  toast('Reset is not available in multi-property mode. Delete individual batteries from the Supervisor panel.', 'error');
}

/* =========================================================
   CLOCK
========================================================= */
function updateClock() {
  document.getElementById('saClock').textContent =
    new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' }) + ' SAST';
}

/* =========================================================
   SIDEBAR / NAV
========================================================= */
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('overlay').classList.toggle('show');
}

function setActiveMenu(section) {
  document.querySelectorAll('.menu-item').forEach(el => {
    el.classList.toggle('active', el.dataset.section === section);
  });
}

/* =========================================================
   LOGIN — property selector + username/password
========================================================= */
async function showLoginModal() {
  // Populate property dropdown
  const select = document.getElementById('propertySelect');
  select.innerHTML = '<option value="">Loading properties...</option>';

  try {
    const { properties } = await api('/api/properties');
    if (!properties || properties.length === 0) {
      select.innerHTML = '<option value="">No properties set up yet</option>';
    } else {
      select.innerHTML = '<option value="">Select your property...</option>' +
        properties.map(p => `<option value="${escapeHtml(p.code)}">${escapeHtml(p.name)}</option>`).join('');
    }
  } catch (err) {
    select.innerHTML = '<option value="">Could not load properties</option>';
  }

  document.getElementById('nameModal').style.display = 'flex';
}

async function loginUser() {
  const propertyCode = document.getElementById('propertySelect').value;
  const username     = document.getElementById('userNameInput').value.trim();
  const password     = document.getElementById('userPasswordInput').value;

  if (!propertyCode) { toast('Please select a property', 'error'); return; }
  if (!username || !password) { toast('Please enter username and password', 'error'); return; }

  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ propertyCode, username, password })
    });

    authToken           = data.token;
    currentUserName     = data.user.username;
    currentUserRole     = data.user.role;
    currentPropertyName = data.user.propertyName;

    document.getElementById('currentUser').textContent =
      `${data.user.username} (${data.user.role}) — ${data.user.propertyName}`;
    document.getElementById('headerPropertyName').textContent = data.user.propertyName;
    document.getElementById('logoutBtn').hidden = false;
    document.getElementById('nameModal').style.display = 'none';
    document.getElementById('userNameInput').value = '';
    document.getElementById('userPasswordInput').value = '';

    await loadAllData();
    renderDashboard();

    if (window.pendingCallback) { window.pendingCallback(); window.pendingCallback = null; }
  } catch (err) {
    toast(err.message, 'error');
  }
}

function logout() {
  authToken = null;
  currentUserName = '';
  currentUserRole = '';
  currentPropertyName = '';
  batteries = [];
  stockCount = 0;
  document.getElementById('currentUser').textContent = '';
  document.getElementById('logoutBtn').hidden = true;
  renderDashboard();
  showLoginModal();
}

/* =========================================================
   SECTIONS
========================================================= */
function showSection(section) {
  document.querySelectorAll('.main-content > div').forEach(div => div.style.display = 'none');
  toggleSidebar();

  if (section === 'dashboard') {
    document.getElementById('dashboardSection').style.display = 'block';
    setActiveMenu('dashboard');
    renderDashboard();
    return;
  }

  if (section === 'predictions') {
    document.getElementById('predictionsSection').style.display = 'block';
    setActiveMenu('predictions');
    renderPredictions();
    return;
  }

  requireName(() => {
    if (section === 'supervisor' && currentUserRole !== 'supervisor' && currentUserRole !== 'developer') {
      toast('Supervisor access only', 'error');
      return;
    }
    if (section === 'supervisor') {
      document.getElementById('supervisorSection').style.display = 'block';
      setActiveMenu('supervisor');
      renderMaintenanceTable();
    }
    if (section === 'technician') {
      document.getElementById('technicianSection').style.display = 'block';
      setActiveMenu('technician');
      renderViewerTable();
    }
  });
}

function requireName(callback) {
  if (currentUserName) { callback(); return; }
  window.pendingCallback = callback;
  showLoginModal();
}

/* =========================================================
   DEVELOPER DASHBOARD
========================================================= */
async function showDeveloperDashboard() {
  const pass = prompt('Developer Password:');
  if (pass !== 'dev123' && currentUserRole !== 'developer') {
    if (pass !== null) toast('Incorrect password', 'error');
    return;
  }
  document.querySelectorAll('.main-content > div').forEach(div => div.style.display = 'none');
  document.getElementById('developerSection').style.display = 'block';
  toggleSidebar();
  await renderUsersTable();
  await renderPropertiesTable();
}

async function createNewUser() {
  const name = document.getElementById('newUsername').value.trim();
  const role = document.getElementById('newUserRole').value;
  if (!name) { toast('Enter a name', 'error'); return; }

  const password = name.charAt(0).toUpperCase() + '123';
  try {
    await api('/api/users', { method: 'POST', body: JSON.stringify({ username: name, password, role }) });
    await renderUsersTable();
    document.getElementById('newUsername').value = '';
    toast(`User created — temporary password: ${password}`, 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function renderUsersTable() {
  const table = document.getElementById('usersTable');
  try {
    const { users } = await api('/api/users');
    let html = '<tr><th>Username</th><th>Role</th><th>Created</th></tr>';
    users.forEach(u => {
      html += `<tr><td>${escapeHtml(u.username)}</td><td>${escapeHtml(u.role)}</td>
        <td style="font-size:12px;color:var(--muted)">${new Date(u.created_at).toLocaleDateString()}</td></tr>`;
    });
    table.innerHTML = html;
  } catch (err) {
    table.innerHTML = `<tr><td colspan="3" style="color:var(--red)">Could not load users</td></tr>`;
  }
}

async function renderPropertiesTable() {
  const wrap = document.getElementById('propertiesTableWrap');
  if (!wrap) return;
  try {
    const { properties } = await api('/api/properties');
    let html = '<h3 style="margin-bottom:14px;">All Properties</h3>';
    html += '<div class="table-wrapper"><table><tr><th>Property</th><th>Code</th></tr>';
    properties.forEach(p => {
      html += `<tr><td>${escapeHtml(p.name)}</td><td><code>${escapeHtml(p.code)}</code></td></tr>`;
    });
    html += '</table></div>';
    wrap.innerHTML = html;
  } catch { wrap.innerHTML = ''; }
}

async function createProperty() {
  const name = document.getElementById('newPropertyName').value.trim();
  const code = document.getElementById('newPropertyCode').value.trim();
  const pass = document.getElementById('newPropertyPassword').value.trim();
  if (!name || !code || !pass) { toast('All fields required', 'error'); return; }
  try {
    await api('/api/properties', { method: 'POST', body: JSON.stringify({ name, code, adminPassword: pass }) });
    document.getElementById('newPropertyName').value = '';
    document.getElementById('newPropertyCode').value = '';
    document.getElementById('newPropertyPassword').value = '';
    await renderPropertiesTable();
    toast(`Property "${name}" created`, 'success');
  } catch (err) { toast(err.message, 'error'); }
}

/* =========================================================
   BATTERIES: ADD
========================================================= */
async function showAddForm() {
  const name = prompt('Battery name:');
  if (!name) return;

  try {
    const { battery } = await api('/api/batteries', {
      method: 'POST',
      body: JSON.stringify({ name })
    });
    batteries.push(battery);
    renderDashboard();
    renderMaintenanceTable();
    toast(`${battery.name} added`, 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function showAddReadingForm() {
  const select = document.getElementById('readingBattery');
  select.innerHTML = '';
  batteries.forEach((b, i) => {
    select.innerHTML += `<option value="${i}">${escapeHtml(b.name)}</option>`;
  });
  document.getElementById('readingDateTime').value = new Date().toISOString().slice(0, 16);
  document.getElementById('readingPercent').value = '';
  document.getElementById('isReplacement').checked = false;
  document.getElementById('readingModal').style.display = 'flex';
}

function showAddReadingFormForBattery(i) {
  document.getElementById('readingBattery').innerHTML =
    `<option value="${i}">${escapeHtml(batteries[i].name)}</option>`;
  document.getElementById('readingPercent').value = batteries[i].percent;
  document.getElementById('readingDateTime').value = new Date().toISOString().slice(0, 16);
  document.getElementById('isReplacement').checked = false;
  document.getElementById('readingModal').style.display = 'flex';
}

async function saveReading() {
  const index        = document.getElementById('readingBattery').value;
  const percent      = parseInt(document.getElementById('readingPercent').value);
  const dateTime     = document.getElementById('readingDateTime').value;
  const isReplacement = document.getElementById('isReplacement').checked;

  if (index === '' || isNaN(percent) || percent < 0 || percent > 100 || !dateTime) {
    toast('Please fill in all fields with a valid percentage (0–100)', 'error');
    return;
  }

  const battery = batteries[index];
  try {
    await api('/api/readings', {
      method: 'POST',
      body: JSON.stringify({ batteryId: battery.id, percent, dateTime, isReplacement })
    });

    // Update local state optimistically
    battery.history.push({ percent, dateTime, isReplacement, technician: currentUserName });
    battery.percent = isReplacement ? 100 : percent;
    if (isReplacement) stockCount = Math.max(0, stockCount - 1);

    document.getElementById('readingModal').style.display = 'none';
    document.getElementById('isReplacement').checked = false;
    renderDashboard();
    renderMaintenanceTable();
    renderViewerTable();
    toast('Reading saved', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function updateStock() {
  const value = prompt('Enter current stock:', stockCount);
  if (value === null) return;
  stockCount = parseInt(value) || 0;
  await saveStock();
  renderDashboard();
  toast('Stock updated', 'success');
}

/* =========================================================
   IMPORT — sends parsed rows to the /api/import endpoint
   (overwrites the old client-side saveReading-per-row approach)
========================================================= */
async function confirmImport() {
  if (!pendingImportRows || pendingImportRows.length === 0) return;

  const btn = document.getElementById('importConfirmBtn');
  btn.disabled = true;
  btn.textContent = 'Importing…';

  try {
    const result = await api('/api/import', {
      method: 'POST',
      body: JSON.stringify({ rows: pendingImportRows })
    });

    await loadAllData();
    renderDashboard();
    renderMaintenanceTable();
    renderViewerTable();

    hideImportModal();
    toast(
      `Imported ${result.imported} reading(s)` +
      (result.created ? `, created ${result.created} battery/batteries` : '') +
      (result.skipped ? `, skipped ${result.skipped} duplicate(s)` : ''),
      'success'
    );
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Confirm import';
    toast(err.message, 'error');
  }
}

/* =========================================================
   PREDICTION ENGINE
   Linear regression on each battery's discharge readings
   (since its last replacement) to estimate:
     - daily discharge rate
     - days until critical (<=30%)
     - days until empty (0%) / likely replacement date
     - confidence label based on sample size + fit quality
   Falls back to fleet-wide average discharge rate when a
   battery has fewer than 2 usable readings.
========================================================= */

function getDischargeSegment(battery){
  const hist = (battery.history || []).slice().sort((a,b) => new Date(a.dateTime) - new Date(b.dateTime));
  let lastReplaceIdx = -1;
  hist.forEach((h,i) => { if(h.isReplacement) lastReplaceIdx = i; });
  return hist.slice(lastReplaceIdx + 1);
}

function linearRegression(points){
  const n = points.length;
  const sumX = points.reduce((s,p) => s + p.x, 0);
  const sumY = points.reduce((s,p) => s + p.y, 0);
  const sumXY = points.reduce((s,p) => s + p.x*p.y, 0);
  const sumX2 = points.reduce((s,p) => s + p.x*p.x, 0);
  const denom = (n * sumX2 - sumX * sumX);
  if(denom === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const meanY = sumY / n;
  const ssTot = points.reduce((s,p) => s + Math.pow(p.y - meanY, 2), 0);
  const ssRes = points.reduce((s,p) => {
    const pred = slope * p.x + intercept;
    return s + Math.pow(p.y - pred, 2);
  }, 0);
  const r2 = ssTot === 0 ? 1 : 1 - (ssRes / ssTot);
  return { slope, intercept, r2 };
}

function fleetAverageDischargeRate(){
  const rates = [];
  batteries.forEach(b => {
    const seg = getDischargeSegment(b);
    if(seg.length >= 2){
      const t0 = new Date(seg[0].dateTime).getTime();
      const points = seg.map(h => ({
        x: (new Date(h.dateTime).getTime() - t0) / 86400000,
        y: h.percent
      }));
      const reg = linearRegression(points);
      if(reg && reg.slope < 0) rates.push(reg.slope);
    }
  });
  if(rates.length === 0) return -3.5;
  return rates.reduce((a,b) => a+b, 0) / rates.length;
}

function predictBattery(battery, fallbackRate){
  const seg = getDischargeSegment(battery);
  const current = battery.percent;

  if(seg.length < 2){
    const rate = fallbackRate;
    const daysToCritical = rate < 0 ? Math.max(0, (current - 30) / Math.abs(rate)) : null;
    const daysToEmpty = rate < 0 ? Math.max(0, current / Math.abs(rate)) : null;
    return { rate, daysToCritical, daysToEmpty, confidence:'low', r2:null, method:'fleet-average estimate', readingCount:seg.length };
  }

  const t0 = new Date(seg[0].dateTime).getTime();
  const points = seg.map(h => ({
    x: (new Date(h.dateTime).getTime() - t0) / 86400000,
    y: h.percent
  }));
  const reg = linearRegression(points);

  if(!reg || reg.slope >= 0){
    return { rate: reg ? reg.slope : 0, daysToCritical:null, daysToEmpty:null, confidence:'low', r2: reg ? reg.r2 : null, method:'insufficient discharge trend', readingCount:seg.length };
  }

  const daysToCritical = current > 30 ? (30 - current) / reg.slope : 0;
  const daysToEmpty    = current > 0  ? (0  - current) / reg.slope : 0;

  let confidence = 'low';
  if(seg.length >= 4 && reg.r2 >= 0.7) confidence = 'high';
  else if(seg.length >= 3 && reg.r2 >= 0.4) confidence = 'medium';
  else if(seg.length >= 2) confidence = 'medium';

  return { rate:reg.slope, daysToCritical, daysToEmpty, confidence, r2:reg.r2, method:'regression', readingCount:seg.length };
}

function buildPredictions(){
  const fallbackRate = fleetAverageDischargeRate();
  return batteries.map(b => ({ battery:b, prediction:predictBattery(b, fallbackRate) }));
}

function buildReorderForecast(predictions){
  const buckets = { within7:0, within14:0, within30:0, beyond:0, unknown:0 };
  predictions.forEach(({battery, prediction}) => {
    if(battery.percent <= 30){ buckets.within7++; return; }
    const d = prediction.daysToCritical;
    if(d === null || d === undefined){ buckets.unknown++; return; }
    if(d <= 7) buckets.within7++;
    else if(d <= 14) buckets.within14++;
    else if(d <= 30) buckets.within30++;
    else buckets.beyond++;
  });
  return buckets;
}

function formatDays(d){
  if(d === null || d === undefined) return 'Not enough trend data';
  if(d <= 0) return 'Now / overdue';
  if(d < 1) return '< 1 day';
  return Math.round(d) + (Math.round(d) === 1 ? ' day' : ' days');
}

function confidenceBadge(level){
  const map = { high:'High', medium:'Medium', low:'Low' };
  return `<span class="conf-${level}"><i class="fas fa-circle" style="font-size:8px;"></i> ${map[level]}</span>`;
}

/* =========================================================
   DASHBOARD
========================================================= */
function renderDashboard(){
  document.getElementById('stockCountDisplay').textContent = authToken ? stockCount : '–';
  document.getElementById('healthyCount').textContent = batteries.filter(b => b.percent > 60).length;
  document.getElementById('criticalCount').textContent = batteries.filter(b => b.percent <= 30).length;

  const predictions = buildPredictions();
  const forecast = buildReorderForecast(predictions);
  const needSoon = forecast.within7 + forecast.within14;
  let runwayMsg = '';
  if(!authToken){
    runwayMsg = 'Log in to see data';
  } else if(needSoon > stockCount){
    runwayMsg = `<span style="color:var(--red);font-weight:600;">Shortfall: need ~${needSoon}, have ${stockCount}</span>`;
  } else {
    runwayMsg = `Covers next 14 days (~${needSoon} needed)`;
  }
  document.getElementById('stockRunwaySub').innerHTML = runwayMsg;

  renderChart();
  renderLifeTable(predictions);
  renderAlerts(predictions, forecast);
}

function renderAlerts(predictions, forecast){
  const alertBox = document.getElementById('dashboardAlert');
  let html = '';

  if(!authToken){
    html = `<div class="alert"><strong>Please log in</strong> to view your property's battery data.</div>`;
    alertBox.innerHTML = html;
    return;
  }

  if(forecast.within7 + forecast.within14 > stockCount){
    html += `<div class="alert low"><strong>STOCK SHORTFALL FORECAST</strong>
      ${forecast.within7 + forecast.within14} batteries are predicted to need replacement within 14 days, but only ${stockCount} are in stock.</div>`;
  } else if(stockCount <= 20){
    html += `<div class="alert low"><strong>LOW STOCK ALERT</strong> Only ${stockCount} batteries remaining.</div>`;
  }

  batteries.forEach(b => {
    if(b.percent <= 30){
      html += `<div class="alert low"><strong>${escapeHtml(b.name)}</strong> is critical at ${b.percent}%</div>`;
    }
  });

  alertBox.innerHTML = html;
}

function renderChart(){
  const ctx = document.getElementById('statusChart');
  if(chartInstance) chartInstance.destroy();
  chartInstance = new Chart(ctx, {
    type:'bar',
    data:{
      labels: batteries.map(b => b.name),
      datasets:[{
        label:'Battery %',
        data: batteries.map(b => b.percent),
        backgroundColor: batteries.map(b => b.percent > 60 ? '#22c55e' : b.percent > 30 ? '#eab308' : '#ef4444'),
        borderRadius:6
      }]
    },
    options:{
      responsive:true,
      plugins:{ legend:{ display:false } },
      scales:{ y:{ min:0, max:100 } }
    }
  });
}

function renderLifeTable(predictions){
  const table = document.getElementById('dashboardLifeTable');
  let html = `<tr><th>Battery</th><th>Current %</th><th>Status</th><th>Predicted days to critical</th></tr>`;
  if(predictions.length === 0){
    table.innerHTML = html + `<tr class="empty-row"><td colspan="4">${authToken ? 'No batteries tracked yet' : 'Log in to view'}</td></tr>`;
    return;
  }
  predictions.forEach(({battery:b, prediction:p}) => {
    html += `<tr>
      <td>${escapeHtml(b.name)}</td>
      <td>${b.percent}%</td>
      <td>${statusBadge(b.percent)}</td>
      <td>${formatDays(p.daysToCritical)}</td>
    </tr>`;
  });
  table.innerHTML = html;
}

function statusBadge(percent){
  const cls = percent > 60 ? 'green' : percent > 30 ? 'yellow' : 'red';
  const label = percent > 60 ? 'Healthy' : percent > 30 ? 'Warning' : 'Critical';
  return `<span class="badge ${cls}">${label}</span>`;
}

/* =========================================================
   PREDICTIONS SECTION
========================================================= */
function renderPredictions(){
  const predictions = buildPredictions();
  const forecast = buildReorderForecast(predictions);

  document.getElementById('forecastBar').innerHTML = `
    <div class="forecast-chip danger"><div class="n">${forecast.within7}</div><div class="l">Critical within 7 days</div></div>
    <div class="forecast-chip warn"><div class="n">${forecast.within14}</div><div class="l">Within 8–14 days</div></div>
    <div class="forecast-chip"><div class="n">${forecast.within30}</div><div class="l">Within 15–30 days</div></div>
    <div class="forecast-chip"><div class="n">${forecast.beyond}</div><div class="l">Beyond 30 days</div></div>
  `;

  renderForecastChart(forecast);

  const needSoon = forecast.within7 + forecast.within14;
  const note = document.getElementById('forecastNote');
  if(needSoon > stockCount){
    note.innerHTML = `<strong style="color:var(--red);">Reorder recommended:</strong> ${needSoon} batteries forecast to hit critical within 14 days, exceeding current stock of ${stockCount}. Consider ordering at least ${needSoon - stockCount} more.`;
  } else {
    note.innerHTML = `Current stock of ${stockCount} comfortably covers the ${needSoon} batteries forecast to need replacement in the next 14 days.`;
  }
  if(forecast.unknown > 0) note.innerHTML += ` ${forecast.unknown} battery/batteries don't have enough history yet.`;

  renderPredictionTable(predictions);
}

function renderForecastChart(forecast){
  const ctx = document.getElementById('forecastChart');
  if(forecastChartInstance) forecastChartInstance.destroy();
  forecastChartInstance = new Chart(ctx, {
    type:'bar',
    data:{
      labels:['0–7 days','8–14 days','15–30 days','30+ days'],
      datasets:[{
        label:'Batteries reaching critical',
        data:[forecast.within7, forecast.within14, forecast.within30, forecast.beyond],
        backgroundColor:['#ef4444','#eab308','#22c55e','#9ca3af'],
        borderRadius:6
      }]
    },
    options:{
      responsive:true,
      plugins:{ legend:{ display:false } },
      scales:{ y:{ beginAtZero:true, ticks:{ precision:0 } } }
    }
  });
}

function renderPredictionTable(predictions){
  const table = document.getElementById('predictionTable');
  let html = `<tr>
    <th>Battery</th><th>Current %</th><th>Discharge rate</th>
    <th>Days to critical</th><th>Days to empty</th><th>Confidence</th><th>Basis</th>
  </tr>`;
  if(predictions.length === 0){
    table.innerHTML = html + `<tr class="empty-row"><td colspan="7">No batteries tracked yet</td></tr>`;
    return;
  }
  predictions
    .slice().sort((a,b) => (a.prediction.daysToCritical ?? Infinity) - (b.prediction.daysToCritical ?? Infinity))
    .forEach(({battery:b, prediction:p}) => {
      html += `<tr>
        <td>${escapeHtml(b.name)}</td>
        <td>${b.percent}%</td>
        <td>${p.rate ? Math.abs(p.rate).toFixed(1) + '%/day' : '–'}</td>
        <td>${formatDays(p.daysToCritical)}</td>
        <td>${formatDays(p.daysToEmpty)}</td>
        <td>${confidenceBadge(p.confidence)}</td>
        <td style="font-size:12.5px;color:var(--muted);">${p.method} (${p.readingCount} readings)</td>
      </tr>`;
    });
  table.innerHTML = html;
}

/* =========================================================
   MAINTENANCE / VIEWER TABLES
========================================================= */
function renderMaintenanceTable(){
  const table = document.getElementById('maintTable');
  const search = document.getElementById('searchInput').value.toLowerCase();
  let html = `<tr><th>Battery</th><th>%</th><th>Status</th><th>Action</th></tr>`;
  const filtered = batteries.filter(b => b.name.toLowerCase().includes(search));
  if(filtered.length === 0){
    table.innerHTML = html + `<tr class="empty-row"><td colspan="4">No batteries match</td></tr>`;
    return;
  }
  batteries.forEach((b,i) => {
    if(!b.name.toLowerCase().includes(search)) return;
    html += `<tr>
      <td>${escapeHtml(b.name)}</td>
      <td>${b.percent}%</td>
      <td>${statusBadge(b.percent)}</td>
      <td><button class="btn-orange btn-sm" onclick="showAddReadingFormForBattery(${i})">Add Reading</button></td>
    </tr>`;
  });
  table.innerHTML = html;
}

function renderViewerTable(){
  const table = document.getElementById('viewerTable');
  let html = `<tr><th>Battery</th><th>%</th><th>Status</th><th>Action</th></tr>`;
  if(batteries.length === 0){
    table.innerHTML = html + `<tr class="empty-row"><td colspan="4">No batteries tracked yet</td></tr>`;
    return;
  }
  batteries.forEach((b,i) => {
    html += `<tr>
      <td>${escapeHtml(b.name)}</td>
      <td>${b.percent}%</td>
      <td>${statusBadge(b.percent)}</td>
      <td><button class="btn-orange btn-sm" onclick="showAddReadingFormForBattery(${i})">Update</button></td>
    </tr>`;
  });
  table.innerHTML = html;
}

/* =========================================================
   EXPORT
========================================================= */
function showViewData(){
  const table = document.getElementById('allDataTable');
  let html = `<tr><th>Date</th><th>Battery</th><th>%</th><th>Type</th><th>Technician</th></tr>`;
  const rows = [];
  batteries.forEach(b => { b.history.forEach(h => rows.push({ ...h, batteryName: b.name })); });
  rows.sort((a,b) => new Date(b.dateTime) - new Date(a.dateTime));
  if(rows.length === 0){
    html += `<tr class="empty-row"><td colspan="5">No readings logged yet</td></tr>`;
  } else {
    rows.forEach(h => {
      html += `<tr>
        <td>${escapeHtml(h.dateTime)}</td>
        <td>${escapeHtml(h.batteryName)}</td>
        <td>${h.percent}%</td>
        <td>${h.isReplacement ? 'Replacement' : 'Reading'}</td>
        <td>${escapeHtml(h.technician)}</td>
      </tr>`;
    });
  }
  table.innerHTML = html;
  document.getElementById('viewDataModal').style.display = 'flex';
}

function hideViewDataModal(){
  document.getElementById('viewDataModal').style.display = 'none';
}

function exportToPDF(){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFillColor(255,98,0);
  doc.rect(0,0,210,38,'F');
  doc.setTextColor(255,255,255);
  doc.setFontSize(22);
  doc.text('Battery Tracking Report', 105, 16, {align:'center'});
  doc.setFontSize(12);
  doc.text(currentPropertyName || 'Battery Tracking System PRO', 105, 25, {align:'center'});
  let rows = [];
  batteries.forEach(b => {
    b.history.forEach(h => {
      rows.push([h.dateTime, b.name, h.percent+'%', h.isReplacement ? 'Replacement' : 'Reading', h.technician]);
    });
  });
  if(rows.length === 0) rows.push(['-','No Data','-','-','-']);
  doc.autoTable({ startY:48, head:[['Date','Battery','Percentage','Type','Technician']], body:rows, headStyles:{ fillColor:[255,98,0] } });
  doc.save('Battery_Tracking_Report.pdf');
}

function exportCriticalBatteriesToPDF(){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const critical = batteries.filter(b => b.percent <= 30);
  const predictions = buildPredictions();
  const predictionByName = {};
  predictions.forEach(p => { predictionByName[p.battery.name] = p.prediction; });
  doc.setFillColor(239,68,68);
  doc.rect(0,0,210,38,'F');
  doc.setTextColor(255,255,255);
  doc.setFontSize(22);
  doc.text('Critical Batteries Report', 105, 16, {align:'center'});
  doc.setFontSize(12);
  doc.text(currentPropertyName || 'Battery Tracking System PRO', 105, 25, {align:'center'});
  doc.setFontSize(9);
  doc.text(`Generated ${new Date().toLocaleString('en-ZA',{timeZone:'Africa/Johannesburg'})} SAST  •  ${critical.length} battery/batteries at or below 30%`, 105, 32, {align:'center'});
  let rows = [];
  critical.slice().sort((a,b) => a.percent-b.percent).forEach(b => {
    const p = predictionByName[b.name];
    rows.push([b.name, b.percent+'%', p ? formatDays(p.daysToCritical) : '–', p ? formatDays(p.daysToEmpty) : '–', p ? p.confidence : '–']);
  });
  if(rows.length === 0) rows.push(['-','No critical batteries right now','-','-','-']);
  doc.autoTable({ startY:46, head:[['Battery','Current %','Days to critical','Days to empty','Confidence']], body:rows, headStyles:{ fillColor:[239,68,68] } });
  doc.save('Critical_Batteries_Report.pdf');
}

function exportToCSV(){
  let csv = 'Date,Battery,Percentage,Type,Technician\n';
  batteries.forEach(b => {
    b.history.forEach(h => {
      csv += `"${h.dateTime}","${b.name}","${h.percent}%","${h.isReplacement ? 'Replacement' : 'Reading'}","${h.technician}"\n`;
    });
  });
  const blob = new Blob([csv], {type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = 'Battery_Tracking_Report.csv';
  document.body.appendChild(link); link.click();
  document.body.removeChild(link); URL.revokeObjectURL(url);
}

/* =========================================================
   IMPORT DATA (CSV / PDF) — parse client-side, send to API
========================================================= */
let pendingImportRows = null;

function showImportModal(){
  resetImportUI();
  document.getElementById('importModal').style.display = 'flex';
}

function hideImportModal(){
  document.getElementById('importModal').style.display = 'none';
  resetImportUI();
}

function resetImportUI(){
  pendingImportRows = null;
  document.getElementById('importFileInput').value = '';
  document.getElementById('importStatus').innerHTML = '';
  document.getElementById('importPreviewWrap').style.display = 'none';
  document.getElementById('importDropzone').style.display = 'block';
}

function cancelImportPreview(){ resetImportUI(); }

document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('importFileInput');
  const zone  = document.getElementById('importDropzone');
  if(!input || !zone) return;
  input.addEventListener('change', e => { if(e.target.files?.[0]) handleImportFile(e.target.files[0]); });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.style.borderColor='var(--orange)'; zone.style.background='var(--orange-soft)'; });
  zone.addEventListener('dragleave', () => { zone.style.borderColor='var(--border)'; zone.style.background='transparent'; });
  zone.addEventListener('drop', e => { e.preventDefault(); zone.style.borderColor='var(--border)'; zone.style.background='transparent'; if(e.dataTransfer.files?.[0]) handleImportFile(e.dataTransfer.files[0]); });
});

function importStatusHTML(message, type){
  const cls = type === 'error' ? 'low' : type === 'warn' ? 'warn' : '';
  return `<div class="alert ${cls}">${message}</div>`;
}

async function handleImportFile(file){
  const statusEl = document.getElementById('importStatus');
  statusEl.innerHTML = importStatusHTML('Reading file…');
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const isCsv = file.type === 'text/csv' || /\.csv$/i.test(file.name);
  if(!isPdf && !isCsv){ statusEl.innerHTML = importStatusHTML('Unsupported file type.','error'); return; }
  try {
    let rawRows;
    if(isCsv){ const text = await file.text(); rawRows = parseCSV(text); }
    else { rawRows = await parsePDF(file); }
    const { valid, errors } = normalizeImportRows(rawRows);
    if(valid.length === 0){ statusEl.innerHTML = importStatusHTML('No usable rows found.','error'); return; }
    pendingImportRows = valid;
    renderImportPreview(valid, errors);
  } catch(err){ statusEl.innerHTML = importStatusHTML('Could not read file: ' + err.message,'error'); }
}

function parseCSV(text){
  const lines = text.split(/\r\n|\n|\r/).filter(l => l.trim().length > 0);
  if(lines.length === 0) return [];
  const rows = lines.map(parseCSVLine);
  const header = rows[0].map(h => h.trim().toLowerCase());
  return rows.slice(1).map(cells => {
    const row = {};
    header.forEach((h,i) => { row[h] = (cells[i]||'').trim(); });
    return row;
  });
}

function parseCSVLine(line){
  const cells = []; let cur = ''; let inQuotes = false;
  for(let i=0;i<line.length;i++){
    const c = line[i];
    if(inQuotes){ if(c==='"'){ if(line[i+1]==='"'){cur+='"';i++;} else inQuotes=false; } else cur+=c; }
    else { if(c==='"') inQuotes=true; else if(c===','){ cells.push(cur); cur=''; } else cur+=c; }
  }
  cells.push(cur); return cells;
}

async function parsePDF(file){
  if(!window.pdfjsLib) throw new Error('PDF reader library not loaded. Try CSV instead.');
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const buffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({data:buffer}).promise;
  let words = [];
  for(let p=1;p<=pdf.numPages;p++){
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    content.items.forEach(item => { const txt=item.str.trim(); if(txt) words.push({text:txt,x:item.transform[4],y:Math.round(item.transform[5])}); });
  }
  const lineMap = new Map();
  words.forEach(w => {
    const key = w.y; let bucket = null;
    for(const k of lineMap.keys()){ if(Math.abs(k-key)<=2){bucket=k;break;} }
    if(bucket===null) bucket=key;
    if(!lineMap.has(bucket)) lineMap.set(bucket,[]);
    lineMap.get(bucket).push(w);
  });
  const lines = Array.from(lineMap.entries()).sort((a,b)=>b[0]-a[0]).map(([,ws])=>ws.sort((a,b)=>a.x-b.x).map(w=>w.text));
  const headerIdx = lines.findIndex(cells => cells.some(c=>c.toLowerCase()==='date') && cells.some(c=>c.toLowerCase()==='battery'));
  if(headerIdx===-1) throw new Error('Could not find Date/Battery header row in PDF.');
  const header = lines[headerIdx].map(h=>h.toLowerCase());
  return lines.slice(headerIdx+1).filter(cells=>cells.length>=header.length-1).map(cells => {
    const row={}; header.forEach((h,i)=>{ row[h]=cells[i]||''; }); return row;
  });
}

function normalizeImportRows(rawRows){
  const valid=[]; const errors=[];
  rawRows.forEach((row,idx) => {
    const get = (...names) => { for(const n of names){ if(row[n]!==undefined) return row[n]; } return undefined; };
    const dateRaw    = get('date');
    const batteryName = (get('battery')||'').trim();
    const percentRaw = (get('percentage','%')||'').toString().replace('%','').trim();
    const typeRaw    = (get('type')||'').toString().trim().toLowerCase();
    const technician = (get('technician')||'Imported').toString().trim()||'Imported';
    const percent = parseInt(percentRaw,10);
    const dateTime = normalizeDate(dateRaw);
    if(!batteryName||!dateTime||isNaN(percent)||percent<0||percent>100){ errors.push({row:idx+1,raw:row}); return; }
    valid.push({dateTime, name:batteryName, percent, isReplacement:typeRaw.includes('replace'), technician});
  });
  return {valid, errors};
}

function normalizeDate(raw){
  if(!raw) return null;
  const trimmed = raw.toString().trim();
  const nativeMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2})?$/);
  if(nativeMatch) return nativeMatch[1];
  const d = new Date(trimmed);
  if(isNaN(d.getTime())) return null;
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isDuplicateReading(row){
  const battery = batteries.find(b => b.name.toLowerCase() === row.name.toLowerCase());
  if(!battery) return false;
  return battery.history.some(h => h.dateTime===row.dateTime && h.percent===row.percent && !!h.isReplacement===!!row.isReplacement);
}

function renderImportPreview(rows, errors){
  document.getElementById('importDropzone').style.display = 'none';
  const newBatteryNames = [...new Set(rows.map(r=>r.name).filter(name=>!batteries.some(b=>b.name.toLowerCase()===name.toLowerCase())))];
  const dupeCount = rows.filter(r=>isDuplicateReading(r)).length;
  const importCount = rows.length - dupeCount;
  let statusMsg = `Found ${rows.length} row(s). ${importCount} will be imported, ${dupeCount} already exist and will be skipped.`;
  if(newBatteryNames.length>0) statusMsg += ` ${newBatteryNames.length} new battery/batteries will be created.`;
  if(errors.length>0) statusMsg += ` ${errors.length} row(s) could not be read.`;
  document.getElementById('importStatus').innerHTML = importStatusHTML(statusMsg, importCount===0?'warn':null);
  const table = document.getElementById('importPreviewTable');
  let html = `<tr><th>Date</th><th>Battery</th><th>%</th><th>Type</th><th>Technician</th><th>Status</th></tr>`;
  rows.slice(0,200).forEach(r => {
    const dupe = isDuplicateReading(r);
    html += `<tr style="${dupe?'opacity:0.5;':''}">
      <td>${escapeHtml(r.dateTime)}</td><td>${escapeHtml(r.name)}</td><td>${r.percent}%</td>
      <td>${r.isReplacement?'Replacement':'Reading'}</td><td>${escapeHtml(r.technician)}</td>
      <td>${dupe?'<span class="note-text">Skip</span>':'<span style="color:var(--green);">New</span>'}</td>
    </tr>`;
  });
  if(rows.length>200) html+=`<tr class="empty-row"><td colspan="6">Showing first 200 of ${rows.length}</td></tr>`;
  table.innerHTML = html;
  document.getElementById('importPreviewWrap').style.display = 'block';
  document.getElementById('importConfirmBtn').disabled = importCount===0;
}

/* =========================================================
   UTIL
========================================================= */
function escapeHtml(str){
  if(str===undefined||str===null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

window.onclick = function(e){
  document.querySelectorAll('.modal').forEach(modal => { if(e.target===modal) modal.style.display='none'; });
};

/* =========================================================
   STARTUP
========================================================= */
async function init(){
  setInterval(updateClock, 1000);
  updateClock();
  document.getElementById('loadingOverlay').style.display = 'none';
  renderDashboard();
  await showLoginModal();
}

init();
