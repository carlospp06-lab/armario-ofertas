// Descarga ofertas de Google Shopping (vía SerpApi) y las guarda en ofertas.json.
// Lo ejecuta GitHub Actions cada día. La clave va en el secreto SERPAPI_KEY.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const KEY = process.env.SERPAPI_KEY;
if (!KEY) { console.error('Falta el secreto SERPAPI_KEY'); process.exit(1); }
const cfg = JSON.parse(readFileSync('busquedas.json', 'utf8'));
const g = cfg.genero || 'hombre';
const n = cfg.consultas.length, porDia = Math.min(cfg.por_dia || 8, n);
const dia = Math.floor(Date.now() / 864e5);
const hoy = [...Array(porDia)].map((_, i) => cfg.consultas[(dia * porDia + i) % n].replace('{g}', g));

const prev = existsSync('ofertas.json') ? JSON.parse(readFileSync('ofertas.json', 'utf8')) : { ofertas: [] };
const limite = Date.now() - (cfg.dias_guardadas || 4) * 864e5;
const mapa = new Map(prev.ofertas.filter(o => o.f > limite).map(o => [o.id, o]));
const registro = [];

const hash = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return 'h' + (h >>> 0).toString(36); };
const esOferta = r => (r.extracted_old_price > r.extracted_price) ||
  /%|rebaj|oferta|descuento|sale/i.test([r.tag, ...(r.extensions || [])].join(' '));

async function buscar(q, onSale) {
  const u = new URL('https://serpapi.com/search.json');
  Object.entries({ engine: 'google_shopping', q, gl: 'es', hl: 'es', google_domain: 'google.es', api_key: KEY })
    .forEach(([k, v]) => u.searchParams.set(k, v));
  if (onSale) u.searchParams.set('on_sale', 'true');
  const r = await fetch(u);
  return r.json();
}

for (const q of hoy) {
  try {
    let j = await buscar(q, true);
    if (j.error && !/no results/i.test(j.error)) j = await buscar(q, false);
    if (j.error) { registro.push({ q, error: j.error }); continue; }
    const res = [...(j.shopping_results || []), ...(j.inline_shopping_results || [])];
    let n = 0;
    for (const r of res) {
      if (!r.title || !r.extracted_price || !esOferta(r)) continue;
      const id = r.product_id || hash(r.title + '|' + r.source);
      mapa.set(id, {
        id, t: r.title, s: r.source || '', p: r.extracted_price,
        o: r.extracted_old_price > r.extracted_price ? r.extracted_old_price : null,
        img: r.thumbnail || null, url: r.link || r.product_link || null,
        tag: r.tag || (r.extensions || []).find(e => /%/.test(e)) || null,
        q, f: Date.now()
      });
      n++;
    }
    registro.push({ q, resultados: res.length, ofertas: n });
  } catch (e) { registro.push({ q, error: String(e) }); }
}

const ofertas = [...mapa.values()].sort((a, b) => b.f - a.f).slice(0, 1500);
writeFileSync('ofertas.json', JSON.stringify({ actualizado: new Date().toISOString(), genero: g, total: ofertas.length, registro, ofertas }));
console.log(JSON.stringify(registro, null, 1), '\nTotal guardadas:', ofertas.length);
