// Una respuesta de otra sesión o de un intento anterior no debe mostrarse.
export function estadoCargaSucursales(usuarioId, intento, consulta) {
  if (!usuarioId) return { sucursales: [], cargando: false, error: null };
  if (consulta?.usuarioId !== usuarioId || consulta.intento !== intento) {
    return { sucursales: [], cargando: true, error: null };
  }
  if (consulta.error) {
    return { sucursales: [], cargando: false, error: 'No se pudieron cargar los almacenes y tiendas. Reintenta la consulta.' };
  }
  const sucursales = (consulta.data || []).filter(s => s.tipo !== 'virtual');
  return {
    sucursales,
    cargando: false,
    error: sucursales.length ? null : 'Tu cuenta no tiene almacenes o tiendas disponibles. Consulta al administrador.',
  };
}

export function elegirSucursalDisponible(sucursales, elegidaId) {
  return sucursales.find(s => Number(s.id) === Number(elegidaId))?.id ?? sucursales[0]?.id ?? null;
}
