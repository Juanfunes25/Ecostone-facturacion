import { Router } from 'express';
import { olvidarSesiones } from '../middleware/auth.js';
import { todasLasEmpresas } from '../lib/empresas.js';
import { db } from '../db.js';
import { requireRole } from '../middleware/requireRole.js';
import { registrarAuditoria } from '../lib/auditoria.js';
import { accesoAEmail, accesoVisible, claveInterna } from '../lib/acceso.js';
import { crearAlerta } from '../lib/alertas.js';

export const usuarios = Router();

// Empresas a las que puede entrar el usuario (por lo menos una, y que existan).
async function empresasValidas(entrada) {
  const existentes = new Set((await todasLasEmpresas()).map((e) => e.codigo));
  const lista = [...new Set((Array.isArray(entrada) ? entrada : ['ecostone']).filter((c) => existentes.has(c)))];
  return lista.length ? lista : ['ecostone'];
}

usuarios.get('/', requireRole('admin'), async (req, res) => {
  const { data, error } = await db.from('perfiles').select('*, sucursales(nombre)').order('nombre');
  if (error) return res.status(500).json({ error: error.message });

  const { data: authData } = await db.auth.admin.listUsers({ perPage: 200 });
  const authPorId = new Map((authData?.users ?? []).map((u) => [u.id, u]));
  res.json(data.map((u) => ({ ...u, acceso: accesoVisible(authPorId.get(u.id)) })));
});

// Crea el usuario en Supabase Auth y su perfil en un solo paso — así Juan no
// depende del dashboard de Supabase para dar de alta a un cajero nuevo.
usuarios.post('/', requireRole('admin'), async (req, res) => {
  const { acceso, password, nombre, rol, sucursal_id, cierre_ciego, sin_horario } = req.body;
  const empresasPerfil = rol === 'gestor' ? ['diserco'] : await empresasValidas(req.body.empresas);
  if (!String(acceso ?? '').trim() || !password || !String(nombre ?? '').trim()) {
    return res.status(400).json({ error: 'Usuario (o correo), contraseña y nombre son obligatorios' });
  }
  // Sin mínimo de largo ni restricción de caracteres: decisión de Juan.
  const usuarioEscrito = String(acceso).normalize('NFC').trim().replace(/\s+/g, ' ');

  let email;
  try {
    email = accesoAEmail(acceso);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const { data: authData, error: authError } = await db.auth.admin.createUser({
    email,
    password: claveInterna(password),
    email_confirm: true,
    user_metadata: { usuario: usuarioEscrito.includes('@') ? usuarioEscrito.toLowerCase() : usuarioEscrito },
  });
  if (authError) {
    const yaExiste = /already|registered|exists/i.test(authError.message);
    return res.status(400).json({ error: yaExiste ? `Ya existe un usuario "${usuarioEscrito}"` : authError.message });
  }
  const accesoMostrado = accesoVisible(authData.user);

  const { data: perfil, error: perfilError } = await db
    .from('perfiles')
    .insert({
      id: authData.user.id,
      nombre,
      rol: rol ?? 'cajero',
      sucursal_id: sucursal_id ?? null,
      empresas: empresasPerfil,
      cierre_ciego: !!cierre_ciego,
      sin_horario: !!sin_horario,
    })
    .select()
    .single();
  if (perfilError) {
    await db.auth.admin.deleteUser(authData.user.id);
    return res.status(500).json({ error: perfilError.message });
  }

  await registrarAuditoria(req, {
    accion: 'usuario.crear',
    entidad: 'usuario',
    entidadId: perfil.id,
    sucursalId: perfil.sucursal_id,
    detalle: { nombre, acceso: accesoMostrado, rol: perfil.rol },
  });
  // Altas, cambios de rol y de contraseña: quien controla usuarios controla
  // todo el sistema. Siempre avisa a los administradores.
  await crearAlerta(req, {
    tipo: 'usuario.crear',
    severidad: ['cajero', 'ventas'].includes(perfil.rol) ? 'media' : 'alta',
    titulo: `Nuevo usuario "${accesoMostrado}" (${perfil.rol}) creado por ${req.perfil.nombre}`,
    sucursalId: perfil.sucursal_id,
    entidad: 'usuario',
    entidadId: perfil.id,
    correo: !['cajero', 'ventas'].includes(perfil.rol),
    detalle: { nombre, usuario: accesoMostrado, rol: perfil.rol },
  });
  res.status(201).json({ ...perfil, acceso: accesoMostrado });
});

usuarios.put('/:id', requireRole('admin'), async (req, res) => {
  olvidarSesiones();
  const { nombre, rol, sucursal_id, cierre_ciego, sin_horario, activo } = req.body;
  const empresasPerfil = rol === 'gestor' ? ['diserco'] : req.body.empresas === undefined ? undefined : await empresasValidas(req.body.empresas);
  const { data: anterior } = await db.from('perfiles').select('*').eq('id', req.params.id).maybeSingle();
  const { data, error } = await db
    .from('perfiles')
    .update({ nombre, rol, sucursal_id, cierre_ciego, sin_horario, activo, empresas: empresasPerfil })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });

  if (anterior) {
    const cambios = {};
    for (const campo of ['nombre', 'rol', 'sucursal_id', 'cierre_ciego', 'sin_horario', 'activo', 'empresas']) {
      if (String(anterior[campo]) !== String(data[campo])) cambios[campo] = { antes: anterior[campo], despues: data[campo] };
    }
    if (Object.keys(cambios).length > 0) {
      await registrarAuditoria(req, {
        accion: 'usuario.editar',
        entidad: 'usuario',
        entidadId: data.id,
        sucursalId: data.sucursal_id,
        detalle: { nombre: data.nombre, cambios },
      });
      const sensible = cambios.rol || cambios.sin_horario || cambios.cierre_ciego || cambios.activo;
      if (sensible) {
        const partes = Object.entries(cambios).map(([k, c]) => `${k}: ${c.antes ?? '—'} → ${c.despues ?? '—'}`);
        await crearAlerta(req, {
          tipo: 'usuario.permisos',
          severidad: cambios.rol ? 'alta' : 'media',
          titulo: `Cambió permisos de ${data.nombre} (${partes.join(', ')})`,
          sucursalId: data.sucursal_id,
          entidad: 'usuario',
          entidadId: data.id,
          correo: Boolean(cambios.rol),
          detalle: { usuario: data.nombre, cambios: partes.join(' · '), por: req.perfil.nombre },
        });
      }
    }
  }
  res.json(data);
});

// Para que Juan pueda resetear la contraseña de un cajero sin tener que
// entrar al dashboard de Supabase.
usuarios.post('/:id/reset-password', requireRole('admin'), async (req, res) => {
  olvidarSesiones();
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Escribe la contraseña nueva' });
  const { error } = await db.auth.admin.updateUserById(req.params.id, { password: claveInterna(password) });
  if (error) return res.status(400).json({ error: error.message });
  await registrarAuditoria(req, {
    accion: 'usuario.cambiar_contrasena',
    entidad: 'usuario',
    entidadId: req.params.id,
  });
  const { data: afectado } = await db.from('perfiles').select('nombre, sucursal_id, rol').eq('id', req.params.id).maybeSingle();
  await crearAlerta(req, {
    tipo: 'usuario.contrasena',
    severidad: afectado?.rol === 'admin' ? 'alta' : 'media',
    titulo: `Se cambió la contraseña de ${afectado?.nombre ?? 'un usuario'} (por ${req.perfil.nombre})`,
    sucursalId: afectado?.sucursal_id ?? null,
    entidad: 'usuario',
    entidadId: req.params.id,
    correo: afectado?.rol === 'admin',
    detalle: { usuario: afectado?.nombre ?? '', por: req.perfil.nombre },
  });
  res.json({ ok: true });
});
