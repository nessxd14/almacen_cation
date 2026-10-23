import { describe, expect, it } from 'vitest';
import { capturaRapidaTurno, corregirCapturaTurno, convertirConteo, documentoHojaConteo, equivalenciaReporte, fechaReporte, formularioLinea, turnoEnCurso } from './reporteTurno';

const linea = { id:1,numero:1,nombre:'Bolígrafos <QA>',sku:'QA-01',unidad:'unidad',ubicacion:'PB / Estante A / 1',factor:12,empaque:'Caja',esperado:98765,declarado:87654 };
const reporte = { folio:'AT-QA-1',fecha:'2026-10-19',turno:'MANANA',sucursal:'Almacén QA',responsable:'Cuenta QA',version:2 };
describe('hoja y transcripción de turnos', () => {
  it('distingue pendiente y cero, y convierte cajas y unidades sin duplicarlas', () => {
    expect(convertirConteo({empaques:'',sueltas:'',contado_en:''},linea).total).toBeNull();
    expect(convertirConteo({empaques:'0',sueltas:'0',contado_en:'2026-10-19T12:00'},linea)).toMatchObject({total:0,contado_en:'2026-10-19T16:00:00.000Z'});
    expect(convertirConteo({empaques:'2',sueltas:'3',contado_en:'2026-10-19T12:00'},linea).total).toBe(27);
    expect(equivalenciaReporte(27,linea)).toBe('2 Caja + 3 unidad');
  });
  it('rechaza captura incompleta, empaques fraccionarios, negativos y sueltas que completan otra caja', () => {
    for (const cantidades of [{empaques:'',sueltas:'3'},{empaques:'1.5',sueltas:'0'},{empaques:'-1',sueltas:'0'},{empaques:'1',sueltas:'12'},{empaques:'0',sueltas:'0.00001'}]) {
      expect(()=>convertirConteo({...cantidades,contado_en:'2026-10-19T12:00'},linea)).toThrow();
    }
    expect(convertirConteo({empaques:'',sueltas:'3.25',contado_en:'2026-10-19T12:00'},{...linea,factor:1}).total).toBe(3.25);
  });
  it('imprime sin cantidades de referencia ni declaraciones, escapa el catálogo y conserva folio y renglón', () => {
    const html=documentoHojaConteo({reporte,lineas:[linea]});
    expect(html).toContain('AT-QA-1');expect(html).toContain('Bolígrafos &lt;QA&gt;');
    expect(html).not.toContain('98765');expect(html).not.toContain('87654');
    expect(html).toContain('Página 1 / 1');expect(html).toContain('Casilla vacía = pendiente');
  });
  it('la hoja de recepción solo incluye pendientes y conserva su numeración original', () => {
    const html=documentoHojaConteo({reporte,lineas:[{...linea,numero:7,pendiente:true},{...linea,id:2,nombre:'NO INCLUIR',pendiente:false}]},{recepcion:true});
    expect(html).toContain('<td>7</td>');expect(html).not.toContain('NO INCLUIR');
  });
  it('usa Bolivia aun cuando el navegador está en otro huso horario', () => {
    expect(fechaReporte('2026-10-20T02:30:00Z')).toBe('2026-10-19');
    expect(formularioLinea({...linea,empaques:0,sueltas:0,contado_en:'2026-10-19T16:00:00Z'})).toMatchObject({empaques:0,sueltas:0,contado_en:'2026-10-19T12:00'});
  });
  it('captura en vivo con hora de confirmación y completa solo la casilla complementaria',()=>{
    const ahora='2026-10-19T15:31:24.235Z';
    expect(capturaRapidaTurno({empaques:'2',sueltas:''},linea,reporte,ahora)).toMatchObject({id:1,empaques:2,sueltas:0,contado_en:ahora});
    expect(capturaRapidaTurno({empaques:'',sueltas:'3'},linea,reporte,ahora)).toMatchObject({empaques:0,sueltas:3});
    expect(()=>capturaRapidaTurno({empaques:'',sueltas:''},linea,reporte,ahora)).toThrow('Escribe una cantidad');
    expect(()=>capturaRapidaTurno({empaques:'2.5',sueltas:''},linea,reporte,ahora)).toThrow('empaques enteros');
    expect(()=>capturaRapidaTurno({empaques:'',sueltas:'12'},linea,reporte,ahora)).toThrow('Convierte');
  });
  it('impide atribuir la hora actual a una captura de otro turno o fecha',()=>{
    expect(turnoEnCurso(reporte,'2026-10-19T11:29:59Z')).toBe(false);
    expect(turnoEnCurso(reporte,'2026-10-19T11:30:00Z')).toBe(true);
    expect(turnoEnCurso(reporte,'2026-10-19T16:30:01Z')).toBe(false);
    expect(()=>capturaRapidaTurno({empaques:'1',sueltas:'0'},linea,reporte,'2026-10-20T15:00:00Z')).toThrow('Transcribir papel');
  });
  it('corrige una cantidad conservando la hora física original y exige una referencia válida',()=>{
    const contado_en='2026-10-19T15:31:24.235Z';
    expect(corregirCapturaTurno({empaques:'2',sueltas:'3'},{...linea,contado_en},reporte)).toMatchObject({empaques:2,sueltas:3,contado_en});
    expect(()=>corregirCapturaTurno({empaques:'',sueltas:''},{...linea,contado_en},reporte)).toThrow('Escribe la cantidad');
    expect(()=>corregirCapturaTurno({empaques:'1',sueltas:'0'},{...linea,contado_en:'2026-10-19T18:00:00Z'},reporte)).toThrow('hora válida');
  });
});
