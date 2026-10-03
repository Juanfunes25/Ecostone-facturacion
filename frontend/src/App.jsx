import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabaseClient.js';
import { api } from './api.js';
import { colorSucursal, nombreCortoSucursal, registrarColoresSucursales } from './lib/coloresSucursal.js';
const SelectorEmpresa = lazy(() => import('./screens/SelectorEmpresa.jsx'));
const CotizacionesD = lazy(() => import('./screens/CotizacionesD.jsx'));
const CatalogoD = lazy(() => import('./screens/CatalogoD.jsx'));
const SalidasD = lazy(() => import('./screens/SalidasD.jsx'));
const InventarioD = lazy(() => import('./screens/InventarioD.jsx'));
const Pos = lazy(() => import('./screens/Pos.jsx'));
const Facturas = lazy(() => import('./screens/Facturas.jsx'));
const Piedra = lazy(() => import('./screens/Piedra.jsx'));
const Cotizaciones = lazy(() => import('./screens/Cotizaciones.jsx'));
const Fabricacion = lazy(() => import('./screens/Fabricacion.jsx'));
const Recetas = lazy(() => import('./screens/Recetas.jsx'));
const Insumos = lazy(() => import('./screens/Insumos.jsx'));
const Inventario = lazy(() => import('./screens/Inventario.jsx'));
const RegistrarProduccion = lazy(() => import('./screens/RegistrarProduccion.jsx'));
const ReporteProduccion = lazy(() => import('./screens/ReporteProduccion.jsx'));
const Trazabilidad = lazy(() => import('./screens/Trazabilidad.jsx'));
const Clientes = lazy(() => import('./screens/Clientes.jsx'));
const Usuarios = lazy(() => import('./screens/Usuarios.jsx'));
const Cierres = lazy(() => import('./screens/Cierres.jsx'));
const Reportes = lazy(() => import('./screens/Reportes.jsx'));
const PuntosEmision = lazy(() => import('./screens/PuntosEmision.jsx'));
const Sucursales = lazy(() => import('./screens/Sucursales.jsx'));
const Dashboard = lazy(() => import('./screens/Dashboard.jsx'));
const Impresora = lazy(() => import('./screens/Impresora.jsx'));
const Bitacora = lazy(() => import('./screens/Bitacora.jsx'));
import { empresaActiva, fijarEmpresa } from './lib/empresa.js';
import { useConexionEnVivo } from './lib/tiempoReal.js';
import Icono, { IsotipoEcoStone } from './components/Icono.jsx';
import { accesoAEmail, claveInterna } from './lib/acceso.js';
import { useActualizacion } from './lib/actualizacion.js';
import { fijarSesionEventos, registrarEvento, reportarLoginFallido } from './lib/eventos.js';
const Antifraude = lazy(() => import('./screens/Antifraude.jsx'));
import BloqueoInactividad from './components/BloqueoInactividad.jsx';
import NotificacionesAlertas from './components/NotificacionesAlertas.jsx';

function PantallaLogin({ onEntrar }) {
  const [acceso, setAcceso] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  async function entrar(e) {
    e.preventDefault();
    setError('');
    setCargando(true);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: await accesoAEmail(acceso),
      password: claveInterna(password),
    });
    setCargando(false);
    if (error) {
      // Varios intentos fallidos seguidos generan alerta para el dueño.
      if (/invalid login credentials/i.test(error.message)) reportarLoginFallido(acceso);
      return setError(
        /invalid login credentials/i.test(error.message) ? 'Usuario o contraseña incorrectos' : error.message
      );
    }
    onEntrar(data.session);
  }

  return (
    <div className="pantalla">
      <form className="tarjeta" onSubmit={entrar}>
        <div className="login-marca">
          <span style={{ background: '#1d1f21', borderRadius: 14, padding: 9, display: 'inline-flex' }}>
            <IsotipoEcoStone tam={34} color="#d8ccb0" />
          </span>
          <span>
            <strong>ECOSTONE</strong>
            <small>Facturación</small>
          </span>
        </div>
        <h1>EcoStone Facturación</h1>
        {error && <div className="error">{error}</div>}
        <input
          placeholder="Usuario o correo"
          autoComplete="username"
          autoCapitalize="none"
          value={acceso}
          onChange={(e) => setAcceso(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Contraseña"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button disabled={cargando} type="submit">
          {cargando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}

const PANTALLAS = [
  { id: 'd-cotizaciones', etiqueta: 'Cotizaciones', grupo: 'Operación', roles: ['admin', 'gerente', 'vendedor', 'cajero', 'ventas'], empresas: ['diserco'], Componente: CotizacionesD },
  { id: 'd-salidas', etiqueta: 'Salidas a proyecto', grupo: 'Operación', roles: ['admin', 'gerente', 'vendedor', 'cajero', 'ventas', 'bodega'], empresas: ['diserco'], Componente: SalidasD },
  { id: 'd-catalogo', etiqueta: 'Productos', grupo: 'Negocio', roles: ['admin', 'gerente', 'vendedor', 'cajero', 'ventas', 'bodega'], empresas: ['diserco'], Componente: CatalogoD },
  { id: 'd-inventario', etiqueta: 'Inventario', grupo: 'Negocio', roles: ['admin', 'gerente', 'vendedor', 'cajero', 'ventas', 'bodega'], empresas: ['diserco'], Componente: InventarioD },
  { id: 'cotizaciones', etiqueta: 'Cotizaciones', grupo: 'Operación', roles: ['admin', 'gerente', 'vendedor', 'cajero', 'ventas'], empresas: ['ecostone'], Componente: Cotizaciones },
  { id: 'pos', etiqueta: 'Venta Directa', grupo: 'Operación', roles: ['admin', 'gerente', 'cajero', 'ventas'], empresas: ['diserco', 'ecostone'], Componente: Pos },
  { id: 'facturas', etiqueta: 'Facturas', grupo: 'Operación', roles: ['admin', 'gerente', 'cajero', 'ventas'], empresas: ['diserco', 'ecostone'], Componente: Facturas },
  { id: 'cierres', etiqueta: 'Cierre de caja', grupo: 'Operación', roles: ['admin', 'gerente', 'cajero'], empresas: ['diserco', 'ecostone'], Componente: Cierres },
  { id: 'registrar-produccion', etiqueta: 'Registrar producción', grupo: 'Fabricación', roles: ['produccion', 'admin', 'gerente'], empresas: ['ecostone'], Componente: RegistrarProduccion },
  { id: 'trazabilidad', etiqueta: 'Trazabilidad de lotes', grupo: 'Fabricación', roles: ['admin', 'gerente', 'bodega'], empresas: ['ecostone'], Componente: Trazabilidad },
  { id: 'reporte-produccion', etiqueta: 'Reporte de producción', grupo: 'Fabricación', roles: ['admin', 'gerente'], empresas: ['ecostone'], Componente: ReporteProduccion },
  { id: 'produccion', etiqueta: 'Órdenes y agenda', grupo: 'Fabricación', roles: ['admin', 'gerente', 'bodega'], empresas: ['ecostone'], Componente: Fabricacion },
  { id: 'recetas', etiqueta: 'Recetas y costos', grupo: 'Fabricación', roles: ['admin', 'gerente'], empresas: ['ecostone'], Componente: Recetas },
  { id: 'insumos', etiqueta: 'Insumos', grupo: 'Fabricación', roles: ['admin', 'gerente', 'bodega'], empresas: ['ecostone'], Componente: Insumos },
  { id: 'inventario', etiqueta: 'Inventario de piedra', grupo: 'Fabricación', roles: ['admin', 'gerente', 'bodega', 'vendedor', 'ventas'], empresas: ['ecostone'], Componente: Inventario },
  { id: 'dashboard', etiqueta: 'Dashboard', grupo: 'Negocio', roles: ['admin', 'gerente'], empresas: ['diserco', 'ecostone'], Componente: Dashboard },
  { id: 'reportes', etiqueta: 'Reportes', grupo: 'Negocio', roles: ['admin', 'gerente'], empresas: ['diserco', 'ecostone'], Componente: Reportes },
  { id: 'catalogo', etiqueta: 'Catálogo de piedra', grupo: 'Negocio', roles: ['admin', 'gerente', 'vendedor'], empresas: ['ecostone'], Componente: Piedra },
  { id: 'clientes', etiqueta: 'Clientes', grupo: 'Negocio', roles: ['admin', 'gerente', 'vendedor', 'ventas'], empresas: ['diserco', 'ecostone'], Componente: Clientes },
  { id: 'antifraude', etiqueta: 'Antifraude', grupo: 'Control', roles: ['admin'], empresas: ['diserco', 'ecostone'], Componente: Antifraude },
  { id: 'bitacora', etiqueta: 'Bitácora', grupo: 'Control', roles: ['admin'], empresas: ['diserco', 'ecostone'], Componente: Bitacora },
  { id: 'puntos-emision', etiqueta: 'CAI / Emisión', grupo: 'Control', roles: ['admin', 'gerente'], empresas: ['diserco', 'ecostone'], Componente: PuntosEmision },
  { id: 'usuarios', etiqueta: 'Usuarios', grupo: 'Control', roles: ['admin'], empresas: ['diserco', 'ecostone'], Componente: Usuarios },
  { id: 'sucursales', etiqueta: 'Planta / sucursal', grupo: 'Control', roles: ['admin'], empresas: ['diserco', 'ecostone'], Componente: Sucursales },
  { id: 'impresora', etiqueta: 'Impresora', grupo: 'Ajustes', roles: ['admin', 'gerente', 'cajero', 'ventas'], empresas: ['diserco', 'ecostone'], Componente: Impresora },
];

const GRUPOS = ['Operación', 'Fabricación', 'Negocio', 'Control', 'Ajustes'];

// Preferencias visuales por computadora (tema y barra lateral compacta).
function leerPreferencia(clave, porDefecto) {
  try {
    return localStorage.getItem(`ecostone-facturacion:${clave}`) ?? porDefecto;
  } catch {
    return porDefecto;
  }
}

function guardarPreferencia(clave, valor) {
  try {
    localStorage.setItem(`ecostone-facturacion:${clave}`, valor);
  } catch {
    // modo privado: no se recuerda
  }
}

function aplicarTema(tema) {
  document.documentElement.dataset.tema = tema;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', tema === 'oscuro' ? '#17181a' : '#1d1f21');
}
aplicarTema(leerPreferencia('tema', 'claro'));


function IndicadorVivo() {
  const conectado = useConexionEnVivo();
  return (
    <span
      className={`nav-vivo ${conectado ? 'conectado' : ''}`}
      title={
        conectado
          ? 'Sincronizado en tiempo real: las ventas y precios de todas las sucursales se actualizan al instante'
          : 'Reconectando la sincronización en tiempo real…'
      }
    >
      <span className="nav-vivo-punto" />
      {conectado ? 'En vivo' : 'Conectando…'}
    </span>
  );
}

function PantallaApp({ session, onSalir }) {
  const [perfil, setPerfil] = useState(null);
  const [sucursales, setSucursales] = useState([]);
  const [error, setError] = useState('');
  const [pantallaActiva, setPantallaActiva] = useState('pos');
  // El QR de la etiqueta abre la app con ?lote=CÓDIGO: se muestra la trazabilidad de ese lote.
  const [loteInicial, setLoteInicial] = useState(() => new URLSearchParams(window.location.search).get('lote'));
  const [filtroFacturas, setFiltroFacturas] = useState(null);
  // Sucursal en la que se está facturando ahora mismo — vive acá (no
  // dentro de cada pantalla) para que el color se pueda aplicar a toda la
  // app (barra de navegación incluida) y no se pierda al cambiar de
  // pantalla y volver.
  const [sucursalActivaId, setSucursalActivaId] = useState('');
  // Facturación avisa cuando hay una orden en curso, para no permitir
  // cambiar de sucursal a medio cobro y mezclar la venta con el punto de
  // emisión de otra sucursal.
  const [carritoOcupado, setCarritoOcupado] = useState(false);
  const [tema, setTema] = useState(() => leerPreferencia('tema', 'claro'));
  const [compacta, setCompacta] = useState(() => leerPreferencia('barra-compacta', window.innerWidth < 1500 ? '1' : '0') === '1');
  const [menuMovil, setMenuMovil] = useState(false);
  const [empresa, setEmpresa] = useState(() => empresaActiva());

  function cambiarTema() {
    const nuevo = tema === 'oscuro' ? 'claro' : 'oscuro';
    setTema(nuevo);
    aplicarTema(nuevo);
    guardarPreferencia('tema', nuevo);
  }

  function alternarCompacta() {
    setCompacta((c) => {
      guardarPreferencia('barra-compacta', c ? '0' : '1');
      return !c;
    });
  }
  const { hayNueva, actualizarAhora } = useActualizacion(carritoOcupado);

  // "Ver facturas" desde Clientes (y similares) navegan a otra pantalla
  // llevando un filtro ya armado, en vez de que el cajero tenga que
  // volver a escribirlo.
  function irA(id, payload) {
    if (id === 'facturas' && payload) setFiltroFacturas(payload);
    if (id === 'trazabilidad' && payload?.lote) setLoteInicial(payload.lote);
    setPantallaActiva(id);
  }

  // El color de cada sucursal viene de la base de datos: se registra antes
  // de guardar la lista para que el primer render ya lo use.
  function fijarSucursales(lista) {
    registrarColoresSucursales(lista);
    setSucursales(lista);
  }

  function recargarSucursales() {
    api.get('/sucursales', session).then(fijarSucursales).catch((e) => setError(e.message));
  }

  fijarSesionEventos(session);
  const [alertasPendientes, setAlertasPendientes] = useState(0);

  // Bitácora de uso: inicio de sesión (una vez por sesión) y cada pantalla
  // que se abre. Sirve para ver quién anda "curioseando" el sistema.
  useEffect(() => {
    if (!perfil) return;
    try {
      const clave = `ecostone-facturacion:sesion-registrada:${session.user?.id}:${session.expires_at ?? ''}`;
      if (!sessionStorage.getItem(clave)) {
        registrarEvento('sesion.inicio', { navegador: navigator.userAgent.slice(0, 120), pantalla: `${window.screen.width}x${window.screen.height}` });
        sessionStorage.setItem(clave, '1');
      }
    } catch {
      registrarEvento('sesion.inicio', {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfil?.id]);

  useEffect(() => {
    if (perfil) registrarEvento('pantalla.ver', { pantalla: pantallaActiva }, sucursalActivaId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pantallaActiva, perfil?.id]);

  useEffect(() => {
    if (loteInicial && perfil && ['admin', 'gerente', 'bodega'].includes(perfil.rol)) {
      setPantallaActiva('trazabilidad');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [perfil?.id]);

  // Calienta los catálogos y descarga en segundo plano las pantallas de uso diario.
  useEffect(() => {
    if (!perfil) return;
    api.precargar(session, perfil.rol);
    if (perfil.rol === 'produccion') return;
    const t = setTimeout(() => {
      for (const f of [() => import('./screens/Cotizaciones.jsx'), () => import('./screens/CotizacionEditor.jsx'), () => import('./screens/Pos.jsx'), () => import('./screens/Facturas.jsx'), () => import('./screens/Inventario.jsx'), () => import('./screens/Clientes.jsx')]) f().catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [perfil?.id, empresa]);

  // Contador de alertas antifraude sin revisar (sólo administradores).
  useEffect(() => {
    if (perfil?.rol !== 'admin') return undefined;
    const revisar = () =>
      api
        .get('/antifraude/alertas/pendientes', session)
        .then((r) => setAlertasPendientes(r.pendientes))
        .catch(() => {});
    revisar();
    const t = setInterval(revisar, 60 * 1000);
    return () => clearInterval(t);
  }, [perfil?.rol, session, pantallaActiva]);

  function salir() {
    registrarEvento('sesion.fin', { pantalla: pantallaActiva });
    setTimeout(onSalir, 150);
  }

  // Carga el perfil y las sucursales de la empresa activa. Quien tiene una sola
  // empresa entra directo; quien tiene las dos elige en el selector.
  useEffect(() => {
    Promise.all([api.get('/perfil', session), api.get('/sucursales', session)])
      .then(([perfil, sucursales]) => {
        const propias = perfil.empresas ?? ['ecostone'];
        const elegida = empresaActiva() && propias.includes(empresaActiva()) ? empresaActiva() : propias.length === 1 ? propias[0] : '';
        if (elegida !== empresaActiva()) {
          fijarEmpresa(elegida);
          setEmpresa(elegida);
        }
        setPerfil(perfil);
        fijarSucursales(sucursales);
        setSucursalActivaId((actual) => (sucursales.some((x) => x.id === actual) ? actual : perfil.sucursal_id || sucursales[0]?.id || ''));
      })
      .catch((e) => setError(e.message));
  }, [session, empresa]);

  function elegirEmpresa(codigo) {
    fijarEmpresa(codigo);
    api.limpiarCache();
    setPantallaActiva('');
    setSucursalActivaId('');
    setEmpresa(codigo);
  }

  function cambiarDeEmpresa() {
    fijarEmpresa('');
    api.limpiarCache();
    setEmpresa('');
  }

  // Un cajero con sucursal fija (perfil.sucursal_id) NUNCA puede cambiarla
  // — así no hay forma de cobrar por error en otra sucursal. Sólo admin/
  // manager sin sucursal fija pueden, y se les pide confirmar cada vez
  // porque es una acción poco frecuente y con consecuencias (factura mal
  // emitida en la sucursal equivocada).
  function cambiarSucursalActiva(nuevoId) {
    const nombre = sucursales.find((s) => s.id === nuevoId)?.nombre ?? '';
    if (!window.confirm(`¿Cambiar a "${nombre}"? Vas a facturar ahí hasta que la cambies de nuevo.`)) return;
    setSucursalActivaId(nuevoId);
  }

  const sucursalActiva = sucursales.find((s) => s.id === sucursalActivaId);
  const colorActivo = useMemo(
    () => colorSucursal(sucursalActivaId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sucursalActivaId, sucursales]
  );

  // Pestaña del navegador y barra de color del sistema (en tablets y
  // celulares) también dicen en qué sucursal se está — útil cuando hay
  // varias ventanas abiertas.
  useEffect(() => {
    const corto = nombreCortoSucursal(sucursalActiva?.nombre);
    document.title = corto ? `${corto} · ${empresa === 'diserco' ? 'DISERCO' : 'EcoStone'} Facturación` : 'EcoStone Facturación';
  }, [sucursalActiva?.nombre, empresa]);

  if (error) {
    return (
      <div className="pantalla">
        <div className="tarjeta">
          <div className="error">{error}</div>
          <button onClick={onSalir}>Salir</button>
        </div>
      </div>
    );
  }

  if (!perfil) {
    return (
      <div className="pantalla">
        <p>Cargando…</p>
      </div>
    );
  }

  if (!empresa) {
    return (
      <Suspense fallback={<div className="pantalla"><p>Cargando…</p></div>}>
        <SelectorEmpresa perfil={perfil} onElegir={elegirEmpresa} onSalir={onSalir} />
      </Suspense>
    );
  }
  const infoEmpresa = (perfil.empresas_info ?? []).find((e) => e.codigo === empresa);
  const variasEmpresas = (perfil.empresas ?? []).length > 1;
  const pantallasVisibles = PANTALLAS.filter((p) => p.roles.includes(perfil.rol) && p.empresas.includes(empresa));
  const actual = pantallasVisibles.find((p) => p.id === pantallaActiva) ?? pantallasVisibles[0];
  const Componente = actual.Componente;
  const puedeCambiarSucursal = !perfil.sucursal_id && sucursales.length > 1;

  if (perfil.rol === 'produccion') {
    return (
      <div className="app-produccion" style={{ '--color-sucursal': colorActivo }}>
        <header className="app-produccion-barra">
          <span className="sidebar-avatar">{(perfil.nombre ?? '?').trim().slice(0, 1).toUpperCase()}</span>
          <strong style={{ flex: 1 }}>{perfil.nombre}</strong>
          <button className="boton-icono" onClick={cambiarTema} title={tema === 'oscuro' ? 'Modo claro' : 'Modo noche'} aria-label="Cambiar tema">
            <Icono nombre={tema === 'oscuro' ? 'sol' : 'luna'} />
          </button>
          <button className="boton-icono" onClick={salir} title="Cerrar sesión" aria-label="Cerrar sesión">
            <Icono nombre="salir" tam={18} />
          </button>
        </header>
        <div className="contenido">
          <Suspense fallback={<p style={{ color: 'var(--text-dim)' }}>Cargando…</p>}>
            <Componente session={session} perfil={perfil} sucursales={sucursales} sucursalId={sucursalActivaId} onCambiarSucursalId={setSucursalActivaId} onCarritoOcupado={setCarritoOcupado} onIrA={irA} loteInicial={loteInicial} />
          </Suspense>
        </div>
        <BloqueoInactividad session={session} perfil={perfil} />
      </div>
    );
  }

  return (
    <div className={`app-shell${compacta ? ' barra-compacta' : ''}${menuMovil ? ' menu-abierto' : ''}`} style={{ '--color-sucursal': colorActivo }}>
      <header className="barra-movil">
        <button className="boton-icono" onClick={() => setMenuMovil(true)} aria-label="Abrir menú">
          <Icono nombre="menu" />
        </button>
        <span className="barra-movil-titulo">{actual.etiqueta}</span>
        {sucursalActiva && <span className="barra-movil-sucursal">{nombreCortoSucursal(sucursalActiva.nombre)}</span>}
      </header>
      {menuMovil && <div className="sidebar-velo" onClick={() => setMenuMovil(false)} />}
      <aside className="sidebar">
        <div className="sidebar-marca">
          {empresa === 'diserco' ? <img src="/diserco-logo.png" alt="" style={{ width: 30, height: 30, borderRadius: 4, objectFit: 'cover' }} /> : <IsotipoEcoStone tam={28} color="#d8ccb0" />}
          <span className="sidebar-marca-texto">
            <strong>{(infoEmpresa?.nombre ?? 'EcoStone').toUpperCase()}</strong>
            <small>Facturación</small>
          </span>
          <button className="boton-icono sidebar-colapsar" onClick={alternarCompacta} title={compacta ? 'Expandir menú' : 'Compactar menú'}>
            <Icono nombre={compacta ? 'expandir' : 'colapsar'} tam={18} />
          </button>
        </div>

        {sucursalActiva && (
          <div className="sidebar-sucursal" title={sucursalActiva.nombre}>
            <span className="sidebar-sucursal-etiqueta">Sucursal</span>
            {puedeCambiarSucursal ? (
              <select
                className="sidebar-sucursal-select"
                value={sucursalActivaId}
                disabled={carritoOcupado}
                title={carritoOcupado ? 'Termina o descarta la orden en curso para cambiar de sucursal' : 'Cambiar sucursal'}
                onChange={(e) => cambiarSucursalActiva(e.target.value)}
              >
                {sucursales.map((s) => (
                  <option key={s.id} value={s.id}>
                    {nombreCortoSucursal(s.nombre)}
                  </option>
                ))}
              </select>
            ) : (
              <strong className="sidebar-sucursal-nombre">{nombreCortoSucursal(sucursalActiva.nombre)}</strong>
            )}
            <span className="sidebar-sucursal-inicial" aria-hidden="true">
              {nombreCortoSucursal(sucursalActiva.nombre).slice(0, 2).toUpperCase()}
            </span>
          </div>
        )}

        <nav className="sidebar-nav">
          {GRUPOS.map((grupo) => {
            const items = pantallasVisibles.filter((p) => p.grupo === grupo);
            if (items.length === 0) return null;
            return (
              <div key={grupo} className="sidebar-grupo">
                <span className="sidebar-grupo-titulo">{grupo}</span>
                {items.map((p) => (
                  <button
                    key={p.id}
                    className={`sidebar-item${actual.id === p.id ? ' activo' : ''}`}
                    onClick={() => {
                      setPantallaActiva(p.id);
                      setMenuMovil(false);
                    }}
                    title={compacta ? p.etiqueta : undefined}
                  >
                    <Icono nombre={p.id} />
                    <span className="sidebar-item-texto">{p.etiqueta}</span>
                    {p.id === 'antifraude' && alertasPendientes > 0 && <span className="nav-contador">{alertasPendientes}</span>}
                  </button>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-pie">
          <IndicadorVivo />
          {variasEmpresas && (
            <button className="sidebar-item" onClick={cambiarDeEmpresa} title="Cambiar de empresa">
              <Icono nombre="sucursales" />
              <span className="sidebar-item-texto">Cambiar de empresa</span>
            </button>
          )}
          <button className="sidebar-item" onClick={cambiarTema} title={tema === 'oscuro' ? 'Modo claro' : 'Modo noche'}>
            <Icono nombre={tema === 'oscuro' ? 'sol' : 'luna'} />
            <span className="sidebar-item-texto">{tema === 'oscuro' ? 'Modo claro' : 'Modo noche'}</span>
          </button>
          <div className="sidebar-usuario" title={`Versión ${new Date(__VERSION__).toLocaleString('es-HN', { timeZone: 'America/Tegucigalpa' })}`}>
            <span className="sidebar-avatar">{(perfil.nombre ?? '?').trim().slice(0, 1).toUpperCase()}</span>
            <span className="sidebar-usuario-texto">
              <strong>{perfil.nombre}</strong>
              <small>{{ admin: 'Administrador', gerente: 'Gerente', vendedor: 'Vendedor', ventas: 'Ventas', cajero: 'Cajero', bodega: 'Bodega / despacho', produccion: 'Producción' }[perfil.rol] ?? perfil.rol}</small>
            </span>
            <button className="boton-icono" onClick={salir} title="Cerrar sesión" aria-label="Cerrar sesión">
              <Icono nombre="salir" tam={18} />
            </button>
          </div>
        </div>
      </aside>
      <main className="principal">
      {hayNueva && (
        <div className="aviso-version">
          Hay una versión nueva del sistema. Se instalará sola al terminar esta venta.
          <button className="boton-sm" onClick={actualizarAhora}>
            Actualizar ya
          </button>
        </div>
      )}
      <div className="contenido">
        <Suspense fallback={<p style={{ color: 'var(--text-dim)' }}>Cargando…</p>}>
        <Componente
            session={session}
            perfil={perfil}
            sucursales={sucursales}
            onCreada={recargarSucursales}
            onIrA={irA}
            filtroInicial={actual.id === 'facturas' ? filtroFacturas : null}
            onFiltroInicialUsado={() => setFiltroFacturas(null)}
            sucursalId={sucursalActivaId}
            onCambiarSucursalId={setSucursalActivaId}
            onCarritoOcupado={setCarritoOcupado}
            loteInicial={loteInicial}
          />
        </Suspense>
      </div>
      </main>
      <BloqueoInactividad session={session} perfil={perfil} />
      {perfil.rol === 'admin' && <NotificacionesAlertas session={session} onVer={() => setPantallaActiva('antifraude')} />}
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => setSession(session));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return (
      <div className="pantalla">
        <p>Cargando…</p>
      </div>
    );
  }
  if (!session) return <PantallaLogin onEntrar={setSession} />;
  return <PantallaApp session={session} onSalir={() => supabase.auth.signOut()} />;
}
