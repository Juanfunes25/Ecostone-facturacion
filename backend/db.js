import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el entorno');
}

// Cliente admin: usa la service_role key y por lo tanto bypassa RLS.
// Toda escritura de negocio (ventas, cierres, notas de crédito) pasa por el
// backend, nunca directo desde el frontend — así se controla el correlativo
// del CAI de forma atómica.
export const db = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
