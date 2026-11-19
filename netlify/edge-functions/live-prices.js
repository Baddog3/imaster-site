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
  const amount = price.replace(/(?<![\d.,])\d{4,}/g, digits => digits.replace(/(?<=\d)(?=(?:\d{3})+$)/g, '\u00a0'));
  const note = price.includes('/') ? '<small class="price-note">Уточните цену по телефону.</small>' : '';
  return `<tr role="row"><td role="cell">${escape(service)}</td>` +
    `<td role="cell"><span class="price-amount">${escape(amount)}\u00a0₽</span>${note}</td>` +
    `<td role="cell"><span class="price-meta-label" aria-hidden="true">Срок </span>${escape(time || '—')}</td>` +
    `<td role="cell"><span class="price-meta-label" aria-hidden="true">Гарантия </span>${escape(warranty || '—')}</td></tr>`;
}

async function render(catalog) {
  if (!catalog.size) return '<p class="catalog-empty">Уточните стоимость ремонта <a href="tel:+74012905015">по телефону</a>.</p>';
  const tabs = [];
  const links = [];
  const sections = [];
  const headers = ['Услуга', 'Цена', 'Срок', 'Гарантия']
    .map(label => `<th scope="col" role="columnheader">${label}</th>`).join('');
  for (const [category, key] of categories) {
    const models = catalog.get(category);
    if (!models) continue;
    const modelNames = [...models.keys()].sort();
    const ids = await Promise.all(modelNames.map(model => modelId(key, model)));
    tabs.push(`<a class="catalog-type" href="#${key}">${category}</a>`);
    sections.push(`<p class="catalog-fallback-heading" id="${key}">${category}</p>`);
    modelNames.forEach((model, i) => {
      const id = `prices-${ids[i]}`;
      const name = escape(model);
      links.push(`<a class="catalog-model" href="#${id}">${name}</a>`);
      const services = models.get(model).map(renderService).join('');
      sections.push(
        `<section class="model-prices" id="${id}" data-category="${key}">` +
        `<h2 id="${id}-title">${name}</h2>` +
        `<table class="catalog-table" role="table" aria-labelledby="${id}-title">` +
        `<thead role="rowgroup"><tr role="row">${headers}</tr></thead>` +
        `<tbody role="rowgroup">${services}</tbody></table></section>`,
      );
    });
  }
  return `<div class="catalog-fallback">
  <nav class="catalog-types" aria-label="Тип устройства">${tabs.join('')}</nav>
  <details class="catalog-model-list"><summary>Перейти к модели</summary><div>${links.join('')}</div></details>
</div>
<div id="catalog-service-step">
${sections.join('\n')}
</div>`;
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
