/* LAVAARTE OS 1.7.0 — Agente de licencia CyS Master.
 * Cliente separado: NO reutiliza ni modifica el cliente Supabase de órdenes de LAVAARTE.
 * El estado visible se controla mediante cys_empresas + Supabase Realtime.
 */
(function iniciarAgenteCySMaster() {
  'use strict';
  const cfg = window.CYS_MASTER_CONFIG || {};
  const repo = String(cfg.repo || 'lavaarte-main');
  const key = 'cys_vault_' + repo;
  const graceMs = Math.max(1, Number(cfg.offlineGraceHours) || 72) * 60 * 60 * 1000;
  const url = String(cfg.url || '').trim().replace(/\/$/, '');
  const publicKey = String(cfg.publishableKey || '').trim();
  const validUrl = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url);
  const configured = validUrl && publicKey.startsWith('sb_publishable_');
  const desktop = /electron/i.test(navigator.userAgent);
  let client = null;
  let channel = null;
  let validationPromise = null;
  let lastState = null;

  const $ = id => document.getElementById(id);

  function readCache() {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value && typeof value === 'object' ? value : null;
    } catch (_) { return null; }
  }

  function writeCache(value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  function ensureLockScreen() {
    if ($('cys-master-lock-screen')) return;
    const overlay = document.createElement('div');
    overlay.id = 'cys-master-lock-screen';
    overlay.innerHTML = `
      <div class="cys-lock-card">
        <div class="cys-lock-brand">CyS Soluciones · Control de licencia</div>
        <div class="cys-lock-icon" aria-hidden="true">⛔</div>
        <h2 id="cys-lock-title">SERVICIO SUSPENDIDO</h2>
        <p id="cys-lock-msg"></p>
        <button id="cys-license-retry" type="button">Volver a comprobar</button>
        <div class="cys-lock-footer">Producto: <span id="cys-lock-repo-id"></span></div>
      </div>`;
    document.body.appendChild(overlay);
    $('cys-lock-repo-id').textContent = repo;
    $('cys-license-retry').addEventListener('click', () => revalidate(true));
  }

  function setTopStatus(text, title) {
    const badge = $('cys-license-status');
    if (badge) {
      badge.textContent = text;
      badge.title = title || text;
    }
  }

  function lock(title, message) {
    ensureLockScreen();
    $('cys-lock-title').textContent = title;
    $('cys-lock-msg').textContent = message;
    $('cys-master-lock-screen').style.display = 'flex';
    setTopStatus('CyS · suspendido', message);
  }

  function unlock(sourceLabel = 'en línea') {
    const overlay = $('cys-master-lock-screen');
    if (overlay) overlay.style.display = 'none';
    setTopStatus(sourceLabel === 'en línea' ? 'CyS ✓' : 'CyS · sin conexión',
      sourceLabel === 'en línea' ? 'Licencia verificada con CyS Master' : 'Se está usando el último estado de licencia validado');
  }

  function parseExpiry(expiryDate) {
    if (!expiryDate) return null;
    const match = String(expiryDate).match(/^\d{4}-\d{2}-\d{2}/);
    if (!match) return null;
    const d = new Date(match[0] + 'T23:59:59');
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function stateSuspended(state) {
    if (!state) return false;
    const status = String(state.status || 'activo').trim().toLowerCase();
    const expiry = parseExpiry(state.expiryDate || state.expiry_date);
    return state.active === false || ['suspendido', 'suspendida', 'suspended', 'inactivo', 'inactive', 'cancelado', 'cancelada'].includes(status) || Boolean(expiry && Date.now() > expiry.getTime());
  }

  function applyState(state, sourceLabel = 'en línea') {
    lastState = state;
    if (stateSuspended(state)) {
      const expired = Boolean(parseExpiry(state.expiryDate || state.expiry_date) && Date.now() > parseExpiry(state.expiryDate || state.expiry_date).getTime());
      const title = expired ? 'SUSCRIPCIÓN VENCIDA' : 'SERVICIO SUSPENDIDO';
      const message = desktop
        ? (state.msgExe || state.mensaje_bloqueo_exe || (expired ? 'La suscripción de LAVAARTE OS venció. Comunícate con CyS Soluciones para renovarla.' : 'CyS Soluciones suspendió este servicio. Comunícate con administración para conocer el motivo.'))
        : (state.msgWeb || state.mensaje_bloqueo_web || (expired ? 'La suscripción venció. Comunícate con CyS Soluciones para renovarla.' : 'Este servicio está temporalmente suspendido por CyS Soluciones.'));
      lock(title, message);
    } else {
      unlock(sourceLabel);
    }
  }

  function rememberRemoteRow(row) {
    const now = Date.now();
    const state = {
      active: row.active !== false,
      status: row.status || 'activo',
      expiryDate: row.expiry_date || null,
      msgExe: row.mensaje_bloqueo_exe || '',
      msgWeb: row.mensaje_bloqueo_web || '',
      lastValidatedAt: now,
      lastTimestamp: Math.max(now, Number((readCache() || {}).lastTimestamp) || 0)
    };
    writeCache(state);
    applyState(state, 'en línea');
  }

  function tryCachedState() {
    const cached = readCache();
    if (!cached) return false;
    const now = Date.now();
    const lastTimestamp = Number(cached.lastTimestamp) || 0;
    if (lastTimestamp && now + 6 * 60 * 60 * 1000 < lastTimestamp) {
      lock('REVISAR FECHA Y HORA', 'La fecha y hora del equipo parece estar atrasada con respecto al último uso. Corrígela y vuelve a validar la licencia con CyS Soluciones.');
      return true;
    }
    const lastValidatedAt = Number(cached.lastValidatedAt) || 0;
    if (lastValidatedAt && now - lastValidatedAt > graceMs && !stateSuspended(cached)) {
      lock('VALIDACIÓN REQUERIDA', 'No ha sido posible validar esta suscripción con CyS Master dentro del período permitido. Conecta el equipo a Internet y pulsa «Volver a comprobar».');
      return true;
    }
    cached.lastTimestamp = Math.max(now, lastTimestamp);
    writeCache(cached);
    applyState(cached, 'sin conexión');
    return true;
  }

  async function revalidate(manual = false) {
    if (!configured) {
      setTopStatus('CyS · falta URL', 'Configura la URL de Supabase CyS Master en cys-master-config.js');
      if (manual) console.warn('[CyS] Falta configurar CYS_MASTER_CONFIG.url en cys-master-config.js.');
      return { ok: false, reason: 'not-configured' };
    }
    if (validationPromise) return validationPromise;
    validationPromise = (async () => {
      try {
        if (!window.supabase || typeof window.supabase.createClient !== 'function') throw new Error('La librería Supabase no está disponible.');
        if (!client) {
          client = window.supabase.createClient(url, publicKey, {
            auth: { persistSession: false, autoRefreshToken: false },
            realtime: { params: { eventsPerSecond: 5 } }
          });
        }
        const { data, error } = await client
          .from('cys_empresas')
          .select('repo,active,status,expiry_date,mensaje_bloqueo_exe,mensaje_bloqueo_web')
          .eq('repo', repo)
          .maybeSingle();
        if (error) throw error;
        if (!data) {
          const missing = { active: false, status: 'suspendido', msgExe: 'Este producto no está registrado en CyS Master. Registra lavaarte-main en cys_empresas o revisa su identificador.', msgWeb: 'Este producto no está registrado en CyS Master. Comunícate con administración de CyS Soluciones.' };
          writeCache({ ...missing, expiryDate: null, lastValidatedAt: Date.now(), lastTimestamp: Date.now() });
          applyState(missing, 'en línea');
          return { ok: false, reason: 'license-not-found' };
        }
        rememberRemoteRow(data);
        ensureRealtime();
        return { ok: true, data };
      } catch (error) {
        console.warn('[CyS] No se pudo validar la licencia con CyS Master:', error && error.message ? error.message : error);
        const cached = readCache();
        if (cached) {
          tryCachedState();
        } else {
          unlock('sin conexión');
          setTopStatus('CyS · sin validar', 'CyS Master no respondió y todavía no hay una validación local previa. El sistema permanece operativo; revisa la configuración de CyS.');
        }
        return { ok: false, reason: 'connection-error', error: error && error.message ? error.message : String(error) };
      } finally {
        validationPromise = null;
      }
    })();
    return validationPromise;
  }

  function ensureRealtime() {
    if (!client || channel) return;
    channel = client.channel('cys_control_' + repo)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'cys_empresas', filter: 'repo=eq.' + repo
      }, payload => {
        const row = payload.new || {};
        // No desbloquear por un evento sin datos completos.
        if (!Object.prototype.hasOwnProperty.call(row, 'repo')) {
          revalidate(false);
          return;
        }
        rememberRemoteRow(row);
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') setTopStatus('CyS ✓', 'Conectado en tiempo real a CyS Master');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setTopStatus('CyS · reconectando', 'La suscripción en tiempo real no está conectada; se reintentará la validación.');
      });
  }

  // Public API para probar/forzar validación desde consola o menú de soporte.
  window.cysRevalidarLicencia = () => revalidate(true);
  window.cysEstadoLicencia = () => ({ configured, repo, cached: readCache(), state: lastState });

  if (!configured) {
    console.warn('[CyS] Licenciamiento pendiente de configurar: edita cys-master-config.js. No se bloqueará LAVAARTE hasta configurar la URL real del proyecto CyS Master.');
    setTopStatus('CyS · pendiente', 'Falta configurar la URL Supabase del proyecto CyS Master.');
    return;
  }

  // Aplicar inmediatamente el último estado guardado, para no mostrar contenido suspendido mientras carga.
  tryCachedState();
  revalidate(false);
  window.addEventListener('online', () => revalidate(false));
  window.addEventListener('focus', () => revalidate(false));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) revalidate(false); });
  setInterval(() => revalidate(false), 5 * 60 * 1000);
})();
