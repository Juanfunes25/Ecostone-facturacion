import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { calcularTotales, descuentoDeLinea, OPCIONES_DESCUENTO } from '../lib/facturacion.js';
import { registrarEvento } from '../lib/eventos.js';
import { colorSucursal, nombreCortoSucursal } from '../lib/coloresSucursal.js';
import { imprimirTicket, leerConfigImpresora, pedirMotivo, verPdf } from '../lib/documentos.js';
import { useCambiosEnVivo } from '../lib/tiempoReal.js';
import AvisoSinStock from '../components/AvisoSinStock.jsx';

const CONSUMIDOR_FINAL_NOMBRE = 'Consumidor Final';
const UMBRAL_RTN_OBLIGATORIO = 10000;
const DENOMINACIONES_EFECTIVO = [20, 50, 100, 200, 500, 1000];
const MOTIVOS_DESCARTE = ['El cliente se arrepintió', 'Error al digitar la orden', 'Orden duplicada', 'Orden de prueba'];

function fmtL(n) {
  return `L ${Number(n || 0).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function rtnLuceValido(rtn) {
  if (!rtn) return true; // no bloquea si está vacío, eso lo maneja el umbral obligatorio
  return /^\d{13,14}$/.test(rtn.replace(/[-\s]/g, ''));
}

function normalizar(texto) {
  return String(texto ?? '').trim().toLowerCase();
}

// Un lector de código de barras "teclea" el código muy rápido y termina con
// Enter. Se busca primero coincidencia exacta de código de barras o código
// interno; así el escaneo nunca agrega un producto parecido por error.
function buscarPorCodigo(productos, codigo) {
  const c = normalizar(codigo);
  if (!c) return null;
  return (
    productos.find((p) => normalizar(p.codigo_barras) === c) ?? productos.find((p) => normalizar(p.codigo) === c) ?? null
  );
}

function SelectorCliente({ session, clienteId, clienteNombre, clienteExento, onSeleccionar }) {
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState([]);
  const [creando, setCreando] = useState(false);
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevoRtn, setNuevoRtn] = useState('');

  useEffect(() => {
    if (busqueda.trim().length < 2) return setResultados([]);
    const t = setTimeout(() => {
      api.get(`/clientes?q=${encodeURIComponent(busqueda)}`, session).then(setResultados).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [busqueda]);

  async function crearCliente() {
    const cliente = await api.post('/clientes', session, { nombre: nuevoNombre, rtn: nuevoRtn || null });
    onSeleccionar(cliente);
    setCreando(false);
    setNuevoNombre('');
    setNuevoRtn('');
    setBusqueda('');
  }

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: '0.85em', color: 'var(--text-dim)' }}>Cliente</div>
      <div className="pos-cliente-actual">
        <span style={{ fontWeight: 600 }}>
          {clienteNombre || CONSUMIDOR_FINAL_NOMBRE}
          {clienteExento && (
            <span className="chip" style={{ marginLeft: 8, fontSize: '0.7em' }}>
              Exento de impuestos
            </span>
          )}
        </span>
        {clienteId && (
          <button
            className="boton-sm boton-secundario"
            title="Volver a Consumidor Final"
            onClick={() => onSeleccionar(null)}
          >
            ✕ Consumidor Final
          </button>
        )}
      </div>
      {!creando && (
        <>
          <input
            placeholder="Buscar cliente por nombre o RTN…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
          {resultados.map((c) => (
            <div
              key={c.id}
              className="boton-sm boton-secundario"
              style={{ width: '100%', marginBottom: 4, cursor: 'pointer' }}
              onClick={() => {
                onSeleccionar(c.es_consumidor_final ? null : c);
                setBusqueda('');
                setResultados([]);
              }}
            >
              {c.nombre} {c.rtn ? `· ${c.rtn}` : ''}
            </div>
          ))}
          <button className="boton-sm boton-secundario" onClick={() => setCreando(true)}>
            + Nuevo cliente
          </button>
        </>
      )}
      {creando && (
        <>
          <input placeholder="Nombre" value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} />
          <input placeholder="RTN (opcional)" value={nuevoRtn} onChange={(e) => setNuevoRtn(e.target.value)} />
          {nuevoRtn && !rtnLuceValido(nuevoRtn) && (
            <p style={{ color: 'var(--aviso)', fontSize: '0.8em', marginTop: -8 }}>
              El RTN hondureño suele tener 13-14 dígitos — revísalo.
            </p>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="boton-sm" disabled={!nuevoNombre} onClick={crearCliente}>
              Guardar
            </button>
            <button className="boton-sm boton-secundario" onClick={() => setCreando(false)}>
              Cancelar
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ModalPago({ total, requiereRtn, onCancelar, onConfirmar, guardando }) {
  const [pagos, setPagos] = useState([{ forma: 'efectivo', monto: total.toFixed(2) }]);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const totalPagado = pagos.reduce((s, p) => s + Number(p.monto || 0), 0);
  const cambio = Math.max(0, totalPagado - total);
  const puedeConfirmar = totalPagado >= total - 0.005;

  function actualizarPago(i, cambios) {
    setPagos((actual) => actual.map((p, idx) => (idx === i ? { ...p, ...cambios } : p)));
  }

  function agregarFormaPago() {
    setPagos((actual) => [...actual, { forma: 'tarjeta', monto: Math.max(0, total - totalPagado).toFixed(2) }]);
  }

  function quitarFormaPago(i) {
    setPagos((actual) => actual.filter((_, idx) => idx !== i));
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') onCancelar();
    if (e.key === 'Enter' && puedeConfirmar && !guardando) confirmar();
  }

  function confirmar() {
    const efectivo = pagos.filter((p) => p.forma === 'efectivo').reduce((s, p) => s + Number(p.monto || 0), 0);
    onConfirmar({ pagos, efectivo });
  }

  return (
    <div className="overlay" onKeyDown={onKeyDown}>
      <div className="tarjeta" style={{ maxWidth: 380 }}>
        <h2>Procesar pago</h2>
        <div className="pos-totales-fila total">
          <span>Total</span>
          <span>{fmtL(total)}</span>
        </div>
        {requiereRtn && (
          <div className="alerta">
            Recordatorio: esta venta supera L{UMBRAL_RTN_OBLIGATORIO.toLocaleString('es-HN')} y el cliente no tiene RTN.
            Pídelo si puedes; puedes cobrar igual (queda una alerta para el administrador).
          </div>
        )}

        {pagos.map((p, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginBottom: 6 }}>
            <select
              value={p.forma}
              onChange={(e) => actualizarPago(i, { forma: e.target.value })}
              style={{ flex: 1, marginBottom: 0 }}
            >
              <option value="efectivo">Efectivo</option>
              <option value="tarjeta">Tarjeta</option>
              <option value="transferencia">Transferencia</option>
            </select>
            <input
              ref={i === 0 ? inputRef : undefined}
              type="number"
              step="0.01"
              value={p.monto}
              onChange={(e) => actualizarPago(i, { monto: e.target.value })}
              style={{ flex: 1, marginBottom: 0 }}
            />
            {pagos.length > 1 && (
              <button className="boton-secundario boton-sm" onClick={() => quitarFormaPago(i)}>
                ✕
              </button>
            )}
          </div>
        ))}

        {pagos[0]?.forma === 'efectivo' && pagos.length === 1 && (
          <div className="toolbar" style={{ marginTop: 4 }}>
            {DENOMINACIONES_EFECTIVO.filter((d) => d >= total).slice(0, 3).map((d) => (
              <button key={d} className="boton-sm boton-secundario" onClick={() => actualizarPago(0, { monto: d.toFixed(2) })}>
                L{d}
              </button>
            ))}
            <button className="boton-sm boton-secundario" onClick={() => actualizarPago(0, { monto: total.toFixed(2) })}>
              Exacto
            </button>
          </div>
        )}

        <button className="boton-sm boton-secundario" style={{ marginTop: 8 }} onClick={agregarFormaPago}>
          + Dividir el pago
        </button>

        <div className="pos-totales-fila" style={{ marginTop: 10 }}>
          <span>Pagado</span>
          <span>{fmtL(totalPagado)}</span>
        </div>
        <div className="pos-totales-fila">
          <span>Cambio</span>
          <span>{fmtL(cambio)}</span>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="boton-secundario" onClick={onCancelar} disabled={guardando}>
            Cancelar (Esc)
          </button>
          <button disabled={guardando || !puedeConfirmar} onClick={confirmar}>
            {guardando ? 'Procesando…' : 'Confirmar (Enter)'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ModalOrdenesAbiertas({ ordenes, cargando, onSeleccionar, onCerrar }) {
  return (
    <div className="overlay" onClick={onCerrar}>
      <div className="tarjeta" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <h2>Órdenes abiertas</h2>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.85em', marginTop: -8 }}>
          Órdenes completas guardadas sin cobrar. Se actualizan solas si otra caja agrega o cobra una.
        </p>
        {cargando && <p style={{ color: 'var(--text-dim)' }}>Cargando…</p>}
        {!cargando && ordenes.length === 0 && <p style={{ color: 'var(--text-dim)' }}>No hay órdenes abiertas.</p>}
        {ordenes.map((o) => (
          <button key={o.id} className="orden-abierta" onClick={() => onSeleccionar(o)}>
            <span>
              <strong>Orden #{o.numero_orden}</strong>
              <br />
              <span style={{ color: 'var(--text-dim)', fontSize: '0.85em' }}>
                {o.clientes?.nombre || CONSUMIDOR_FINAL_NOMBRE} · {o.perfiles?.nombre ?? ''} ·{' '}
                {new Date(o.created_at).toLocaleTimeString('es-HN', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </span>
            <strong>{fmtL(o.total)}</strong>
          </button>
        ))}
        <button className="boton-secundario" style={{ marginTop: 6 }} onClick={onCerrar}>
          Cerrar
        </button>
      </div>
    </div>
  );
}

let contadorLineas = 0;
// Cada línea del carrito tiene su propia clave: el mismo producto puede ir
// en dos líneas (una con descuento de tercera edad y otra sin descuento).
function nuevaClave() {
  contadorLineas += 1;
  return `l${Date.now().toString(36)}${contadorLineas}`;
}

export default function Pos({ session, perfil, sucursales, onIrA, sucursalId, onCambiarSucursalId, onCarritoOcupado }) {
  const [categorias, setCategorias] = useState([]);
  const [productos, setProductos] = useState([]);
  const [categoriaActivaId, setCategoriaActivaId] = useState(null);
  const [busquedaProducto, setBusquedaProducto] = useState('');
  const [carrito, setCarrito] = useState([]);
  const [cliente, setCliente] = useState(null);
  const [notaInterna, setNotaInterna] = useState('');
  const [terceraEdad, setTerceraEdad] = useState({ nombre: '', identidad: '' });
  const [ventaId, setVentaId] = useState(null);
  const [mostrarPago, setMostrarPago] = useState(false);
  const [guardandoPago, setGuardandoPago] = useState(false);
  const [avisoStock, setAvisoStock] = useState(null);
  const [mostrarOrdenes, setMostrarOrdenes] = useState(false);
  const [cargandoOrdenes, setCargandoOrdenes] = useState(false);
  const [ordenesAbiertas, setOrdenesAbiertas] = useState([]);
  const [cargandoCatalogo, setCargandoCatalogo] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [resultadoFactura, setResultadoFactura] = useState(null);
  const [estadoPuntoEmision, setEstadoPuntoEmision] = useState(null);
  const [enLinea, setEnLinea] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const primerCambio = useRef(true);
  const ultimaVentaRef = useRef(null);
  const buscadorRef = useRef(null);
  // El id de la orden abierta se lee de una ref (no del estado) porque el
  // autoguardado corre en un setTimeout: si se leyera del estado, dos
  // agregados rápidos podían disparar dos autoguardados que todavía no
  // se habían enterado uno del otro, y cada uno creaba su propia orden.
  const ventaIdRef = useRef(null);
  const colaGuardadoRef = useRef(Promise.resolve());
  const descartadaRef = useRef(false);

  function fijarVentaId(id) {
    ventaIdRef.current = id;
    setVentaId(id);
  }

  function cargarCatalogo({ silencioso = false } = {}) {
    if (!silencioso) setCargandoCatalogo(true);
    return Promise.all([api.cache('/categorias', session), api.cache('/productos', session)])
      .then(([cats, prods]) => {
        setCategorias(cats);
        setProductos(prods);
      })
      .catch((e) => setError(e.message))
      .finally(() => setCargandoCatalogo(false));
  }

  useEffect(() => {
    cargarCatalogo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Un precio o producto nuevo cargado desde otra computadora aparece acá
  // al instante, sin recargar la página.
  useCambiosEnVivo(['productos', 'categorias'], () => cargarCatalogo({ silencioso: true }));

  // Órdenes Abiertas se refresca sola mientras está abierta.
  useCambiosEnVivo(
    ['ventas'],
    () => {
      api
        .get(`/ventas?estado=abierta&sucursal_id=${sucursalId}`, session)
        .then(setOrdenesAbiertas)
        .catch(() => {});
    },
    { filtro: sucursalId ? `sucursal_id=eq.${sucursalId}` : undefined, activo: mostrarOrdenes && !!sucursalId }
  );

  useEffect(() => {
    buscadorRef.current?.focus();
  }, []);

  // Avisa hacia arriba si hay una orden en curso — el selector de
  // sucursal (en la barra de navegación) se bloquea mientras haya productos.
  useEffect(() => {
    onCarritoOcupado?.(carrito.length > 0);
    return () => onCarritoOcupado?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carrito.length]);

  useEffect(() => {
    const marcarEnLinea = () => setEnLinea(true);
    const marcarSinConexion = () => setEnLinea(false);
    window.addEventListener('online', marcarEnLinea);
    window.addEventListener('offline', marcarSinConexion);
    return () => {
      window.removeEventListener('online', marcarEnLinea);
      window.removeEventListener('offline', marcarSinConexion);
    };
  }, []);

  useEffect(() => {
    if (!sucursalId) return;
    api
      .get(`/puntos-emision/sucursal/${sucursalId}/estado`, session)
      .then(setEstadoPuntoEmision)
      .catch(() => setEstadoPuntoEmision({ error: true }));
  }, [sucursalId]);

  function mostrarToast(texto) {
    setToast(texto);
    setTimeout(() => setToast(''), 1400);
  }

  const productosVisibles = useMemo(() => {
    const q = normalizar(busquedaProducto);
    if (q) {
      return productos.filter(
        (p) =>
          normalizar(p.nombre).includes(q) || normalizar(p.codigo).includes(q) || normalizar(p.codigo_barras).includes(q)
      );
    }
    return productos.filter((p) => !categoriaActivaId || p.categoria_id === categoriaActivaId);
  }, [productos, categoriaActivaId, busquedaProducto]);

  // Mismo cálculo de impuestos que el backend, para que el desglose que ve
  // el cajero coincida exacto con lo que se va a cobrar.
  const totales = useMemo(() => {
    const items = carrito.map((l) => ({
      precio_unitario: l.precio_unitario,
      cantidad: l.cantidad,
      descuento_porcentaje: l.descuento_porcentaje ?? 0,
      impuesto_tasa: l.impuesto_tasa,
    }));
    return calcularTotales(items, cliente);
  }, [carrito, cliente]);
  const hayTerceraEdad = carrito.some((l) => l.descuento_porcentaje === 25);
  // Para el 25% de tercera edad se exige el nombre y el No. de identidad o
  // carné: sin eso el descuento se podía aplicar a cualquiera.
  const faltaCarne =
    hayTerceraEdad && (!terceraEdad.nombre.trim() || terceraEdad.identidad.replace(/[^0-9A-Za-z]/g, '').length < 5);

  const requiereRtn = totales.total > UMBRAL_RTN_OBLIGATORIO && !cliente?.rtn;
  const carritoTieneLineasInvalidas = carrito.some(
    (l) => !Number.isFinite(l.cantidad) || l.cantidad <= 0 || !Number.isFinite(l.precio_unitario) || l.precio_unitario < 0
  );
  const sinPuntoEmision = estadoPuntoEmision?.error;
  const cobroBloqueado =
    carrito.length === 0 || carritoTieneLineasInvalidas || sinPuntoEmision || guardandoPago || faltaCarne;

  // Auto-guarda la orden como "abierta" cada vez que cambia — así "Órdenes
  // Abiertas" siempre puede recuperarla. Si falla por red, reintenta una vez.
  useEffect(() => {
    if (primerCambio.current) {
      primerCambio.current = false;
      return;
    }
    if (carrito.length === 0) return;
    descartadaRef.current = false;
    const t = setTimeout(() => {
      guardarOrdenEnCola().catch(() => {
        setTimeout(() => guardarOrdenEnCola().catch(() => {}), 2000);
      });
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carrito, cliente, sucursalId, notaInterna, terceraEdad]);

  async function guardarOrden() {
    const body = {
      sucursal_id: sucursalId,
      cliente_id: cliente?.id ?? null,
      descuento_porcentaje: 0,
      nota_interna: notaInterna || null,
      tercera_edad: carrito.some((l) => l.descuento_porcentaje === 25) ? terceraEdad : { nombre: '', identidad: '' },
      // El descuento va por producto: una orden puede tener una persona de
      // tercera edad y otra que no.
      items: carrito.map((l) => ({
        producto_id: l.producto_id,
        cantidad: l.cantidad,
        descuento_porcentaje: l.descuento_porcentaje ?? 0,
      })),
    };
    if (body.items.length === 0) return ventaIdRef.current;
    try {
      if (ventaIdRef.current) {
        await api.put(`/ventas/${ventaIdRef.current}`, session, body);
        setError('');
        return ventaIdRef.current;
      }
      const venta = await api.post('/ventas', session, body);
      fijarVentaId(venta.id);
      setError('');
      return venta.id;
    } catch (e) {
      setError(e.message);
      throw e;
    }
  }

  // Encola cada autoguardado en serie: nunca deja que dos corran a la vez.
  function guardarOrdenEnCola() {
    const promesa = colaGuardadoRef.current.catch(() => {}).then(() => {
      if (descartadaRef.current) return ventaIdRef.current;
      return guardarOrden();
    });
    colaGuardadoRef.current = promesa;
    return promesa;
  }

  function agregarProducto(producto) {
    if (!producto.precio && producto.precio !== 0) return;
    setResultadoFactura(null);
    setCarrito((actual) => {
      // Se suma a la línea del mismo producto SIN descuento; si la única
      // línea existente tiene descuento, la unidad nueva va aparte (no toda
      // persona de la orden es de tercera edad).
      const existente = actual.find((l) => l.producto_id === producto.id && !l.descuento_porcentaje);
      if (existente) {
        return actual.map((l) => (l.clave === existente.clave ? { ...l, cantidad: l.cantidad + 1 } : l));
      }
      return [
        ...actual,
        {
          clave: nuevaClave(),
          producto_id: producto.id,
          nombre: producto.nombre,
          precio_unitario: producto.precio,
          impuesto_tasa: producto.impuesto1_tasa,
          cantidad: 1,
          descuento_porcentaje: 0,
        },
      ];
    });
    mostrarToast(`+ ${producto.nombre}`);
  }

  // Lector de código de barras con el cursor fuera de cualquier campo (por
  // ejemplo, justo después de tocar un producto): se captura la ráfaga de
  // teclas que manda el lector y se agrega el producto al terminar con Enter.
  // Si el cursor está en un campo de texto, esa escritura es de una persona
  // y no se toca.
  const productosRef = useRef(productos);
  productosRef.current = productos;
  useEffect(() => {
    let buffer = '';
    let ultimaTecla = 0;
    function onKeyDown(e) {
      const el = document.activeElement;
      const escribiendo = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if (escribiendo || e.ctrlKey || e.altKey || e.metaKey) return;
      const ahora = Date.now();
      if (ahora - ultimaTecla > 80) buffer = '';
      ultimaTecla = ahora;
      if (e.key === 'Enter') {
        if (buffer.length >= 3) {
          const producto = buscarPorCodigo(productosRef.current, buffer);
          if (producto) agregarProducto(producto);
          else mostrarToast(`Código ${buffer} no encontrado`);
          e.preventDefault();
        }
        buffer = '';
        return;
      }
      if (e.key.length === 1) buffer += e.key;
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Quitar productos de una orden ya armada (sobre todo después de que el
  // cliente vio el total) es una de las formas de cobrar de más sin
  // facturarlo: cada quitada queda en la bitácora.
  function registrarQuitado(clave, cantidadQuitada) {
    const l = carrito.find((x) => x.clave === clave);
    if (!l || cantidadQuitada <= 0) return;
    registrarEvento(
      'orden.quitar_producto',
      {
        producto: l.nombre,
        cantidad: cantidadQuitada,
        monto: Math.round(l.precio_unitario * cantidadQuitada * 100) / 100,
        orden_id: ventaIdRef.current ?? '',
        quedan_en_orden: carrito.length,
      },
      sucursalId
    );
  }

  function cambiarCantidad(clave, delta) {
    if (delta < 0) registrarQuitado(clave, -delta);
    setCarrito((actual) =>
      actual.map((l) => (l.clave === clave ? { ...l, cantidad: l.cantidad + delta } : l)).filter((l) => l.cantidad > 0)
    );
  }

  function establecerCantidad(clave, valor) {
    const cantidad = Math.max(1, Math.floor(Number(valor) || 1));
    const anterior = carrito.find((x) => x.clave === clave)?.cantidad ?? cantidad;
    if (cantidad < anterior) registrarQuitado(clave, anterior - cantidad);
    setCarrito((actual) => actual.map((l) => (l.clave === clave ? { ...l, cantidad } : l)));
  }

  function quitarLinea(clave) {
    registrarQuitado(clave, carrito.find((x) => x.clave === clave)?.cantidad ?? 0);
    setCarrito((actual) => actual.filter((l) => l.clave !== clave));
  }

  function fijarDescuentoLinea(clave, porcentaje) {
    const l = carrito.find((x) => x.clave === clave);
    if (l && porcentaje > 0) {
      registrarEvento('orden.descuento', { producto: l.nombre, cantidad: l.cantidad, porcentaje }, sucursalId);
    }
    setCarrito((actual) => actual.map((l) => (l.clave === clave ? { ...l, descuento_porcentaje: porcentaje } : l)));
  }

  // "2 gelatos, uno para un adulto mayor": saca 1 unidad a su propia línea
  // para ponerle el descuento sólo a esa.
  function separarUnidad(clave) {
    setCarrito((actual) => {
      const i = actual.findIndex((l) => l.clave === clave);
      if (i < 0 || actual[i].cantidad < 2) return actual;
      const copia = [...actual];
      copia[i] = { ...copia[i], cantidad: copia[i].cantidad - 1 };
      copia.splice(i + 1, 0, { ...actual[i], clave: nuevaClave(), cantidad: 1, descuento_porcentaje: 0 });
      return copia;
    });
  }

  async function nuevaOrden({ confirmar = true } = {}) {
    // Descartar una orden armada exige motivo: queda en la bitácora y, si
    // el monto es alto, genera alerta (es la forma clásica de cobrar sin
    // facturar).
    let motivo = '';
    if (confirmar && carrito.length > 0) {
      motivo = pedirMotivo('¿Por qué se descarta esta orden? Los productos se van a perder.', MOTIVOS_DESCARTE);
      if (!motivo) return;
    }
    // Marca la orden como descartada ANTES de limpiar, para que un
    // autoguardado en cola no la resucite después de borrada.
    descartadaRef.current = true;
    const idAEliminar = ventaIdRef.current;
    fijarVentaId(null);
    setCarrito([]);
    setCliente(null);
    setNotaInterna('');
    setTerceraEdad({ nombre: '', identidad: '' });
    setResultadoFactura(null);
    setError('');
    if (idAEliminar) {
      await api.del(`/ventas/${idAEliminar}?motivo=${encodeURIComponent(motivo || 'Orden vacía')}`, session).catch(() => {});
    }
    buscadorRef.current?.focus();
  }

  async function abrirOrdenesAbiertas() {
    setMostrarOrdenes(true);
    setCargandoOrdenes(true);
    try {
      const ordenes = await api.get(`/ventas?estado=abierta&sucursal_id=${sucursalId}`, session);
      setOrdenesAbiertas(ordenes);
    } catch (e) {
      setError(e.message);
    } finally {
      setCargandoOrdenes(false);
    }
  }

  async function recuperarOrden(orden) {
    try {
      const detalle = await api.get(`/ventas/${orden.id}`, session);
      if (detalle.estado !== 'abierta') {
        setError('Esa orden ya fue cobrada o descartada en otra caja.');
        abrirOrdenesAbiertas();
        return;
      }
      descartadaRef.current = false;
      fijarVentaId(detalle.id);
      setCliente(detalle.clientes?.es_consumidor_final ? null : detalle.clientes);
      setTerceraEdad({ nombre: detalle.tercera_edad_nombre ?? '', identidad: detalle.tercera_edad_identidad ?? '' });
      setCarrito(
        (detalle.detalle || []).map((d) => ({
          clave: nuevaClave(),
          descuento_porcentaje: Number(d.descuento_porcentaje ?? 0),
          producto_id: d.producto_id,
          nombre: d.nombre_producto,
          precio_unitario: Number(d.precio_unitario),
          impuesto_tasa: Number(d.impuesto_tasa),
          cantidad: Number(d.cantidad),
        }))
      );
      onCambiarSucursalId?.(detalle.sucursal_id);
      setMostrarOrdenes(false);
    } catch (e) {
      setError(e.message);
    }
  }

  function repetirUltimaVenta() {
    if (!ultimaVentaRef.current) return;
    setCliente(ultimaVentaRef.current.cliente);
    setCarrito(ultimaVentaRef.current.carrito);
    setResultadoFactura(null);
    mostrarToast('Pedido repetido — revisa y cobra');
  }

  // Un solo toque: Efectivo y Tarjeta cobran de inmediato el total exacto.
  // "Más formas de pago" (dividir, transferencia, efectivo con cambio)
  // queda como opción secundaria.
  function pagoInstantaneo(forma) {
    if (cobroBloqueado) return;
    confirmarPago({
      pagos: [{ forma, monto: totales.total.toFixed(2) }],
      efectivo: forma === 'efectivo' ? totales.total : 0,
    });
  }

  async function imprimir(id, opciones) {
    try {
      await imprimirTicket(id, session, opciones);
    } catch (e) {
      setError(`La factura se emitió, pero no se pudo imprimir: ${e.message}`);
    }
  }

  async function confirmarPago({ pagos, efectivo }, confirmarSinStock = false) {
    setGuardandoPago(true);
    setError('');
    try {
      // Siempre se espera la cola de autoguardado antes de cobrar, para que
      // el total facturado sea el mismo que ve el cajero.
      const idParaPagar = await guardarOrdenEnCola();
      if (!idParaPagar) throw new Error('No se pudo guardar la orden antes de cobrar');
      const mapaFormas = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia' };
      const formasPago = await api.cache('/formas-pago', session);
      const pagosConId = pagos.map((p) => ({
        forma_pago_id: formasPago.find((f) => f.nombre === mapaFormas[p.forma])?.id,
        monto: Number(p.monto),
      }));
      const venta = await api.post(`/ventas/${idParaPagar}/pagar`, session, {
        efectivo_recibido: efectivo,
        pagos: pagosConId,
        confirmar_sin_stock: confirmarSinStock,
      });
      ultimaVentaRef.current = { cliente, carrito };
      setResultadoFactura(venta);
      setMostrarPago(false);
      setCarrito([]);
      setCliente(null);
      setNotaInterna('');
      setTerceraEdad({ nombre: '', identidad: '' });
      fijarVentaId(null);

      if (leerConfigImpresora().autoImprimir) imprimir(venta.id);
    } catch (e) {
      if (e.codigo === 'SIN_STOCK') setAvisoStock({ faltantes: e.faltantes ?? [], datos: { pagos, efectivo } });
      else setError(e.message);
    } finally {
      setGuardandoPago(false);
    }
  }

  const sucursalActual = sucursales.find((s) => s.id === sucursalId);

  return (
    <div className="pos-grid">
      {toast && <div className="pos-toast">{toast}</div>}
      {avisoStock && <AvisoSinStock faltantes={avisoStock.faltantes} onCancelar={() => setAvisoStock(null)} onContinuar={() => { const d = avisoStock.datos; setAvisoStock(null); confirmarPago(d, true); }} />}

      {resultadoFactura && (
        <div className="overlay">
          <div className="tarjeta" style={{ maxWidth: 380 }}>
            <h2>{resultadoFactura.es_borrador ? 'Orden registrada' : 'Factura emitida'}</h2>
            {resultadoFactura.es_borrador && (
              <div className="badge-borrador">Sin validez fiscal — CAI pendiente</div>
            )}
            <p>
              Número: <strong>{resultadoFactura.numero_factura}</strong>
            </p>
            <p style={{ marginTop: -6 }}>Cliente: {resultadoFactura.cliente_nombre || CONSUMIDOR_FINAL_NOMBRE}</p>
            <p>Cambio: {fmtL(resultadoFactura.cambio ?? 0)}</p>
            {resultadoFactura.aviso_rtn && <div className="alerta">{resultadoFactura.aviso_rtn}</div>}
            {resultadoFactura.faltantes_inventario?.length > 0 && <div className="alerta">Se facturó sin existencia suficiente: {resultadoFactura.faltantes_inventario.map((f) => f.producto).join(', ')}. Revisa el inventario.</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="boton-secundario boton-sm" style={{ flex: 1 }} onClick={() => imprimir(resultadoFactura.id, { reimpresion: true })}>
                🖨 Reimprimir ticket
              </button>
              <button
                className="boton-secundario boton-sm"
                style={{ flex: 1 }}
                onClick={() => verPdf(`/ventas/${resultadoFactura.id}/pdf`, session).catch((e) => setError(e.message))}
              >
                Ver PDF
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="boton-secundario" onClick={repetirUltimaVenta}>
                Repetir pedido
              </button>
              <button
                autoFocus
                onClick={() => {
                  setResultadoFactura(null);
                  buscadorRef.current?.focus();
                }}
              >
                Nueva orden
              </button>
            </div>
          </div>
        </div>
      )}

      {mostrarPago && (
        <ModalPago
          total={totales.total}
          requiereRtn={requiereRtn}
          guardando={guardandoPago}
          onCancelar={() => setMostrarPago(false)}
          onConfirmar={confirmarPago}
        />
      )}
      {mostrarOrdenes && (
        <ModalOrdenesAbiertas
          ordenes={ordenesAbiertas}
          cargando={cargandoOrdenes}
          onSeleccionar={recuperarOrden}
          onCerrar={() => setMostrarOrdenes(false)}
        />
      )}

      <div className="pos-panel">
        {error && <div className="error">{error}</div>}
        {!enLinea && <div className="alerta">Sin conexión — se reintentará guardar cuando vuelva.</div>}
        <button
          className={`pos-categoria ${!categoriaActivaId ? 'activa' : ''}`}
          onClick={() => setCategoriaActivaId(null)}
        >
          Todas
        </button>
        {categorias.map((c) => (
          <button
            key={c.id}
            className={`pos-categoria ${categoriaActivaId === c.id ? 'activa' : ''}`}
            onClick={() => setCategoriaActivaId(c.id)}
          >
            {c.nombre}
          </button>
        ))}
      </div>

      <div className="pos-panel">
        <input
          ref={buscadorRef}
          placeholder="Buscar por nombre, código o código de barras… (Enter agrega)"
          value={busquedaProducto}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            const exacto = buscarPorCodigo(productos, busquedaProducto);
            const producto = exacto ?? productosVisibles[0];
            if (producto) {
              agregarProducto(producto);
              setBusquedaProducto('');
            } else if (busquedaProducto.trim()) {
              mostrarToast(`"${busquedaProducto.trim()}" no encontrado`);
            }
          }}
          onChange={(e) => setBusquedaProducto(e.target.value)}
        />
        {cargandoCatalogo && <p style={{ color: 'var(--text-dim)' }}>Cargando catálogo…</p>}
        {!cargandoCatalogo && (
          <p style={{ color: 'var(--text-dim)', fontSize: '0.85em', marginTop: -6 }}>
            {productosVisibles.length} producto{productosVisibles.length === 1 ? '' : 's'} · el lector de código de barras funciona en cualquier momento
          </p>
        )}
        <div className="pos-productos">
          {productosVisibles.map((p) => (
            <button key={p.id} className="pos-producto" onClick={() => agregarProducto(p)}>
              <strong>{p.nombre}</strong>
              {fmtL(p.precio)}
            </button>
          ))}
        </div>
        {!cargandoCatalogo && productosVisibles.length === 0 && (
          <p style={{ color: 'var(--text-dim)' }}>Sin productos que coincidan.</p>
        )}
      </div>

      <div className="pos-panel">
        {sucursalActual && (
          <div className="pos-sucursal-banner" style={{ background: colorSucursal(sucursalId) }}>
            <span className="pos-sucursal-banner-corto">{nombreCortoSucursal(sucursalActual.nombre)}</span>
            <span className="pos-sucursal-banner-legal">{sucursalActual.nombre}</span>
          </div>
        )}
        {sinPuntoEmision && (
          <div className="alerta">Esta sucursal no tiene un punto de emisión activo — no se puede facturar.</div>
        )}
        {estadoPuntoEmision?.alerta && !sinPuntoEmision && (
          <div className="alerta">
            {estadoPuntoEmision.agotado && 'El rango de facturas está agotado. '}
            {estadoPuntoEmision.vencido && 'El CAI ya venció. '}
            {!estadoPuntoEmision.agotado && !estadoPuntoEmision.vencido && 'El CAI está por vencer o agotarse — avisa al dueño.'}
          </div>
        )}

        <SelectorCliente
          session={session}
          clienteId={cliente?.id}
          clienteNombre={cliente?.nombre}
          clienteExento={cliente?.exento_impuestos}
          onSeleccionar={setCliente}
        />

        <div style={{ maxHeight: '40vh', overflowY: 'auto' }}>
          {carrito.length === 0 && <p style={{ color: 'var(--text-dim)' }}>Sin productos todavía.</p>}
          {carrito.map((l) => {
            const bruto = l.precio_unitario * l.cantidad;
            const desc = descuentoDeLinea(l.precio_unitario, l.cantidad, l.descuento_porcentaje);
            return (
              <div key={l.clave} className={`pos-linea${l.descuento_porcentaje ? ' pos-linea-con-descuento' : ''}`}>
                <div className="pos-orden-linea">
                  <span>
                    {l.nombre}
                    <br />
                    <span style={{ color: 'var(--text-dim)' }}>
                      {fmtL(l.precio_unitario)} c/u ·{' '}
                      {desc > 0 ? (
                        <>
                          <s>{fmtL(bruto)}</s> <strong style={{ color: 'var(--ok)' }}>{fmtL(bruto - desc)}</strong>
                        </>
                      ) : (
                        fmtL(bruto)
                      )}
                    </span>
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button className="boton-secundario" onClick={() => cambiarCantidad(l.clave, -1)}>
                      −
                    </button>
                    <input
                      type="number"
                      value={l.cantidad}
                      onChange={(e) => establecerCantidad(l.clave, e.target.value)}
                      style={{ width: 44, textAlign: 'center', marginBottom: 0, padding: '4px' }}
                    />
                    <button className="boton-secundario" onClick={() => cambiarCantidad(l.clave, 1)}>
                      +
                    </button>
                    <button className="boton-secundario" title="Quitar" onClick={() => quitarLinea(l.clave)}>
                      🗑
                    </button>
                  </span>
                </div>
                <div className="pos-linea-descuento" role="radiogroup" aria-label={`Descuento de ${l.nombre}`}>
                  {OPCIONES_DESCUENTO.map((o) => (
                    <button
                      key={o.porcentaje}
                      role="radio"
                      aria-checked={(l.descuento_porcentaje ?? 0) === o.porcentaje}
                      className={`pos-chip-desc${(l.descuento_porcentaje ?? 0) === o.porcentaje ? ' activo' : ''}`}
                      onClick={() => fijarDescuentoLinea(l.clave, o.porcentaje)}
                    >
                      {o.corta}
                    </button>
                  ))}
                  {l.cantidad > 1 && (
                    <button className="pos-chip-desc pos-chip-separar" title="Separar una unidad para darle otro descuento" onClick={() => separarUnidad(l.clave)}>
                      ÷ Separar 1
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {hayTerceraEdad && (
          <div className={`pos-tercera-edad${faltaCarne ? ' incompleto' : ''}`}>
            <span className="pos-tercera-edad-titulo">Descuento 3ª edad — datos del carné</span>
            <input
              placeholder="Nombre completo"
              value={terceraEdad.nombre}
              onChange={(e) => setTerceraEdad((t) => ({ ...t, nombre: e.target.value }))}
            />
            <input
              placeholder="No. identidad / carné"
              inputMode="numeric"
              value={terceraEdad.identidad}
              onChange={(e) => setTerceraEdad((t) => ({ ...t, identidad: e.target.value }))}
            />
            {faltaCarne && <small>Obligatorio para cobrar con el 25%.</small>}
          </div>
        )}
        <input
          placeholder="Nota interna (no sale en la factura)"
          value={notaInterna}
          onChange={(e) => setNotaInterna(e.target.value)}
        />

        <div className="pos-totales-fila">
          <span>Sub-Total</span>
          <span>{fmtL(totales.subtotal_bruto)}</span>
        </div>
        {Object.entries(totales.descuentos_por_porcentaje).map(([pct, monto]) => (
          <div className="pos-totales-fila" key={pct}>
            <span>Descuento {pct}%{Number(pct) === 25 ? ' (3ra edad)' : ''}</span>
            <span>-{fmtL(monto)}</span>
          </div>
        ))}
        <div className="pos-totales-fila">
          <span>ISV incluido</span>
          <span>{fmtL(totales.isv_total)}</span>
        </div>
        <div className="pos-totales-fila total">
          <span>Total</span>
          <span>{fmtL(totales.total)}</span>
        </div>
        {requiereRtn && (
          <p style={{ color: 'var(--aviso)', fontSize: '0.82em' }}>
            Recordatorio: venta mayor a L{UMBRAL_RTN_OBLIGATORIO.toLocaleString('es-HN')} sin RTN del cliente (no bloquea el cobro).
          </p>
        )}

        <div className="pos-acciones">
          <button className="boton-secundario" onClick={() => nuevaOrden()}>
            Nueva
          </button>
          <button className="boton-secundario" onClick={abrirOrdenesAbiertas}>
            Órdenes Abiertas
          </button>
          {onIrA && (
            <button className="boton-secundario" onClick={() => onIrA('facturas')} style={{ gridColumn: '1 / -1' }}>
              Buscar
            </button>
          )}
        </div>

        {/* Efectivo y Tarjeta en extremos opuestos con una separación ancha
            en medio: un toque mal apuntado cae en el espacio vacío, nunca en
            el botón de al lado. */}
        <div className="pos-botones-cobro">
          <button className="boton-cobro efectivo" disabled={cobroBloqueado} onClick={() => pagoInstantaneo('efectivo')}>
            <span className="boton-cobro-icono">💵</span>
            EFECTIVO
          </button>
          <span className="pos-cobro-separador" aria-hidden="true" />
          <button className="boton-cobro tarjeta" disabled={cobroBloqueado} onClick={() => pagoInstantaneo('tarjeta')}>
            <span className="boton-cobro-icono">💳</span>
            TARJETA
          </button>
        </div>
        {guardandoPago && <p className="pos-procesando">Procesando…</p>}
        <button
          className="boton-secundario boton-sm"
          style={{ marginTop: 10, width: '100%' }}
          disabled={carrito.length === 0 || carritoTieneLineasInvalidas || sinPuntoEmision}
          onClick={() => setMostrarPago(true)}
        >
          Más formas de pago (dividir, transferencia, cambio)
        </button>
      </div>
    </div>
  );
}
