(() => {
  'use strict';
  const cfg = window.PLADECO_CONFIG || {};
  if (!cfg.url || !cfg.anonKey) {
    const notice = document.getElementById('loginNotice');
    notice.textContent = 'Falta configurar config.js con la URL y la anon key de Supabase.';
    notice.classList.remove('hide');
    notice.classList.add('error');
    return;
  }
  const sb = window.supabase.createClient(cfg.url, cfg.anonKey);

  const state = {
    session: null,
    profile: null,
    isAdmin: false,
    catalogs: { ambitos: [], lineamientos: [], objetivos: [], estados: [], unidades: [] },
    proyectos: [],
    tareas: [],
    currentPage: 'dashboard',
    currentTaskProjectId: null,
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const loginView = $('#loginView');
  const appView = $('#appView');
  const loginForm = $('#loginForm');
  const loginNotice = $('#loginNotice');
  const logoutBtn = $('#logoutBtn');
  const modal = $('#modal');
  const modalCard = $('#modalCard');
  const toastEl = $('#toast');

  // ---- Utilities ----
  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtCurrency(n) {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n || 0);
  }
  function fmtPercent(n) {
    return `${Math.round((n || 0) * 100)}%`;
  }
  function toast(msg, isError = false) {
    toastEl.textContent = msg;
    toastEl.style.background = isError ? '#b23e48' : '#18313e';
    toastEl.classList.remove('hide');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.classList.add('hide'), 4000);
  }
  function openModal(html) {
    modalCard.innerHTML = html;
    modal.classList.remove('hide');
  }
  function closeModal() {
    modal.classList.add('hide');
    modalCard.innerHTML = '';
  }
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  $('#modalClose').addEventListener('click', closeModal);

  const ICON_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  const ICON_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';
  const ICON_WARNING = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';

  function rowActions({ editId, delId, editLabel = 'Editar', delLabel = 'Eliminar' } = {}) {
    return `<div class="row-actions">
      ${editId ? `<button type="button" class="icon-btn icon-edit" data-edit="${editId}" title="${editLabel}" aria-label="${editLabel}">${ICON_EDIT}</button>` : ''}
      ${delId ? `<button type="button" class="icon-btn icon-delete" data-del="${delId}" title="${delLabel}" aria-label="${delLabel}">${ICON_TRASH}</button>` : ''}
    </div>`;
  }

  function confirmDialog(message) {
    return new Promise(resolve => {
      openModal(`
        <div class="confirm-icon">${ICON_WARNING}</div>
        <h3>Advertencia</h3>
        <p class="muted">${escapeHtml(message)}</p>
        <div class="actions">
          <button type="button" class="secondary" id="cdCancel">Cancelar</button>
          <button type="button" class="danger" id="cdOk">Confirmar</button>
        </div>`);
      $('#cdCancel').onclick = () => { closeModal(); resolve(false); };
      $('#cdOk').onclick = () => { closeModal(); resolve(true); };
    });
  }

  function showLoginNotice(msg) {
    loginNotice.textContent = msg;
    loginNotice.classList.remove('hide');
    loginNotice.classList.add('error');
  }
  function hideLoginNotice() { loginNotice.classList.add('hide'); }
  function hideBoot() { $('#bootLoading').classList.add('hide'); }
  function showLogin() { hideBoot(); loginView.classList.remove('hide'); appView.classList.add('hide'); }
  function showApp() { hideBoot(); loginView.classList.add('hide'); appView.classList.remove('hide'); }

  function estadoPillClass(nombre) {
    const n = (nombre || '').toUpperCase();
    if (n.includes('APROB')) return 'pill-green';
    if (n.includes('EJECU')) return 'pill-blue';
    if (n.includes('DISE')) return 'pill-purple';
    if (n.includes('FORMULA')) return 'pill-amber';
    if (n.includes('SIN INICIO')) return 'pill-red';
    return 'pill-gray';
  }
  function avanceCell(avance) {
    const pct = Math.round((avance || 0) * 100);
    return `<div class="mini-bar"><div class="mini-track"><div class="fill" style="width:${pct}%"></div></div><span>${pct}%</span></div>`;
  }

  function catalogSelectOptions(items, current, labelFn) {
    return `<option value="">—</option>` + items.map(i => `<option value="${i.id}" ${i.id === current ? 'selected' : ''}>${escapeHtml(labelFn(i))}</option>`).join('');
  }
  function groupBy(arr, keyFn) {
    return arr.reduce((acc, item) => { const k = keyFn(item); (acc[k] = acc[k] || []).push(item); return acc; }, {});
  }

  // ---- Auth ----
  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') { showLogin(); loginForm.reset(); }
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideLoginNotice();
    const email = $('#email').value.trim();
    const password = $('#password').value;
    const btn = loginForm.querySelector('button');
    btn.disabled = true; btn.textContent = 'Ingresando…';
    const { error } = await sb.auth.signInWithPassword({ email, password });
    btn.disabled = false; btn.textContent = 'Ingresar';
    if (error) { showLoginNotice(error.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos.' : error.message); return; }
    try { await bootAfterLogin(); } catch (err) { console.error(err); showLoginNotice('No se pudo cargar el perfil del usuario: ' + err.message); }
  });

  logoutBtn.addEventListener('click', async () => {
    await sb.auth.signOut();
    state.session = null; state.profile = null;
    showLogin(); loginForm.reset();
  });

  async function loadProfile() {
    const { data, error } = await sb.from('profiles').select('*, unidades(nombre)').eq('id', state.session.user.id).single();
    if (error) throw new Error('Tu cuenta no tiene un perfil asignado. Pide al administrador que te registre en "profiles".');
    state.profile = data;
    state.isAdmin = data.rol === 'admin';
  }

  async function loadCatalogs() {
    const [amb, lin, obj, est, uni] = await Promise.all([
      sb.from('ambitos').select('*').order('numero'),
      sb.from('lineamientos').select('*').order('codigo'),
      sb.from('objetivos').select('*').order('codigo'),
      sb.from('estados').select('*').order('orden'),
      sb.from('unidades').select('*').order('nombre'),
    ]);
    for (const r of [amb, lin, obj, est, uni]) if (r.error) throw r.error;
    state.catalogs = { ambitos: amb.data, lineamientos: lin.data, objetivos: obj.data, estados: est.data, unidades: uni.data };
  }

  async function loadProyectos() {
    const { data, error } = await sb.from('proyectos')
      .select('*, ambitos(id,numero,nombre), lineamientos(id,codigo,nombre), objetivos(id,codigo,descripcion), estados(id,nombre,orden), unidades(id,nombre)')
      .order('nombre');
    if (error) throw error;
    state.proyectos = data;
  }

  async function loadTareas() {
    const { data, error } = await sb.from('tareas').select('*').order('orden');
    if (error) throw error;
    state.tareas = data;
  }

  async function loadAll() { await loadCatalogs(); await loadProyectos(); await loadTareas(); }
  async function reloadData() { await Promise.all([loadProyectos(), loadTareas()]); }

  async function bootAfterLogin() {
    const { data: { session } } = await sb.auth.getSession();
    state.session = session;
    await loadProfile();
    await loadAll();
    renderUserChrome();
    showApp();
    goPage('dashboard');
  }

  function renderUserChrome() {
    const name = state.profile.nombre_completo || state.session.user.email;
    $('#avatar').textContent = (name.trim()[0] || '?').toUpperCase();
    $('#topUser').textContent = name;
    $('#sideUser').innerHTML = `<strong>${escapeHtml(name)}</strong><br>${escapeHtml(state.profile.unidades?.nombre || (state.isAdmin ? 'Administrador' : 'Sin unidad'))}`;
    $$('.admin-only').forEach(el => el.classList.toggle('hide', !state.isAdmin));
    $('.nav button[data-page="admin"]').classList.toggle('hide', !state.isAdmin);
  }

  // ---- Navigation ----
  $$('.nav button[data-page]').forEach(btn => btn.addEventListener('click', () => goPage(btn.dataset.page)));

  function goPage(page) {
    if (page === 'admin' && !state.isAdmin) page = 'dashboard';
    state.currentPage = page;
    $$('.nav button[data-page]').forEach(b => b.classList.toggle('on', b.dataset.page === page));
    $$('.page').forEach(p => p.classList.toggle('on', p.id === page));
    if (page === 'dashboard') renderDashboard();
    if (page === 'projects') renderProjectsTable();
    if (page === 'tasks') renderTasksPage();
  }

  // ---- Dashboard ----
  function populateFilterSelect(sel, items, labelFn) {
    const current = sel.value;
    sel.innerHTML = sel.options[0].outerHTML + items.map(i => `<option value="${i.id}">${escapeHtml(labelFn(i))}</option>`).join('');
    if ([...sel.options].some(o => o.value === current)) sel.value = current;
  }

  function filteredProyectos() {
    const ambito = $('#filterAmbito').value, lineamiento = $('#filterLineamiento').value, objetivo = $('#filterObjetivo').value;
    return state.proyectos.filter(p =>
      (!ambito || p.ambito_id === ambito) && (!lineamiento || p.lineamiento_id === lineamiento) && (!objetivo || p.objetivo_id === objetivo));
  }

  function renderBars(container, rows) {
    if (!rows.length) { container.innerHTML = '<p class="muted">Sin datos.</p>'; return; }
    const max = Math.max(...rows.map(r => r.value), 1);
    container.innerHTML = rows.map(r => `
      <div class="bar">
        <span>${escapeHtml(r.label)}</span>
        <div class="track"><div class="fill" style="width:${Math.max(2, (r.value / max) * 100)}%"></div></div>
        <span>${r.display}</span>
      </div>`).join('');
  }

  function renderDashboard() {
    populateFilterSelect($('#filterAmbito'), state.catalogs.ambitos, a => `${a.numero}. ${a.nombre}`);
    const linSource = $('#filterAmbito').value ? state.catalogs.lineamientos.filter(l => l.ambito_id === $('#filterAmbito').value) : state.catalogs.lineamientos;
    populateFilterSelect($('#filterLineamiento'), linSource, l => l.nombre);
    const objSource = $('#filterLineamiento').value ? state.catalogs.objetivos.filter(o => o.lineamiento_id === $('#filterLineamiento').value) : state.catalogs.objetivos;
    populateFilterSelect($('#filterObjetivo'), objSource, o => o.descripcion);

    const list = filteredProyectos();
    const totalPresupuesto = list.reduce((a, p) => a + Number(p.presupuesto || 0), 0);
    const avanceGeneral = totalPresupuesto ? list.reduce((a, p) => a + Number(p.avance || 0) * Number(p.presupuesto || 0), 0) / totalPresupuesto : 0;
    const ids = new Set(list.map(p => p.id));
    const tareasCompletas = state.tareas.filter(t => ids.has(t.proyecto_id) && Number(t.avance) >= 1).length;

    $('#mAdvance').textContent = fmtPercent(avanceGeneral);
    $('#mProjects').textContent = list.length;
    $('#mBudget').textContent = fmtCurrency(totalPresupuesto);
    $('#mTasks').textContent = tareasCompletas;

    const byAmbito = groupBy(list, p => p.ambitos ? `${p.ambitos.numero}. ${p.ambitos.nombre}` : 'Sin ámbito');
    renderBars($('#ambitoChart'), Object.entries(byAmbito).map(([label, items]) => ({ label, value: items.length, display: items.length })));
    renderBars($('#budgetChart'), Object.entries(byAmbito).map(([label, items]) => {
      const v = items.reduce((a, p) => a + Number(p.presupuesto || 0), 0);
      return { label, value: v, display: fmtCurrency(v) };
    }));
    const topProyectos = [...list].sort((a, b) => Number(b.presupuesto) - Number(a.presupuesto)).slice(0, 10);
    renderBars($('#projectChart'), topProyectos.map(p => ({ label: p.nombre, value: Number(p.avance) * 100, display: fmtPercent(p.avance) })));

    const byLineamiento = groupBy(list.filter(p => p.lineamientos), p => p.lineamientos.nombre);
    renderBars($('#lineamientoChart'), Object.entries(byLineamiento).map(([label, items]) => {
      const avg = items.reduce((a, p) => a + Number(p.avance || 0), 0) / items.length;
      return { label, value: avg * 100, display: fmtPercent(avg) };
    }));
  }

  ['filterAmbito', 'filterLineamiento', 'filterObjetivo'].forEach(id => $('#' + id).addEventListener('change', renderDashboard));

  // ---- Projects page ----
  function renderProjectsTable() {
    const term = ($('#projectSearch').value || '').toLowerCase();
    const rows = state.proyectos.filter(p =>
      !term || p.nombre.toLowerCase().includes(term) || (p.unidades?.nombre || '').toLowerCase().includes(term) || (p.estados?.nombre || '').toLowerCase().includes(term));
    $('#projectRows').innerHTML = rows.map(p => `
      <tr>
        <td>${escapeHtml(p.nombre)}</td>
        <td>${escapeHtml(p.ambitos?.nombre || '—')}</td>
        <td>${escapeHtml(p.unidades?.nombre || '—')}</td>
        <td>${fmtCurrency(p.presupuesto)}</td>
        <td>${avanceCell(p.avance)}</td>
        <td><span class="pill ${estadoPillClass(p.estados?.nombre)}">${escapeHtml(p.estados?.nombre || '—')}</span></td>
        <td>${state.isAdmin ? rowActions({ editId: p.id, delId: p.id }) : ''}</td>
      </tr>`).join('') || `<tr><td colspan="7" class="muted">Sin proyectos.</td></tr>`;
    $$('#projectRows [data-edit]').forEach(b => b.addEventListener('click', () => openProjectModal(b.dataset.edit)));
    $$('#projectRows [data-del]').forEach(b => b.addEventListener('click', () => deleteProject(b.dataset.del)));
  }

  $('#projectSearch').addEventListener('input', renderProjectsTable);
  $('#newProjectBtn').addEventListener('click', () => openProjectModal(null));

  $('#csvBtn').addEventListener('click', () => {
    const term = ($('#projectSearch').value || '').toLowerCase();
    const rows = state.proyectos.filter(p =>
      !term || p.nombre.toLowerCase().includes(term) || (p.unidades?.nombre || '').toLowerCase().includes(term) || (p.estados?.nombre || '').toLowerCase().includes(term));
    const header = ['Proyecto', 'Ambito', 'UTR', 'Presupuesto', 'Avance', 'Estado'];
    const csvRows = rows.map(p => [p.nombre, p.ambitos?.nombre || '', p.unidades?.nombre || '', p.presupuesto, Math.round((p.avance || 0) * 100) + '%', p.estados?.nombre || '']);
    const csv = [header, ...csvRows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'proyectos_pladeco.csv';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  });

  function openProjectModal(id) {
    const p = id ? state.proyectos.find(x => x.id === id) : null;
    const lineamientosFor = p?.ambito_id ? state.catalogs.lineamientos.filter(l => l.ambito_id === p.ambito_id) : state.catalogs.lineamientos;
    const objetivosFor = p?.lineamiento_id ? state.catalogs.objetivos.filter(o => o.lineamiento_id === p.lineamiento_id) : state.catalogs.objetivos;
    openModal(`
      <h3>${p ? 'Editar proyecto' : 'Nuevo proyecto'}</h3>
      <form id="projectForm" class="form-grid">
        <div class="field wide"><label>Nombre</label><input name="nombre" required value="${escapeHtml(p?.nombre || '')}"></div>
        <div class="field"><label>Ámbito</label><select name="ambito_id" id="pfAmbito">${catalogSelectOptions(state.catalogs.ambitos, p?.ambito_id, a => `${a.numero}. ${a.nombre}`)}</select></div>
        <div class="field"><label>Lineamiento</label><select name="lineamiento_id" id="pfLineamiento">${catalogSelectOptions(lineamientosFor, p?.lineamiento_id, l => l.nombre)}</select></div>
        <div class="field"><label>Objetivo</label><select name="objetivo_id" id="pfObjetivo">${catalogSelectOptions(objetivosFor, p?.objetivo_id, o => o.descripcion)}</select></div>
        <div class="field"><label>UTR / Unidad</label><select name="unidad_id">${catalogSelectOptions(state.catalogs.unidades, p?.unidad_id, u => u.nombre)}</select></div>
        <div class="field"><label>Estado</label><select name="estado_id">${catalogSelectOptions(state.catalogs.estados, p?.estado_id, e => e.nombre)}</select></div>
        <div class="field"><label>Presupuesto</label><input type="number" min="0" name="presupuesto" required value="${p?.presupuesto ?? 0}"></div>
        <div class="field"><label>Año inicio</label><input type="number" name="anio_inicio" value="${p?.anio_inicio ?? ''}"></div>
        <div class="field"><label>Año término</label><input type="number" name="anio_termino" value="${p?.anio_termino ?? ''}"></div>
        <div class="field"><label>Meta (0–1)</label><input type="number" step="0.01" min="0" max="1" name="meta" value="${p?.meta ?? 0}"></div>
        <div class="field two"><label>Descripción de meta</label><input name="meta_descripcion" value="${escapeHtml(p?.meta_descripcion || '')}"></div>
        <div class="field"><label>Indicador de seguimiento</label><input name="indicador_seguimiento" value="${escapeHtml(p?.indicador_seguimiento || '')}"></div>
        <div class="field"><label>Financiamiento</label><input name="financiamiento" value="${escapeHtml(p?.financiamiento || '')}"></div>
        <div class="field"><label>Formulador</label><input name="formulador" value="${escapeHtml(p?.formulador || '')}"></div>
        <div class="field"><label>Técnico</label><input name="tecnico" value="${escapeHtml(p?.tecnico || '')}"></div>
        <div class="field"><label>Dirección</label><input name="direccion" value="${escapeHtml(p?.direccion || '')}"></div>
        <div class="field wide"><label>Observaciones</label><textarea name="observaciones">${escapeHtml(p?.observaciones || '')}</textarea></div>
        <div class="actions wide">
          <button type="button" class="secondary" id="pfCancel">Cancelar</button>
          <button class="primary">${p ? 'Guardar cambios' : 'Crear proyecto'}</button>
        </div>
      </form>`);
    $('#pfCancel').onclick = closeModal;
    $('#pfAmbito').addEventListener('change', () => {
      const lin = state.catalogs.lineamientos.filter(l => l.ambito_id === $('#pfAmbito').value);
      $('#pfLineamiento').innerHTML = catalogSelectOptions(lin, null, l => l.nombre);
      $('#pfObjetivo').innerHTML = catalogSelectOptions([], null, () => '');
    });
    $('#pfLineamiento').addEventListener('change', () => {
      const obj = state.catalogs.objetivos.filter(o => o.lineamiento_id === $('#pfLineamiento').value);
      $('#pfObjetivo').innerHTML = catalogSelectOptions(obj, null, o => o.descripcion);
    });
    $('#projectForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = {
        nombre: fd.get('nombre').trim(),
        ambito_id: fd.get('ambito_id') || null,
        lineamiento_id: fd.get('lineamiento_id') || null,
        objetivo_id: fd.get('objetivo_id') || null,
        unidad_id: fd.get('unidad_id') || null,
        estado_id: fd.get('estado_id') || null,
        presupuesto: Number(fd.get('presupuesto')) || 0,
        anio_inicio: fd.get('anio_inicio') ? Number(fd.get('anio_inicio')) : null,
        anio_termino: fd.get('anio_termino') ? Number(fd.get('anio_termino')) : null,
        meta: fd.get('meta') ? Number(fd.get('meta')) : 0,
        meta_descripcion: fd.get('meta_descripcion') || null,
        indicador_seguimiento: fd.get('indicador_seguimiento') || null,
        financiamiento: fd.get('financiamiento') || null,
        formulador: fd.get('formulador') || null,
        tecnico: fd.get('tecnico') || null,
        direccion: fd.get('direccion') || null,
        observaciones: fd.get('observaciones') || null,
      };
      const { error } = id ? await sb.from('proyectos').update(payload).eq('id', id) : await sb.from('proyectos').insert(payload);
      if (error) { toast('Error: ' + error.message, true); return; }
      closeModal();
      await loadProyectos();
      renderProjectsTable();
      if (state.currentPage === 'dashboard') renderDashboard();
      toast(id ? 'Proyecto actualizado.' : 'Proyecto creado.');
    });
  }

  async function deleteProject(id) {
    const p = state.proyectos.find(x => x.id === id);
    const ok = await confirmDialog(`¿Eliminar el proyecto "${p?.nombre}" y todas sus tareas? Esta acción no se puede deshacer.`);
    if (!ok) return;
    const { error } = await sb.from('proyectos').delete().eq('id', id);
    if (error) { toast('Error: ' + error.message, true); return; }
    await reloadData();
    renderProjectsTable();
    toast('Proyecto eliminado.');
  }

  // ---- Tasks page ----
  function canEditProject(p) { return state.isAdmin || (p && p.unidad_id === state.profile.unidad_id); }

  function renderTasksPage() {
    const visibleProyectos = state.isAdmin ? state.proyectos : state.proyectos.filter(p => p.unidad_id === state.profile.unidad_id);
    const select = $('#taskProjectSelect');
    const current = state.currentTaskProjectId && visibleProyectos.some(p => p.id === state.currentTaskProjectId) ? state.currentTaskProjectId : (visibleProyectos[0]?.id || '');
    select.innerHTML = visibleProyectos.map(p => `<option value="${p.id}" ${p.id === current ? 'selected' : ''}>${escapeHtml(p.nombre)}</option>`).join('') || '<option value="">Sin proyectos asignados</option>';
    state.currentTaskProjectId = current || null;
    renderTasksTable();
  }

  $('#taskProjectSelect').addEventListener('change', (e) => { state.currentTaskProjectId = e.target.value || null; renderTasksTable(); });
  $('#newTaskBtn').addEventListener('click', () => openTaskModal(null));

  function renderTasksTable() {
    const proyecto = state.proyectos.find(p => p.id === state.currentTaskProjectId);
    const editable = proyecto ? canEditProject(proyecto) : false;
    $('#newTaskBtn').classList.toggle('hide', !editable);
    if (!proyecto) {
      $('#taskRows').innerHTML = `<tr><td colspan="7" class="muted">Selecciona un proyecto.</td></tr>`;
      $('#taskSummary').textContent = '';
      $('#taskSummary').classList.remove('warning');
      return;
    }
    const tareas = state.tareas.filter(t => t.proyecto_id === proyecto.id).sort((a, b) => a.orden - b.orden);
    $('#taskRows').innerHTML = tareas.map(t => `
      <tr>
        <td>${escapeHtml(t.nombre)}</td>
        <td>${avanceCell(t.avance)}</td>
        <td>${fmtPercent(t.ponderador)}</td>
        <td>${fmtCurrency(t.presupuesto)}</td>
        <td>${t.pagado ? 'Sí' : 'No'}</td>
        <td>${escapeHtml(t.comprobante || '—')}</td>
        <td>${editable ? rowActions({ editId: t.id, delId: t.id }) : ''}</td>
      </tr>`).join('') || `<tr><td colspan="7" class="muted">Sin tareas registradas.</td></tr>`;
    $$('#taskRows [data-edit]').forEach(b => b.addEventListener('click', () => openTaskModal(b.dataset.edit)));
    $$('#taskRows [data-del]').forEach(b => b.addEventListener('click', () => deleteTask(b.dataset.del)));

    const sumPonderador = tareas.reduce((a, t) => a + Number(t.ponderador || 0), 0);
    const summary = $('#taskSummary');
    summary.textContent = `Suma de ponderadores: ${Math.round(sumPonderador * 100)}% · Avance del proyecto: ${fmtPercent(proyecto.avance)}`;
    summary.classList.toggle('warning', Math.abs(sumPonderador - 1) > 0.02);
  }

  function openTaskModal(id) {
    const proyecto = state.proyectos.find(p => p.id === state.currentTaskProjectId);
    if (!proyecto) return;
    const t = id ? state.tareas.find(x => x.id === id) : null;
    openModal(`
      <h3>${t ? 'Editar tarea' : 'Nueva tarea'}</h3>
      <p class="muted">${escapeHtml(proyecto.nombre)}</p>
      <form id="taskForm" class="form-grid">
        <div class="field wide"><label>Nombre</label><input name="nombre" required value="${escapeHtml(t?.nombre || '')}"></div>
        <div class="field"><label>Orden</label><input type="number" name="orden" value="${t?.orden ?? (state.tareas.filter(x => x.proyecto_id === proyecto.id).length + 1)}"></div>
        <div class="field"><label>Avance (0–1)</label><input type="number" step="0.01" min="0" max="1" name="avance" value="${t?.avance ?? 0}"></div>
        <div class="field"><label>Ponderador (0–1)</label><input type="number" step="0.01" min="0" max="1" name="ponderador" required value="${t?.ponderador ?? 0}"></div>
        <div class="field"><label>Presupuesto</label><input type="number" min="0" name="presupuesto" value="${t?.presupuesto ?? 0}"></div>
        <div class="field"><label><input type="checkbox" name="pagado" id="tfPagado" ${t?.pagado ? 'checked' : ''}> Pagado</label></div>
        <div class="field two"><label>Comprobante</label><input name="comprobante" id="tfComprobante" value="${escapeHtml(t?.comprobante || '')}" ${t?.pagado ? '' : 'disabled'}></div>
        <div class="actions wide">
          <button type="button" class="secondary" id="tfCancel">Cancelar</button>
          <button class="primary">${t ? 'Guardar cambios' : 'Crear tarea'}</button>
        </div>
      </form>`);
    $('#tfCancel').onclick = closeModal;
    $('#tfPagado').addEventListener('change', (e) => {
      $('#tfComprobante').disabled = !e.target.checked;
      if (!e.target.checked) $('#tfComprobante').value = '';
    });
    $('#taskForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const pagado = fd.get('pagado') === 'on';
      const payload = {
        proyecto_id: proyecto.id,
        nombre: fd.get('nombre').trim(),
        orden: Number(fd.get('orden')) || 0,
        avance: Number(fd.get('avance')) || 0,
        ponderador: Number(fd.get('ponderador')) || 0,
        presupuesto: Number(fd.get('presupuesto')) || 0,
        pagado,
        comprobante: pagado ? ((fd.get('comprobante') || '').trim() || null) : null,
      };
      const { error } = t ? await sb.from('tareas').update(payload).eq('id', t.id) : await sb.from('tareas').insert(payload);
      if (error) { toast('Error: ' + error.message, true); return; }
      closeModal();
      await reloadData();
      renderTasksTable();
      if (state.currentPage === 'projects') renderProjectsTable();
      toast(t ? 'Tarea actualizada.' : 'Tarea creada.');
    });
  }

  async function deleteTask(id) {
    const ok = await confirmDialog('¿Eliminar esta tarea?');
    if (!ok) return;
    const { error } = await sb.from('tareas').delete().eq('id', id);
    if (error) { toast('Error: ' + error.message, true); return; }
    await reloadData();
    renderTasksTable();
    toast('Tarea eliminada.');
  }

  // ---- Admin: catálogos ----
  const CATALOGS_SPEC = {
    unidades: { label: 'Unidades (UTR)', fields: [{ key: 'nombre', label: 'Nombre', type: 'text' }] },
    estados: { label: 'Estados', fields: [{ key: 'nombre', label: 'Nombre', type: 'text' }, { key: 'orden', label: 'Orden', type: 'number' }] },
    ambitos: { label: 'Ámbitos', fields: [{ key: 'numero', label: 'Número', type: 'number' }, { key: 'nombre', label: 'Nombre', type: 'text' }] },
    lineamientos: { label: 'Lineamientos', fields: [{ key: 'ambito_id', label: 'Ámbito', type: 'select', source: 'ambitos', display: a => `${a.numero}. ${a.nombre}` }, { key: 'codigo', label: 'Código', type: 'text' }, { key: 'nombre', label: 'Nombre', type: 'text' }] },
    objetivos: { label: 'Objetivos', fields: [{ key: 'lineamiento_id', label: 'Lineamiento', type: 'select', source: 'lineamientos', display: l => l.nombre }, { key: 'codigo', label: 'Código', type: 'text' }, { key: 'descripcion', label: 'Descripción', type: 'text' }] },
  };

  $$('[data-catalog]').forEach(b => b.addEventListener('click', () => openCatalogManager(b.dataset.catalog)));
  $('#userAdminBtn').addEventListener('click', openUsersManager);
  $('#importBtn').addEventListener('click', importPladecoData);

  function catalogFieldInput(field, current) {
    if (field.type === 'select') return `<select name="${field.key}" required>${catalogSelectOptions(state.catalogs[field.source], current?.[field.key], field.display)}</select>`;
    return `<input type="${field.type}" name="${field.key}" value="${escapeHtml(current?.[field.key] ?? '')}" ${field.type === 'number' ? '' : 'required'}>`;
  }
  function catalogRowLabel(type, row) {
    return CATALOGS_SPEC[type].fields.map(f => {
      if (f.type === 'select') { const found = state.catalogs[f.source].find(i => i.id === row[f.key]); return found ? f.display(found) : '—'; }
      return row[f.key] ?? '—';
    }).join(' · ');
  }

  function openCatalogManager(type) {
    const spec = CATALOGS_SPEC[type];
    let editingId = null;
    openModal(`
      <h3>Catálogos</h3>
      <div class="field"><label>Catálogo</label><select id="catType">${Object.entries(CATALOGS_SPEC).map(([k, s]) => `<option value="${k}" ${k === type ? 'selected' : ''}>${s.label}</option>`).join('')}</select></div>
      <div class="table-wrap"><table><thead><tr><th>Registro</th><th></th></tr></thead><tbody id="catRows"></tbody></table></div>
      <h3 style="margin-top:18px">Agregar / editar</h3>
      <form id="catForm" class="form-grid"></form>`);

    function renderRows() {
      const list = state.catalogs[type];
      $('#catRows').innerHTML = list.map(row => `
        <tr><td>${escapeHtml(catalogRowLabel(type, row))}</td><td>
          ${rowActions({ editId: row.id, delId: row.id })}
        </td></tr>`).join('') || `<tr><td colspan="2" class="muted">Sin registros.</td></tr>`;
      $$('#catRows [data-edit]').forEach(b => b.addEventListener('click', () => { editingId = b.dataset.edit; renderForm(); }));
      $$('#catRows [data-del]').forEach(b => b.addEventListener('click', () => deleteCatalogRow(b.dataset.del)));
    }
    function renderForm() {
      const current = editingId ? state.catalogs[type].find(r => r.id === editingId) : null;
      $('#catForm').innerHTML = spec.fields.map(f => `<div class="field"><label>${f.label}</label>${catalogFieldInput(f, current)}</div>`).join('') +
        `<div class="actions wide">${editingId ? `<button type="button" class="secondary" id="catCancelEdit">Cancelar edición</button>` : ''}<button class="primary">${editingId ? 'Guardar' : 'Agregar'}</button></div>`;
      if (editingId) $('#catCancelEdit').onclick = () => { editingId = null; renderForm(); };
      $('#catForm').onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const payload = {};
        spec.fields.forEach(f => { payload[f.key] = f.type === 'number' ? (fd.get(f.key) ? Number(fd.get(f.key)) : 0) : (fd.get(f.key) || null); });
        const { error } = editingId ? await sb.from(type).update(payload).eq('id', editingId) : await sb.from(type).insert(payload);
        if (error) { toast('Error: ' + error.message, true); return; }
        editingId = null;
        await loadCatalogs();
        await loadProyectos();
        renderRows(); renderForm();
        toast('Catálogo actualizado.');
      };
    }
    async function deleteCatalogRow(id) {
      const ok = await confirmDialog('¿Eliminar este registro? Puede afectar proyectos que lo usan.');
      if (!ok) return;
      const { error } = await sb.from(type).delete().eq('id', id);
      if (error) { toast('Error: ' + error.message, true); return; }
      await loadCatalogs();
      await loadProyectos();
      renderRows();
    }
    $('#catType').addEventListener('change', () => openCatalogManager($('#catType').value));
    renderRows();
    renderForm();
  }

  // ---- Admin: usuarios ----
  function openUsersManager() {
    openModal(`
      <h3>Usuarios</h3>
      <p class="muted">Las cuentas se crean en Supabase &gt; Authentication. Aquí asignas su nombre, unidad y rol.</p>
      <div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Unidad</th><th>Rol</th><th></th></tr></thead><tbody id="userRows"></tbody></table></div>
      <h3 style="margin-top:18px">Vincular usuario existente</h3>
      <form id="userForm" class="form-grid">
        <div class="field wide"><label>UUID del usuario (Authentication &gt; Users)</label><input name="id" required placeholder="00000000-0000-0000-0000-000000000000"></div>
        <div class="field two"><label>Nombre completo</label><input name="nombre_completo" required></div>
        <div class="field"><label>Rol</label><select name="rol"><option value="utr">UTR</option><option value="admin">Admin</option></select></div>
        <div class="field wide"><label>Unidad</label><select name="unidad_id">${catalogSelectOptions(state.catalogs.unidades, null, u => u.nombre)}</select></div>
        <div class="actions wide"><button class="primary">Guardar usuario</button></div>
      </form>`);

    async function renderUserRows() {
      const { data, error } = await sb.from('profiles').select('*, unidades(nombre)').order('nombre_completo');
      if (error) { toast('Error: ' + error.message, true); return; }
      $('#userRows').innerHTML = data.map(u => `
        <tr>
          <td>${escapeHtml(u.nombre_completo)}</td>
          <td>${escapeHtml(u.unidades?.nombre || '—')}</td>
          <td>${u.rol}</td>
          <td>${rowActions({ delId: u.id, delLabel: 'Quitar perfil' })}</td>
        </tr>`).join('') || `<tr><td colspan="4" class="muted">Sin usuarios.</td></tr>`;
      $$('#userRows [data-del]').forEach(b => b.addEventListener('click', async () => {
        const ok = await confirmDialog('¿Quitar el perfil de este usuario? No elimina su cuenta de Authentication.');
        if (!ok) return;
        const { error } = await sb.from('profiles').delete().eq('id', b.dataset.del);
        if (error) { toast('Error: ' + error.message, true); return; }
        renderUserRows();
      }));
    }
    $('#userForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = { id: fd.get('id').trim(), nombre_completo: fd.get('nombre_completo').trim(), rol: fd.get('rol'), unidad_id: fd.get('unidad_id') || null };
      const { error } = await sb.from('profiles').upsert(payload);
      if (error) { toast('Error: ' + error.message, true); return; }
      e.target.reset();
      renderUserRows();
      toast('Usuario guardado.');
    });
    renderUserRows();
  }

  // ---- Admin: importación inicial ----
  function extractAmbito(str) {
    const m = str.match(/^(\d+)\.?\s*(.*)$/);
    return m ? { numero: parseInt(m[1], 10), nombre: m[2].trim() } : { numero: null, nombre: str.trim() };
  }
  function extractLineamiento(str) {
    const m = str.match(/^LINEAMIENTO\s+([\d.]+)\s*(.*)$/i);
    return m ? { codigo: m[1], nombre: m[2].trim() } : { codigo: str.trim(), nombre: str.trim() };
  }
  function extractObjetivo(str) {
    const m = str.match(/^([\d.]+)\s*(.*)$/);
    return m ? { codigo: m[1], descripcion: m[2].trim() } : { codigo: str.trim(), descripcion: str.trim() };
  }
  const ESTADO_ORDER = ['IDEA', 'FORMULACIÓN', 'DISEÑO', 'DISEÑO-EJECUCIÓN', 'APROBACIÓN', 'EJECUCIÓN-FORMULACIÓN', 'EJECUCION-EJECUCION', 'EJECUCIÓN', 'SIN INICIO'];

  async function importPladecoData() {
    const data = window.pladecoData;
    if (!data || !data.projects) { toast('data.js no está disponible.', true); return; }
    const ok = await confirmDialog(state.proyectos.length
      ? 'Ya existe una cartera cargada. Esto agregará o actualizará proyectos con el mismo nombre y reemplazará sus tareas. ¿Continuar?'
      : `Se importarán ${data.projects.length} proyectos y ${data.tasks.length} tareas desde el Excel fuente. ¿Continuar?`);
    if (!ok) return;
    const btn = $('#importBtn');
    btn.disabled = true; const original = btn.textContent; btn.textContent = 'Importando…';
    try {
      const ambitoMap = new Map();
      for (const nombreCompleto of new Set(data.projects.map(p => p.Ambito))) {
        const { numero, nombre } = extractAmbito(nombreCompleto);
        const { data: row, error } = await sb.from('ambitos').upsert({ numero, nombre }, { onConflict: 'nombre' }).select().single();
        if (error) throw error;
        ambitoMap.set(nombreCompleto, row.id);
      }
      const unidadMap = new Map();
      for (const nm of new Set(data.projects.map(p => (p.UTR || '').trim()).filter(Boolean))) {
        const { data: row, error } = await sb.from('unidades').upsert({ nombre: nm }, { onConflict: 'nombre' }).select().single();
        if (error) throw error;
        unidadMap.set(nm, row.id);
      }
      const estadosUnicos = [...new Set(data.projects.map(p => p.Estado))].sort((a, b) => {
        const ia = ESTADO_ORDER.indexOf(a), ib = ESTADO_ORDER.indexOf(b);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      });
      const estadoMap = new Map();
      for (let i = 0; i < estadosUnicos.length; i++) {
        const { data: row, error } = await sb.from('estados').upsert({ nombre: estadosUnicos[i], orden: i + 1 }, { onConflict: 'nombre' }).select().single();
        if (error) throw error;
        estadoMap.set(estadosUnicos[i], row.id);
      }
      const lineamientoMap = new Map();
      for (const p of data.projects) {
        if (!p.Lineamiento || lineamientoMap.has(p.Lineamiento)) continue;
        const { codigo, nombre } = extractLineamiento(p.Lineamiento);
        const { data: row, error } = await sb.from('lineamientos').upsert({ ambito_id: ambitoMap.get(p.Ambito) || null, codigo, nombre }, { onConflict: 'codigo' }).select().single();
        if (error) throw error;
        lineamientoMap.set(p.Lineamiento, row.id);
      }
      const objetivoMap = new Map();
      for (const p of data.projects) {
        if (!p.Objetivo || objetivoMap.has(p.Objetivo)) continue;
        const { codigo, descripcion } = extractObjetivo(p.Objetivo);
        const { data: row, error } = await sb.from('objetivos').upsert({ lineamiento_id: lineamientoMap.get(p.Lineamiento) || null, codigo, descripcion }, { onConflict: 'codigo' }).select().single();
        if (error) throw error;
        objetivoMap.set(p.Objetivo, row.id);
      }
      const proyectoIdMap = new Map();
      for (const p of data.projects) {
        const nombre = p.Proyecto.trim();
        const payload = {
          nombre,
          ambito_id: ambitoMap.get(p.Ambito) || null,
          lineamiento_id: lineamientoMap.get(p.Lineamiento) || null,
          objetivo_id: objetivoMap.get(p.Objetivo) || null,
          unidad_id: unidadMap.get((p.UTR || '').trim()) || null,
          estado_id: estadoMap.get(p.Estado) || null,
          presupuesto: Math.round(p.Presupuesto || 0),
          anio_inicio: p['Año Inicio'] || null,
          anio_termino: p['Año Termino'] || null,
          meta: p.Meta || 0,
          meta_descripcion: p['Meta Descripción'] || null,
          indicador_seguimiento: p['Indicador Seguimiento'] || null,
          financiamiento: p.Financiamiento || null,
          formulador: p.Formulador || null,
          tecnico: p['Técnico'] || null,
          direccion: p['Dirección'] || null,
          observaciones: p.Observaciones || null,
        };
        const { data: row, error } = await sb.from('proyectos').upsert(payload, { onConflict: 'nombre' }).select().single();
        if (error) throw error;
        proyectoIdMap.set(nombre, row.id);
      }
      const byProyecto = new Map();
      for (const t of data.tasks) {
        const key = t.PROYECTO.trim();
        if (!byProyecto.has(key)) byProyecto.set(key, []);
        byProyecto.get(key).push(t);
      }
      for (const [nombreProyecto, lista] of byProyecto) {
        const proyectoId = proyectoIdMap.get(nombreProyecto);
        if (!proyectoId) continue;
        const proyectoSrc = data.projects.find(p => p.Proyecto.trim() === nombreProyecto);
        const presupuestoTotal = Math.round(proyectoSrc?.Presupuesto || 0);
        let running = 0;
        const rows = lista.map((t, idx) => {
          let share = Math.floor(presupuestoTotal * (t.PONDERADOR || 0));
          if (running + share > presupuestoTotal) share = Math.max(0, presupuestoTotal - running);
          running += share;
          const pagado = (t.PAGADO || '').toUpperCase() === 'SI';
          return {
            proyecto_id: proyectoId,
            nombre: t.TAREA,
            orden: idx + 1,
            avance: t.AVANCE || 0,
            ponderador: t.PONDERADOR || 0,
            presupuesto: share,
            pagado,
            comprobante: pagado ? (t.COMPROBANTE || 'comprobante-importado') : null,
          };
        });
        const { error: delErr } = await sb.from('tareas').delete().eq('proyecto_id', proyectoId);
        if (delErr) throw delErr;
        const { error: insErr } = await sb.from('tareas').insert(rows);
        if (insErr) throw insErr;
      }
      await loadAll();
      goPage(state.currentPage);
      toast('Cartera PLADECO importada correctamente.');
    } catch (err) {
      console.error(err);
      toast('Error al importar: ' + (err.message || err), true);
    } finally {
      btn.disabled = false; btn.textContent = original;
    }
  }

  // ---- Init ----
  (async function init() {
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      state.session = session;
      try { await bootAfterLogin(); } catch (err) { console.error(err); showLoginNotice(err.message); showLogin(); }
    } else {
      showLogin();
    }
  })();
})();
