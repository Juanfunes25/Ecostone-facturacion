import { Router } from 'express';
import { db } from '../db.js';
import { requireRole } from '../middleware/requireRole.js';
import { registrarAuditoria } from '../lib/auditoria.js';
import { crearAlerta } from '../lib/alertas.js';

export const puntosEmision = Router();

const UMBRAL_ALERTA_PORCENTAJE = 0.9; // avisar cuando queda <10% del rango
const UMBRAL_ALERTA_DIAS = 15; // avisar cuando quedan <15 días para el vencimiento

function calcularEstado(pe) {
  const rango = pe.correlativo_hasta - pe.correlativo_desde + 1;
  const usados = pe.correlativo_actual - pe.correlativo_desde;
  const porcentaje_usado = rango > 0 ? Math.min(1, Math.max(0, usados / rango)) : 1;

  let dias_restantes = null;
  if (pe.fecha_limite_emision) {
    const hoy = new Date();
    const limite = new Date(pe.fecha_limite_emision);
    dias_restantes = Math.ceil((limite - hoy) / (1000 * 60 * 60 * 24));
  }

  const alerta_rango = porcentaje_usado >= UMBRAL_ALERTA_PORCENTAJE;
  const alerta_fecha = dias_restantes !== null && dias_restantes <= UMBRAL_ALERTA_DIAS;
  const agotado = pe.correlativo_actual > pe.correlativo_hasta;
  const vencido = dias_restantes !== null && dias_restantes < 0;

  return {
    ...pe,
    porcentaje_usado: Math.round(porcentaje_usado * 1000) / 10,
    dias_restantes,
    alerta: alerta_rango || alerta_fecha || agotado || vencido,
    agotado,
    vencido,
  };
}

puntosEmision.get('/estado', requireRole('admin', 'gerente'), async (req, res) => {
  const { data, error } = await db
    .from('puntos_emision')
    .select('*, sucursales(nombre, alias)')
    .eq('activo', true);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data.map(calcularEstado));
});

// Versión reducida y accesible para cualquier rol (incluye cajero): sólo el
// estado del punto de emisión de SU sucursal, para avisarle en el POS antes
// de cobrar si el CAI está por vencer o agotarse — sin exponerle el estado
// de las otras sucursales.
puntosEmision.get('/sucursal/:sucursal_id/estado', async (req, res) => {
  const { data, error } = await db
    .from('puntos_emision')
    .select('id, es_borrador, cai, fecha_limite_emision, correlativo_desde, correlativo_hasta, correlativo_actual, activo')
    .eq('sucursal_id', req.params.sucursal_id)
    .eq('activo', true)
    .single();
  if (error || !data) return res.status(404).json({ error: 'Sin punto de emisión activo para esta sucursal' });
  res.json(calcularEstado(data));
});

// CAI del SAR: 32 caracteres hexadecimales en grupos 6-6-6-6-6-2.
const CAI_VALIDO = /^[0-9A-F]{6}(-[0-9A-F]{6}){4}-[0-9A-F]{2}$/;

// Acepta el CAI pegado con o sin guiones/espacios y lo deja con el formato oficial.
function normalizarCai(valor) {
  const texto = String(valor ?? '').toUpperCase().replace(/[\s-]/g, '');
  if (!texto) return null;
  if (/^[0-9A-F]{32}$/.test(texto)) return texto.match(/.{1,6}/g).join('-');
  return String(valor).trim().toUpperCase();
}
const CAMPOS_EDITABLES = [
  'cai',
  'punto_emision_codigo',
  'punto_venta_codigo',
  'tipo_documento_codigo',
  'correlativo_desde',
  'correlativo_hasta',
  'correlativo_actual',
  'fecha_limite_emision',
  'es_borrador',
];

function numeroFactura(pe, correlativo) {
  return `${pe.punto_emision_codigo}-${pe.punto_venta_codigo}-${pe.tipo_documento_codigo}-${String(correlativo).padStart(8, '0')}`;
}

// Revisa que el punto de emisión quede en un estado que el SAR acepte antes
// de guardarlo como fiscal (no borrador).
function problemaCaiReal(pe) {
  if (!pe.cai || !CAI_VALIDO.test(pe.cai)) {
    return 'El CAI debe tener el formato del SAR: 32 caracteres en grupos 6-6-6-6-6-2 (ej. 2F4851-96A881-B76670-CE6CCE-48D250-32)';
  }
  if (!/^\d{3}$/.test(pe.punto_emision_codigo ?? '')) return 'El código de establecimiento debe tener 3 dígitos (ej. 001)';
  if (!/^\d{3}$/.test(pe.punto_venta_codigo ?? '')) return 'El código de punto de emisión debe tener 3 dígitos (ej. 001)';
  if (!/^\d{2}$/.test(pe.tipo_documento_codigo ?? '')) return 'El tipo de documento debe tener 2 dígitos (01 = factura)';
  const desde = Number(pe.correlativo_desde);
  const hasta = Number(pe.correlativo_hasta);
  const actual = Number(pe.correlativo_actual);
  if (!Number.isInteger(desde) || desde < 1) return 'El rango autorizado "desde" debe ser un número entero mayor que 0';
  if (!Number.isInteger(hasta) || hasta < desde) return 'El rango autorizado "hasta" debe ser mayor o igual que "desde"';
  if (!Number.isInteger(actual) || actual < desde || actual > hasta) {
    return `La próxima factura debe estar dentro del rango autorizado (${desde} a ${hasta})`;
  }
  if (!pe.fecha_limite_emision) return 'Falta la fecha límite de emisión que aparece en la resolución del SAR';
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Tegucigalpa' });
  if (pe.fecha_limite_emision < hoy) return 'La fecha límite de emisión ya pasó';
  return null;
}

// Editar el CAI y, sobre todo, ACTIVARLO: al pasar es_borrador de true a
// false las facturas de la sucursal empiezan a tener validez fiscal. Sólo
// se cambian los campos que vienen en el cuerpo (los demás se conservan).
puntosEmision.put('/:id', requireRole('admin'), async (req, res) => {
  const { data: anterior, error: errAnterior } = await db
    .from('puntos_emision')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle();
  if (errAnterior) return res.status(500).json({ error: errAnterior.message });
  if (!anterior) return res.status(404).json({ error: 'Punto de emisión no encontrado' });

  const cambiosPedidos = {};
  for (const campo of CAMPOS_EDITABLES) {
    if (req.body[campo] === undefined) continue;
    let valor = req.body[campo];
    if (['correlativo_desde', 'correlativo_hasta', 'correlativo_actual'].includes(campo)) valor = Number(valor);
    if (campo === 'es_borrador') valor = valor === true || valor === 'true';
    if (campo === 'cai') valor = normalizarCai(valor);
    if (campo === 'fecha_limite_emision') valor = valor || null;
    if (['punto_emision_codigo', 'punto_venta_codigo', 'tipo_documento_codigo'].includes(campo)) valor = String(valor).trim();
    cambiosPedidos[campo] = valor;
  }
  const resultante = { ...anterior, ...cambiosPedidos };

  if (!resultante.es_borrador) {
    const problema = problemaCaiReal(resultante);
    if (problema) return res.status(400).json({ error: problema });

    // Ningún número del rango que queda por usar puede existir ya (las de
    // prueba llevan el prefijo BORRADOR-, así que no chocan).
    const { data: repetida, error: errRepetida } = await db
      .from('ventas')
      .select('numero_factura')
      .gte('numero_factura', numeroFactura(resultante, resultante.correlativo_actual))
      .lte('numero_factura', numeroFactura(resultante, resultante.correlativo_hasta))
      .limit(1);
    if (errRepetida) return res.status(500).json({ error: errRepetida.message });
    if (repetida.length > 0) {
      return res.status(409).json({
        error: `La factura ${repetida[0].numero_factura} ya existe. Sube "próxima factura" a un número que no se haya usado.`,
      });
    }
  }

  const { data, error } = await db
    .from('puntos_emision')
    .update(cambiosPedidos)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) {
    const duplicado = /duplicate|unique/i.test(error.message);
    return res.status(duplicado ? 409 : 500).json({
      error: duplicado ? 'Ese CAI ya está registrado en otro punto de emisión' : error.message,
    });
  }

  // Mover el correlativo o el CAI a mano es lo más delicado fiscalmente —
  // queda registrado quién lo hizo y qué valores había antes.
  if (anterior) {
    const cambios = {};
    for (const campo of CAMPOS_EDITABLES) {
      if (String(anterior[campo]) !== String(data[campo])) cambios[campo] = { antes: anterior[campo], despues: data[campo] };
    }
    if (Object.keys(cambios).length > 0) {
      await registrarAuditoria(req, {
        accion: anterior.es_borrador && !data.es_borrador ? 'cai.activar' : 'cai.editar',
        entidad: 'punto_emision',
        entidadId: data.id,
        sucursalId: data.sucursal_id,
        detalle: { cambios },
      });
      // Mover el correlativo hacia atrás permitiría repetir números de
      // factura; cualquier cambio fiscal se avisa por correo.
      const resumen = Object.entries(cambios)
        .map(([k, c]) => `${k}: ${c.antes ?? '—'} → ${c.despues ?? '—'}`)
        .join(' · ');
      const retroceso = cambios.correlativo_actual && Number(cambios.correlativo_actual.despues) < Number(cambios.correlativo_actual.antes);
      await crearAlerta(req, {
        tipo: 'cai.cambio',
        severidad: 'alta',
        titulo: `${retroceso ? 'Correlativo movido HACIA ATRÁS' : 'Cambio en CAI / correlativo'} (${req.perfil.nombre})`,
        sucursalId: data.sucursal_id,
        entidad: 'punto_emision',
        entidadId: data.id,
        correo: true,
        detalle: { cambios: resumen, por: req.perfil.nombre },
      });
    }
  }
  res.json(calcularEstado(data));
});
