"""Build static HTML from CSV; optional Google Sheets CSV exports at build time."""
import csv, io, json, os, re, shutil, tempfile, hashlib
from pathlib import Path
from html import escape as e
from urllib.request import urlopen
from urllib.parse import urlparse
import update_promotions as promotions
ROOT = Path(__file__).resolve().parents[1]
CATEGORIES = {'Смартфоны':'smartphones','Планшеты':'tablets','Ноутбуки':'laptops','Аксессуары':'accessories'}
FIELDS = ['category','brand','model','service','price','time','warranty']
SHEET_FIELDS = ['Категория','Бренд','Модель','Услуга','Цена, ₽','Срок','Гарантия','На сайте']
PUBLISHED_GOOGLE_CSV = re.compile(
    r'https://docs\.google\.com/spreadsheets/d/e/[A-Za-z0-9_-]+/pub\?gid=\d+&single=true&output=csv'
)

def source(name, env):
    url = os.environ.get(env, '').strip()
    if not url:
        return (ROOT/name).read_text(encoding='utf-8-sig')
    if urlparse(url).scheme != 'https':
        raise ValueError(env + ': требуется HTTPS-ссылка CSV')
    with urlopen(url, timeout=20) as response:
        data = response.read(2_000_001)
    if len(data)>2_000_000:
        raise ValueError('Таблица слишком большая')
    return data.decode('utf-8-sig')

def read_prices(text):
    delimiter = ';' if ';' in text.partition('\n')[0] else ','
    reader = csv.reader(io.StringIO(text), delimiter=delimiter, strict=True)
    header = next(reader, [])
    if header not in (FIELDS, SHEET_FIELDS):
        raise ValueError('Прайс: проверьте заголовки в первой строке')
    rows = []
    has_entries = False
    for values in reader:
        values = [value.strip() for value in values]
        if not any(values):
            continue
        has_entries = True
        line = f'Прайс, строка {reader.line_num}'
        if len(values) != len(header):
            raise ValueError(f'{line}: неверное число столбцов')
        if header == SHEET_FIELDS:
            status = values.pop().casefold()
            if status == 'нет':
                continue
            if status not in ('', 'да'):
                raise ValueError(f'{line}: выберите «Да» или «Нет» в столбце «На сайте»')
        row = dict(zip(FIELDS, values))
        if row['category'] not in CATEGORIES:
            raise ValueError(f'{line}: выберите категорию из списка')
        if not all(row[field] for field in ('brand', 'model', 'service', 'price')):
            raise ValueError(f'{line}: заполните бренд, модель, услугу и цену')
        if not re.fullmatch(r'[0-9][0-9 /–—.,\-\u00a0\u202f]*', row['price']):
            raise ValueError(f'{line}: укажите цену числом или диапазоном без символа ₽')
        rows.append(row)
    if not has_entries:
        raise ValueError('Прайс пуст. Чтобы временно скрыть все позиции, выберите «Нет»')
    return rows

def model_id(category, model):
    slug=re.sub(r'[^a-z0-9]+','-',model.lower()).strip('-') or 'model'
    return category+'-'+slug+'-'+hashlib.sha256(model.encode()).hexdigest()[:8]

def render_service(row):
    amount = re.sub(r'(?<![\d.,])[0-9]{4,}',
                    lambda match: re.sub(r'(?<=[0-9])(?=(?:[0-9]{3})+$)', '\u00a0', match[0]),
                    row['price'])
    # The price is already in rubles in both data sources.
    note = '<small class="price-note">Уточните цену по телефону.</small>' if '/' in row['price'] else ''
    return (f'<tr role="row"><td role="cell">{e(row["service"])}</td>'
            f'<td role="cell"><span class="price-amount">{e(amount)}\u00a0₽</span>{note}</td>'
            f'<td role="cell"><span class="price-meta-label" aria-hidden="true">Срок </span>{e(row["time"] or "—")}</td>'
            f'<td role="cell"><span class="price-meta-label" aria-hidden="true">Гарантия </span>{e(row["warranty"] or "—")}</td></tr>')

def render(rows):
    if not rows:
        return '<p class="catalog-empty">Уточните стоимость ремонта <a href="tel:+74012905015">по телефону</a>.</p>'

    catalog = {}
    for row in rows:
        catalog.setdefault(row['category'], {}).setdefault(row['model'], []).append(row)

    tabs, links, sections = [], [], []
    headers = ''.join(f'<th scope="col" role="columnheader">{label}</th>'
                      for label in ('Услуга', 'Цена', 'Срок', 'Гарантия'))
    for category, key in CATEGORIES.items():
        models = catalog.get(category)
        if not models:
            continue
        tabs.append(f'<a class="catalog-type" href="#{key}">{e(category)}</a>')
        sections.append(f'<p class="catalog-fallback-heading" id="{key}">{e(category)}</p>')
        for model in sorted(models):
            section_id = 'prices-' + model_id(key, model)
            name = e(model)
            links.append(f'<a class="catalog-model" href="#{section_id}">{name}</a>')
            services = ''.join(map(render_service, models[model]))
            sections.append(
                f'<section class="model-prices" id="{section_id}" data-category="{key}">'
                f'<h2 id="{section_id}-title">{name}</h2>'
                f'<table class="catalog-table" role="table" aria-labelledby="{section_id}-title">'
                f'<thead role="rowgroup"><tr role="row">{headers}</tr></thead>'
                f'<tbody role="rowgroup">{services}</tbody></table></section>'
            )
    tables = '\n'.join(sections)
    return f'''<div class="catalog-fallback">
  <nav class="catalog-types" aria-label="Тип устройства">{''.join(tabs)}</nav>
  <details class="catalog-model-list"><summary>Перейти к модели</summary><div>{''.join(links)}</div></details>
</div>
<div id="catalog-service-step">
{tables}
</div>'''

def replace_block(text,start,end,body):
    if text.count(start)!=1 or text.count(end)!=1 or text.index(start)>text.index(end): raise ValueError('Не найдены границы блока')
    return text.split(start)[0]+start+'\n'+body+'\n'+end+text.split(end)[1]

def main():
    rows=read_prices(source('prices.csv','PRICES_CSV_URL'))
    promo_text=source('promotions.csv','PROMOTIONS_CSV_URL')
    # Validate all input before writing any generated output.
    with tempfile.TemporaryDirectory() as td:
        tmp=Path(td);(tmp/'promotions.csv').write_text(promo_text)
        (tmp/'site/images').mkdir(parents=True)
        shutil.copytree(ROOT/'site/images/promotions',tmp/'site/images/promotions')
        promotions.ROOT=tmp
        slides=promotions.read_slides()
    for slide in slides:
        if slide[6]: raise ValueError('Очистите «Готовый баннер для ПК»: условия выводятся единым текстом на всех экранах')
    catalog = render(rows)
    csv_url = os.environ.get('PRICES_CSV_URL', '').strip()
    if PUBLISHED_GOOGLE_CSV.fullmatch(csv_url):
        catalog = f'<!-- prices-csv {csv_url} -->\n{catalog}'
    outputs={ROOT/'site/ceny.html':replace_block((ROOT/'site/ceny.html').read_text(),'<!-- catalog:start -->','<!-- catalog:end -->',catalog), ROOT/'site/index.html':replace_block((ROOT/'site/index.html').read_text(),promotions.START,promotions.END,promotions.render(slides)),ROOT/'site/data/prices.json':json.dumps(rows,ensure_ascii=False,indent=2)+'\n'}
    for path,text in outputs.items():
        draft=path.with_suffix(path.suffix+'.tmp');draft.write_text(text);draft.replace(path)
    print(f'Готово: {len(rows)} цен, {len(slides)} акций.')

if __name__=='__main__':
    try: main()
    except Exception as exc: raise SystemExit(f'Сборка остановлена: {exc}')
