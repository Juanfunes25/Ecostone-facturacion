import nodemailer from 'nodemailer';
import { db } from '../db.js';

// Replica el "Resumen de Impuestos" que WizPOS manda solo tras cada cierre.
// No-op si no están configuradas las credenciales — no bloquea el cierre
// aunque falle o no esté configurado el correo.
function transportadorDisponible() {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

function crearTransportador() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
}

// Correos de todos los administradores activos (los usuarios con nombre de
// usuario tienen un correo interno @ecostone.local que no recibe mensajes) más
// RESUMEN_CIERRE_EMAIL si está configurado.
export async function destinatariosAdmins() {
  const lista = new Set();
  if (process.env.RESUMEN_CIERRE_EMAIL) {
    for (const c of process.env.RESUMEN_CIERRE_EMAIL.split(',')) if (c.trim()) lista.add(c.trim().toLowerCase());
  }
  try {
    const { data: admins } = await db.from('perfiles').select('id').eq('rol', 'admin').eq('activo', true);
    const ids = new Set((admins ?? []).map((a) => a.id));
    const { data } = await db.auth.admin.listUsers({ perPage: 200 });
    for (const u of data?.users ?? []) {
      if (ids.has(u.id) && u.email && !u.email.endsWith('@ecostone.local')) lista.add(u.email.toLowerCase());
    }
  } catch (e) {
    console.error('[correo] destinatarios', e.message);
  }
  if (lista.size === 0 && process.env.GMAIL_USER) lista.add(process.env.GMAIL_USER);
  return [...lista];
}

const COLOR_SEVERIDAD = { alta: '#b3261e', media: '#9a6a00', baja: '#1f6096' };

export async function enviarAlertaAdmins(alerta) {
  if (!transportadorDisponible()) return { enviado: false, motivo: 'GMAIL_USER/GMAIL_APP_PASSWORD no configurados' };
  const destinatarios = await destinatariosAdmins();
  if (destinatarios.length === 0) return { enviado: false, motivo: 'Sin destinatarios' };
  const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const filas = Object.entries(alerta.detalle ?? {})
    .filter(([, v]) => v !== null && typeof v !== 'object')
    .map(([k, v]) => `<tr><td style="color:#6b6a5e;padding:3px 12px 3px 0">${esc(k.replace(/_/g, ' '))}</td><td style="padding:3px 0"><strong>${esc(v)}</strong></td></tr>`)
    .join('');
  const cuando = new Date(alerta.created_at).toLocaleString('es-HN', { timeZone: 'America/Tegucigalpa' });
  await crearTransportador().sendMail({
    from: process.env.GMAIL_USER,
    to: destinatarios.join(', '),
    subject: `⚠ ${alerta.titulo}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px">
        <div style="border-left:5px solid ${COLOR_SEVERIDAD[alerta.severidad] ?? '#9a6a00'};padding:10px 16px;background:#faf6ec">
          <div style="font-size:12px;color:#6b6a5e">ALERTA ${esc(alerta.severidad).toUpperCase()} · ${esc(alerta.sucursales?.nombre ?? '')} · ${cuando}</div>
          <h2 style="margin:6px 0">${esc(alerta.titulo)}</h2>
          <div style="color:#6b6a5e">Usuario: ${esc(alerta.usuario_nombre ?? '—')}</div>
        </div>
        <table style="margin-top:12px;font-size:14px">${filas}</table>
        <p style="font-size:12px;color:#6b6a5e;margin-top:16px">Revísala en EcoStone Facturación → Antifraude.</p>
      </div>`,
  });
  return { enviado: true };
}

export async function enviarResumenCierre(cierre, sucursalNombre) {
  if (!transportadorDisponible()) return { enviado: false, motivo: 'GMAIL_USER/GMAIL_APP_PASSWORD no configurados' };

  const destinatario = (await destinatariosAdmins()).join(', ');
  const asunto = `Cierre de caja — ${sucursalNombre} — ${new Date(cierre.fecha_fin).toLocaleDateString('es-HN')}`;
  const L = (n) => `L ${Number(n ?? 0).toFixed(2)}`;
  const dif = (n) => {
    const d = Number(n ?? 0);
    const color = Math.abs(d) < 0.005 ? '#1a7a42' : '#b3261e';
    const texto = Math.abs(d) < 0.005 ? 'Cuadra' : d < 0 ? 'Faltante' : 'Sobrante';
    return `<strong style="color:${color}">${texto} ${L(Math.abs(d))}</strong>`;
  };
  const zona = { timeZone: 'America/Tegucigalpa' };
  const cuerpo = `
    <h2>Cierre de caja — ${sucursalNombre}</h2>
    <p>Del ${new Date(cierre.fecha_inicio).toLocaleString('es-HN', zona)} al ${new Date(cierre.fecha_fin).toLocaleString('es-HN', zona)}
       · Cajero: ${cierre.cajero?.nombre ?? ''}</p>
    <p>Facturas ${cierre.factura_desde ?? '—'} a ${cierre.factura_hasta ?? '—'} (${cierre.cantidad_facturas ?? 0}) · Total ventas ${L(cierre.total_ventas)}</p>
    <table cellpadding="6" style="border-collapse:collapse;border:1px solid #ddd">
      <tr style="background:#f4f4f4"><th align="left">Forma</th><th align="right">Sistema</th><th align="right">Reportado</th><th align="right">Diferencia</th></tr>
      <tr><td>Tarjeta (POS BAC ${L(cierre.pos_bac)} + Ficohsa ${L(cierre.pos_ficohsa)})</td>
          <td align="right">${L(cierre.tarjeta_sistema)}</td>
          <td align="right">${L(Number(cierre.pos_bac ?? 0) + Number(cierre.pos_ficohsa ?? 0))}</td>
          <td align="right">${dif(cierre.diferencia_tarjeta)}</td></tr>
      <tr><td>Efectivo (fondo ${L(cierre.fondo_caja)}, salidas ${L(cierre.salidas)})</td>
          <td align="right">${L(cierre.total_esperado)}</td>
          <td align="right">${L(cierre.efectivo_contado)}</td>
          <td align="right">${dif(cierre.diferencia_efectivo)}</td></tr>
      <tr><td>Transferencias</td><td align="right">${L(cierre.transferencia_sistema)}</td><td></td><td></td></tr>
      <tr style="background:#f4f4f4"><td><strong>Total</strong></td><td></td><td></td><td align="right">${dif(cierre.diferencia)}</td></tr>
    </table>
    ${cierre.observaciones ? `<p><strong>Observaciones:</strong> ${String(cierre.observaciones).replace(/</g, '&lt;')}</p>` : ''}
  `;

  try {
    await crearTransportador().sendMail({
      from: process.env.GMAIL_USER,
      to: destinatario,
      subject: asunto,
      html: cuerpo,
    });
    return { enviado: true };
  } catch (e) {
    return { enviado: false, motivo: e.message };
  }
}

// Manda la cotización de proyecto en PDF al cliente (a pedido, botón "Enviar").
export async function enviarCotizacionCliente(cotizacion, pdfBuffer, destinatario) {
  if (!transportadorDisponible()) return { enviado: false, motivo: 'GMAIL_USER/GMAIL_APP_PASSWORD no configurados' };
  if (!destinatario) return { enviado: false, motivo: 'El cliente no tiene correo registrado' };
  const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const total = `L ${Number(cotizacion.total).toLocaleString('es-HN', { minimumFractionDigits: 2 })}`;
  const cuerpo = `
  <div style="background:#f4f1ea;padding:24px 0;font-family:Arial,sans-serif">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">
      <tr><td style="background:#2b2d2f;padding:22px 28px;border-bottom:4px solid #5f7a4a">
        <div style="color:#fff;font-size:26px;font-weight:800;letter-spacing:2px">ECOSTONE</div>
        <div style="color:#e8e0d0;font-size:11px;letter-spacing:4px">PIEDRA DE ENCHAPE</div>
      </td></tr>
      <tr><td style="padding:26px 28px;color:#1c1d1f">
        <p style="font-size:18px;font-weight:700;margin:0 0 8px">Hola, ${esc((cotizacion.nombre_cliente ?? '').split(' ')[0])}</p>
        <p style="font-size:14px;color:#6b6a5e;line-height:1.5;margin:0 0 18px">Gracias por considerarnos para <strong style="color:#1c1d1f">${esc(cotizacion.proyecto)}</strong>. Te adjuntamos la cotización #${cotizacion.numero} en PDF.</p>
        <div style="background:#2b2d2f;border-radius:10px;padding:14px 18px;color:#fff"><span style="color:#e8e0d0;font-size:11px;letter-spacing:2px">TOTAL</span><br><span style="font-size:24px;font-weight:700">${total}</span></div>
        <p style="font-size:13px;color:#6b6a5e;margin:18px 0 0">Cualquier duda, respóndenos este correo. Quedamos atentos.</p>
      </td></tr>
    </table>
  </div>`;
  try {
    await crearTransportador().sendMail({ from: process.env.GMAIL_USER, to: destinatario, subject: `Cotización #${cotizacion.numero} — ${cotizacion.proyecto} — EcoStone`, html: cuerpo, attachments: [{ filename: `cotizacion-${cotizacion.numero}.pdf`, content: pdfBuffer }] });
    return { enviado: true };
  } catch (e) {
    return { enviado: false, motivo: e.message };
  }
}

// Manda la factura en PDF al correo del cliente apenas se cobra (si el
// cliente tiene correo registrado). Igual que el resumen de cierre: no-op
// si no hay credenciales, nunca bloquea el cobro.
export async function enviarFacturaCliente(venta, pdfBuffer) {
  if (!transportadorDisponible()) return { enviado: false, motivo: 'GMAIL_USER/GMAIL_APP_PASSWORD no configurados' };
  if (!venta.clientes?.email) return { enviado: false, motivo: 'El cliente no tiene correo registrado' };

  const esBorrador = venta.puntos_emision?.es_borrador;
  const asunto = `${esBorrador ? '[Documento interno] ' : ''}Factura ${venta.numero_factura} — EcoStone`;
  const cuerpo = `
    <p>Hola ${venta.clientes?.nombre ?? ''},</p>
    <p>Gracias por tu compra en EcoStone. Adjunto va tu factura ${venta.numero_factura}.</p>
    ${esBorrador ? '<p><strong>Nota:</strong> este documento es un comprobante interno, todavía sin validez fiscal.</p>' : ''}
    <p>Total: L ${Number(venta.total).toFixed(2)}</p>
  `;

  try {
    await crearTransportador().sendMail({
      from: process.env.GMAIL_USER,
      to: venta.clientes.email,
      subject: asunto,
      html: cuerpo,
      attachments: [{ filename: `factura-${venta.numero_factura}.pdf`, content: pdfBuffer }],
    });
    return { enviado: true };
  } catch (e) {
    return { enviado: false, motivo: e.message };
  }
}
