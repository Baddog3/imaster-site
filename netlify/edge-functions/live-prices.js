const categories = new Map([
  ['Смартфоны', 'smartphones'],
  ['Планшеты', 'tablets'],
  ['Ноутбуки', 'laptops'],
  ['Аксессуары', 'accessories'],
]);
const sheetHeader = ['Категория', 'Бренд', 'Модель', 'Услуга', 'Цена, ₽', 'Срок', 'Гарантия', 'На сайте'];
const catalogBoundary = /(<!-- catalog:start -->)[\s\S]*?(<!-- catalog:end -->)/;
const escapes = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;'};
const escape = (value) => value.replace(/[&<>"']/g, character => escapes[character]);

export const config = {
  path: ['/ceny', '/ceny.html'],
  cache: 'manual',
  onError: 'bypass',
};

function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const field = /(?:"((?:[^"]|"")*)"|([^",\r\n]*))(,|\r\n|\n|\r|$)/y;
  const records = [];
  let row = [];
  let offset = 0;
  do {
    const match = field.exec(text);
    if (!match) throw new Error('Invalid CSV field');
    row.push(match[1] === undefined ? match[2] : match[1].replaceAll('""', '"'));
    offset = field.lastIndex;
    if (match[3] !== ',') {
      records.push(row);
      row = [];
    }
  } while (offset < text.length || row.length);
  return records;
}

function readCatalog(text) {
  const [header, ...records] = parseCsv(text);
  if (header.length !== sheetHeader.length || !sheetHeader.every((name, i) => header[i] === name)) {
    throw new Error('Unexpected price sheet columns');
  }
  const catalog = new Map();
  let hasEntries = false;
  for (const record of records) {
    const values = record.map(value => value.trim());
    if (!values.some(Boolean)) continue;
    hasEntries = true;
    const [category, brand, model, service, price, time, warranty, status] = values;
    if (values.length !== sheetHeader.length) throw new Error('Unexpected price row width');
    if (status.toLowerCase() === 'нет') continue;
    if ((status && status.toLowerCase() !== 'да') || !categories.has(category) || !brand || !model || !service ||
        !/^[0-9][0-9 /–—.,\-\u00a0\u202f]*$/.test(price)) {
      throw new Error('Invalid row in price sheet');
    }
    if (!catalog.has(category)) catalog.set(category, new Map());
    const models = catalog.get(category);
    if (!models.has(model)) models.set(model, []);
    models.get(model).push({service, price, time, warranty});
  }
  if (!hasEntries) throw new Error('Empty price sheet');
  return catalog;
}

async function modelId(key, model) {
  const slug = model.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'model';
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(model));
  const suffix = Array.from(new Uint8Array(hash, 0, 4), byte => byte.toString(16).padStart(2, '0')).join('');
  return `${key}-${slug}-${suffix}`;
}

function renderService({service, price, time, warranty}) {
  const amount = escape(price) + (/^\d+$/.test(price) ? ' ₽' : '');
  const note = price.includes('/') ? '<small class="price-note">В исходном прайсе несколько значений. Уточните цену для вашей модели по телефону.</small>' : '';
  return `<tr><td>${escape(service)}</td><td class="price-value" data-label="Цена">${amount}${note}</td><td data-label="Срок">${escape(time || '—')}</td><td data-label="Гарантия">${escape(warranty || '—')}</td></tr>`;
}

async function render(catalog) {
  if (!catalog.size) return '<p>Уточните стоимость ремонта <a href="tel:+74012905015">по телефону</a>.</p>';
  const tabs = [];
  const buttons = [];
  const sections = [];
  for (const [category, key] of categories) {
    const models = catalog.get(category);
    if (!models) continue;
    const modelNames = [...models.keys()].sort();
    const ids = await Promise.all(modelNames.map(model => modelId(key, model)));
    tabs.push(`<a class="catalog-cat" data-category="${key}" href="#${key}"><span>${category}</span><small>Моделей: ${models.size}</small></a>`);
    sections.push(`<h2 class="catalog-fallback-heading" id="${key}">${category}</h2>`);
    modelNames.forEach((model, i) => {
      const id = ids[i];
      const name = escape(model);
      buttons.push(`<a class="catalog-model" data-category="${key}" data-model="${name}" data-model-id="${id}" href="#prices-${id}">${name}<span>→</span></a>`);
      const services = models.get(model).map(renderService).join('');
      sections.push(`<section class="model-prices" data-model-id="${id}" id="prices-${id}" tabindex="-1"><h3>${name}</h3><div class="table-wrap" tabindex="0" role="region" aria-label="Цены ${name}"><table class="price-table"><thead><tr><th>Услуга</th><th>Цена</th><th>Срок</th><th>Гарантия</th></tr></thead><tbody>${services}</tbody></table></div></section>`);
    });
  }
  return `<div aria-label="Категория устройства" class="catalog-categories">${tabs.join('')}</div>
<div class="model-step" id="catalog-model-step"><div class="catalog-step-head"><h2 id="catalog-model-heading">Выберите модель</h2><label class="model-search-label" hidden>Поиск модели<input autocomplete="off" id="model-search" placeholder="Например, iPhone 13" type="search"/></label></div><div class="catalog-models">${buttons.join('')}</div><p id="catalog-empty" hidden>Модель не найдена. Позвоните, чтобы уточнить стоимость.</p></div>
<div class="service-step" id="catalog-service-step"><div class="catalog-step-head"><h2 id="catalog-service-heading">Услуги и цены</h2><a class="change-model" id="change-model" href="#catalog-model-step" hidden>← Другая модель</a></div>${sections.join('')}</div>`;
}

function serveHtml(response, html, live) {
  const headers = new Headers(response.headers);
  for (const name of ['content-length', 'content-encoding', 'etag', 'last-modified']) headers.delete(name);
  headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  headers.set('Netlify-CDN-Cache-Control', live ? 'public, max-age=120' : 'public, max-age=20');
  return new Response(html, {status: response.status, headers});
}

export default async function livePrices(request, context) {
  if (request.method !== 'GET') return;
  const response = await context.next();
  if (!response.ok || !response.headers.get('content-type')?.startsWith('text/html')) return response;
  const html = await response.text();
  const source = html.match(/<!-- prices-csv (https:\/\/docs\.google\.com\/spreadsheets\/d\/e\/[\w-]+\/pub\?gid=\d+&single=true&output=csv) -->/);
  if (!source || !catalogBoundary.test(html)) return serveHtml(response, html, false);
  try {
    const csv = await fetch(source[1], {signal: AbortSignal.timeout(3500)});
    if (!csv.ok) throw new Error(`Price sheet HTTP ${csv.status}`);
    const text = await csv.text();
    if (text.length > 2_000_000) throw new Error('Price sheet too large');
    const catalog = await render(readCatalog(text));
    const updated = html.replace(catalogBoundary, (_, start, end) => `${start}\n<!-- prices:google-sheets-live -->\n${catalog}\n${end}`);
    return serveHtml(response, updated, true);
  } catch (error) {
    console.warn('iMaster prices: serving the last deployed catalog.', error.message);
    return serveHtml(response, html, false);
  }
}
