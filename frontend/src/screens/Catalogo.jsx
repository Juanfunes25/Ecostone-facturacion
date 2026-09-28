import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useCambiosEnVivo } from '../lib/tiempoReal.js';

const fmtL = (n) => `L ${Number(n).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Código de barras editable directo en la tabla: se escribe a mano (o se
// escanea) y se guarda con Enter o al salir del campo, sin abrir la edición
// completa del producto. Vacío = quitar el código.
function CeldaCodigoBarras({ producto, onGuardar }) {
  const original = producto.codigo_barras ?? '';
  const [valor, setValor] = useState(original);
  const [estado, setEstado] = useState('');

  useEffect(() => {
    setValor(producto.codigo_barras ?? '');
  }, [producto.codigo_barras]);

  async function guardar() {
    if (valor.trim() === original) return;
    setEstado('guardando');
    const ok = await onGuardar(producto, valor);
    if (ok) {
      setEstado('ok');
      setTimeout(() => setEstado(''), 1500);
    } else {
      setEstado('');
      setValor(original);
    }
  }

  return (
    <span className="celda-codigo-barras">
      <input
        value={valor}
        placeholder="Agregar…"
        inputMode="numeric"
        onChange={(e) => setValor(e.target.value)}
        onBlur={guardar}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === 'Escape') setValor(original);
        }}
      />
      {estado === 'guardando' && <span className="celda-estado">…</span>}
      {estado === 'ok' && <span className="celda-estado ok">✓</span>}
    </span>
  );
}

const FORM_VACIO ={ codigo: '', codigo_barras: '', nombre: '', categoria_id: '', precio: '', impuesto1_tasa: '0.15' };

export default function Catalogo({ session }) {
  const [categorias, setCategorias] = useState([]);
  const [productos, setProductos] = useState([]);
  const [busqueda, setBusqueda] = useState('');
  const [categoriaFiltro, setCategoriaFiltro] = useState('');
  const [nuevaCategoria, setNuevaCategoria] = useState('');
  const [editandoCategoriaId, setEditandoCategoriaId] = useState(null);
  const [nombreCategoriaEdit, setNombreCategoriaEdit] = useState('');
  const [form, setForm] = useState(FORM_VACIO);
  const [editandoId, setEditandoId] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const productosVisibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return productos.filter((p) => {
      const coincideTexto =
        !q ||
        p.nombre.toLowerCase().includes(q) ||
        (p.codigo ?? '').toLowerCase().includes(q) ||
        (p.codigo_barras ?? '').toLowerCase().includes(q);
      const coincideCategoria = !categoriaFiltro || p.categoria_id === categoriaFiltro;
      return coincideTexto && coincideCategoria;
    });
  }, [productos, busqueda, categoriaFiltro]);

  async function cargar() {
    setCategorias(await api.get('/categorias', session));
    setProductos(await api.get('/productos?incluirInactivos=true', session));
  }

  useEffect(() => {
    cargar().catch((e) => setError(e.message));
  }, []);

  useCambiosEnVivo(['productos', 'categorias'], () => cargar().catch(() => {}));

  async function crearCategoria() {
    if (!nuevaCategoria.trim()) return;
    await api.post('/categorias', session, { nombre: nuevaCategoria.trim(), orden: categorias.length });
    setNuevaCategoria('');
    cargar();
  }

  function editarCategoria(c) {
    setEditandoCategoriaId(c.id);
    setNombreCategoriaEdit(c.nombre);
  }

  async function guardarCategoria(c) {
    if (!nombreCategoriaEdit.trim()) return;
    await api.put(`/categorias/${c.id}`, session, { nombre: nombreCategoriaEdit.trim(), orden: c.orden, activo: c.activo });
    setEditandoCategoriaId(null);
    cargar();
  }

  async function alternarActivaCategoria(c) {
    await api.put(`/categorias/${c.id}`, session, { nombre: c.nombre, orden: c.orden, activo: !c.activo });
    cargar();
  }

  // Sube/baja una categoría intercambiando su "orden" con la vecina — así
  // Juan puede acomodar el catálogo como aparece en el POS sin tocar SQL.
  async function moverCategoria(c, direccion) {
    const ordenadas = [...categorias].sort((a, b) => a.orden - b.orden);
    const i = ordenadas.findIndex((x) => x.id === c.id);
    const j = i + direccion;
    if (j < 0 || j >= ordenadas.length) return;
    const vecina = ordenadas[j];
    await Promise.all([
      api.put(`/categorias/${c.id}`, session, { nombre: c.nombre, orden: vecina.orden, activo: c.activo }),
      api.put(`/categorias/${vecina.id}`, session, { nombre: vecina.nombre, orden: c.orden, activo: vecina.activo }),
    ]);
    cargar();
  }

  function editar(producto) {
    setEditandoId(producto.id);
    setForm({
      codigo: producto.codigo ?? '',
      codigo_barras: producto.codigo_barras ?? '',
      nombre: producto.nombre,
      categoria_id: producto.categoria_id ?? '',
      precio: producto.precio,
      impuesto1_tasa: producto.impuesto1_tasa,
    });
  }

  // Precarga el formulario con los mismos datos (menos el código, que debe
  // ser único) para crear rápido una variante — ej. mismo sabor en otro
  // tamaño, o el mismo producto en otra categoría.
  function duplicar(producto) {
    setEditandoId(null);
    setForm({
      codigo: '',
      codigo_barras: '',
      nombre: `${producto.nombre} (copia)`,
      categoria_id: producto.categoria_id ?? '',
      precio: producto.precio,
      impuesto1_tasa: producto.impuesto1_tasa,
    });
  }

  async function guardarProducto() {
    setError('');
    setGuardando(true);
    const body = {
      codigo: form.codigo || null,
      codigo_barras: form.codigo_barras.trim() || null,
      nombre: form.nombre,
      categoria_id: form.categoria_id || null,
      precio: Number(form.precio),
      impuesto1_tasa: Number(form.impuesto1_tasa),
    };
    try {
      if (editandoId) await api.put(`/productos/${editandoId}`, session, body);
      else await api.post('/productos', session, body);
      setForm(FORM_VACIO);
      setEditandoId(null);
      cargar();
    } catch (e) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  async function guardarCodigoBarras(producto, valor) {
    setError('');
    try {
      await api.put(`/productos/${producto.id}`, session, { codigo_barras: valor.trim() });
      await cargar();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    }
  }

  async function alternarActivo(producto) {
    if (producto.activo) await api.del(`/productos/${producto.id}`, session);
    else await api.put(`/productos/${producto.id}`, session, { activo: true });
    cargar();
  }

  return (
    <div>
      {error && <div className="error">{error}</div>}

      <div className="panel">
        <h2>Categorías</h2>
        {categorias
          .slice()
          .sort((a, b) => a.orden - b.orden)
          .map((c, i) => (
            <div key={c.id} className="toolbar" style={{ marginBottom: 4, opacity: c.activo ? 1 : 0.5 }}>
              <button className="boton-sm boton-secundario" disabled={i === 0} onClick={() => moverCategoria(c, -1)}>
                ↑
              </button>
              <button
                className="boton-sm boton-secundario"
                disabled={i === categorias.length - 1}
                onClick={() => moverCategoria(c, 1)}
              >
                ↓
              </button>
              {editandoCategoriaId === c.id ? (
                <>
                  <input
                    style={{ marginBottom: 0 }}
                    value={nombreCategoriaEdit}
                    onChange={(e) => setNombreCategoriaEdit(e.target.value)}
                  />
                  <button className="boton-sm" onClick={() => guardarCategoria(c)}>
                    Guardar
                  </button>
                  <button className="boton-sm boton-secundario" onClick={() => setEditandoCategoriaId(null)}>
                    Cancelar
                  </button>
                </>
              ) : (
                <>
                  <span className="chip">{c.nombre}</span>
                  <button className="boton-sm boton-secundario" onClick={() => editarCategoria(c)}>
                    Editar
                  </button>
                  <button className="boton-sm boton-secundario" onClick={() => alternarActivaCategoria(c)}>
                    {c.activo ? 'Desactivar' : 'Activar'}
                  </button>
                </>
              )}
            </div>
          ))}
        <div className="toolbar">
          <input placeholder="Nueva categoría" value={nuevaCategoria} onChange={(e) => setNuevaCategoria(e.target.value)} />
          <button className="boton-sm" onClick={crearCategoria}>
            Agregar
          </button>
        </div>
      </div>

      <div className="panel">
        <h2>{editandoId ? 'Editar producto' : 'Nuevo producto'}</h2>
        <div className="toolbar">
          <input placeholder="Código" value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} />
          <input
            placeholder="Código de barras (escríbelo o escanéalo)"
            value={form.codigo_barras}
            onChange={(e) => setForm({ ...form, codigo_barras: e.target.value })}
            onKeyDown={(e) => {
              // El lector termina con Enter: que no dispare nada más.
              if (e.key === 'Enter') e.preventDefault();
            }}
          />
          <input
            placeholder="Nombre"
            value={form.nombre}
            onChange={(e) => setForm({ ...form, nombre: e.target.value })}
          />
          <select value={form.categoria_id} onChange={(e) => setForm({ ...form, categoria_id: e.target.value })}>
            <option value="">Sin categoría</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
          <input
            type="number"
            step="0.01"
            placeholder="Precio"
            value={form.precio}
            onChange={(e) => setForm({ ...form, precio: e.target.value })}
          />
          <input
            type="number"
            step="0.01"
            placeholder="Tasa ISV (0.15)"
            value={form.impuesto1_tasa}
            onChange={(e) => setForm({ ...form, impuesto1_tasa: e.target.value })}
          />
          <button className="boton-sm" disabled={guardando || !form.nombre || !form.precio} onClick={guardarProducto}>
            {guardando ? 'Guardando…' : editandoId ? 'Guardar' : 'Agregar'}
          </button>
          {editandoId && (
            <button
              className="boton-sm boton-secundario"
              onClick={() => {
                setEditandoId(null);
                setForm(FORM_VACIO);
              }}
            >
              Cancelar
            </button>
          )}
        </div>

        <div className="toolbar">
          <input
            placeholder="Buscar por nombre o código…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
          <select value={categoriaFiltro} onChange={(e) => setCategoriaFiltro(e.target.value)}>
            <option value="">Todas las categorías</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </div>

        <table className="tabla">
          <thead>
            <tr>
              <th>Código</th>
              <th>Cód. barras</th>
              <th>Nombre</th>
              <th>Categoría</th>
              <th>Precio</th>
              <th>ISV</th>
              <th>Activo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {productosVisibles.map((p) => (
              <tr key={p.id}>
                <td>{p.codigo}</td>
                <td>
                  <CeldaCodigoBarras producto={p} onGuardar={guardarCodigoBarras} />
                </td>
                <td>{p.nombre}</td>
                <td>{p.categorias?.nombre ?? '—'}</td>
                <td>{fmtL(p.precio)}</td>
                <td>{(p.impuesto1_tasa * 100).toFixed(0)}%</td>
                <td>{p.activo ? 'Sí' : 'No'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="boton-sm boton-secundario" onClick={() => editar(p)}>
                    Editar
                  </button>{' '}
                  <button className="boton-sm boton-secundario" onClick={() => duplicar(p)}>
                    Duplicar
                  </button>{' '}
                  <button className="boton-sm boton-secundario" onClick={() => alternarActivo(p)}>
                    {p.activo ? 'Desactivar' : 'Activar'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
