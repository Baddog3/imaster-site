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

def render(rows):
    if not rows:
        return '<p>Уточните стоимость ремонта <a href="tel:+74012905015">по телефону</a>.</p>'
    cats=[];buttons=[];sections=[]
    for category, key in CATEGORIES.items():
        models=sorted({r['model'] for r in rows if r['category']==category})
        if not models: continue
        cats.append(f'<a class="catalog-cat" data-category="{key}" href="#{key}"><span>{e(category)}</span><small>Моделей: {len(models)}</small></a>')
        sections.append(f'<h2 class="catalog-fallback-heading" id="{key}">{e(category)}</h2>')
        for model in models:
            mid=model_id(key,model)
            buttons.append(f'<a class="catalog-model" data-category="{key}" data-model="{e(model)}" data-model-id="{mid}" href="#prices-{mid}">{e(model)}<span>→</span></a>')
            cells=[]
            for row in rows:
                if row['category']!=category or row['model']!=model: continue
                price=e(row['price'])+(' ₽' if row['price'].isdigit() else '')
                note='<small class="price-note">В исходном прайсе несколько значений. Уточните цену для вашей модели по телефону.</small>' if '/' in row['price'] else ''
                cells.append(f'<tr><td>{e(row["service"])}</td><td class="price-value" data-label="Цена">{price}{note}</td><td data-label="Срок">{e(row["time"] or "—")}</td><td data-label="Гарантия">{e(row["warranty"] or "—")}</td></tr>')
            sections.append(f'<section class="model-prices" data-model-id="{mid}" id="prices-{mid}" tabindex="-1"><h3>{e(model)}</h3><div class="table-wrap" tabindex="0" role="region" aria-label="Цены {e(model)}"><table class="price-table"><thead><tr><th>Услуга</th><th>Цена</th><th>Срок</th><th>Гарантия</th></tr></thead><tbody>{"".join(cells)}</tbody></table></div></section>')
    return f'''<div aria-label="Категория устройства" class="catalog-categories">{''.join(cats)}</div>
<div class="model-step" id="catalog-model-step"><div class="catalog-step-head"><h2 id="catalog-model-heading">Выберите модель</h2><label class="model-search-label" hidden>Поиск модели<input autocomplete="off" id="model-search" placeholder="Например, iPhone 13" type="search"/></label></div><div class="catalog-models">{''.join(buttons)}</div><p id="catalog-empty" hidden>Модель не найдена. Позвоните, чтобы уточнить стоимость.</p></div>
<div class="service-step" id="catalog-service-step"><div class="catalog-step-head"><h2 id="catalog-service-heading">Услуги и цены</h2><a class="change-model" id="change-model" href="#catalog-model-step" hidden>← Другая модель</a></div>{''.join(sections)}</div>'''

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
