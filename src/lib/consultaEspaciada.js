// Consulta periódica que se espacia sola: 15 s, 30 s, 1 min, 2 min… hasta 5 min.
// Se pausa con la pantalla oculta y, al volver, consulta una vez si pasaron más
// de 10 s. Evita que varios celulares abiertos todo el turno llenen los logs.
// `consultar` devuelve 'seguir' (hay envíos pendientes), 'error' o 'listo'.
export function consultaEspaciada(consultar, { inicial = 15000, maximo = 300000, minimoAlVolver = 10000 } = {}) {
  let timer = null, espera = inicial, ultima = 0, activo = true;
  const oculta = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';
  function programar(ms) {
    clearTimeout(timer);
    if (activo && !oculta()) timer = setTimeout(ejecutar, ms);
  }
  async function ejecutar() {
    if (!activo) return;
    ultima = Date.now();
    const resultado = await consultar();
    if (!activo) return;
    if (resultado === 'seguir' || resultado === 'error') {
      programar(resultado === 'error' ? Math.max(espera, 30000) : espera);
      espera = Math.min(espera * 2, maximo);
    } else espera = inicial;
  }
  function alVolver() {
    if (oculta()) { clearTimeout(timer); return; }
    if (Date.now() - ultima < minimoAlVolver) return;
    clearTimeout(timer); espera = inicial; ejecutar();
  }
  window.addEventListener('focus', alVolver);
  document.addEventListener('visibilitychange', alVolver);
  ejecutar();
  return () => {
    activo = false; clearTimeout(timer);
    window.removeEventListener('focus', alVolver);
    document.removeEventListener('visibilitychange', alVolver);
  };
}
