"""Check preservation, fallback HTML, stable links and failure behavior."""
import csv, io, json, subprocess, sys, tempfile, shutil
from pathlib import Path
from html.parser import HTMLParser
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
import build
class Parser(HTMLParser):
 def __init__(self): super().__init__();self.tags=[]
 def handle_starttag(self,t,a): self.tags.append((t,dict(a)))

def run(root):return subprocess.run([sys.executable,str(root/'tools/build.py')],capture_output=True,text=True)

def sheet_prices(rows):
    output = io.StringIO()
    csv.writer(output).writerows([build.SHEET_FIELDS, *rows])
    return build.read_prices(output.getvalue())

values = ['Ноутбуки', 'Lenovo', 'ThinkPad T14', 'Замена аккумулятора', '3500', '', '']
hidden = [*values[:2], 'ThinkPad T15', *values[3:], 'Нет']
assert sheet_prices([[''] * 8, [*values, 'Да'], hidden]) == [dict(zip(build.FIELDS, values))]
assert 'ThinkPad T14' in build.render(sheet_prices([[*values, '']]))
assert 'ThinkPad T15' not in build.render(sheet_prices([[*values, 'Да'], hidden]))
assert 'catalog-model' not in build.render(sheet_prices([hidden]))
with tempfile.TemporaryDirectory() as td:
 root=Path(td)/'project';shutil.copytree(ROOT,root)
 assert run(root).returncode==0
 prices=build.read_prices((root/'prices.csv').read_text())
 assert json.loads((root/'site/data/prices.json').read_text())==prices
 p=Parser();p.feed((root/'site/ceny.html').read_text())
 sections=[a for t,a in p.tags if a.get('class')=='model-prices']
 assert len(sections)==len({(r['category'],r['model']) for r in prices})
 assert all('hidden' not in a for a in sections)
 assert all('hidden' not in a for t,a in p.tags if a.get('id')=='catalog-service-step')
 ids=[a['id'] for t,a in p.tags if 'id' in a];assert len(ids)==len(set(ids))
 for t,a in p.tags:
  if a.get('class')=='catalog-model': assert a['href'][1:] in ids
 # Reordering rows must preserve every model URL.
 q=Parser();q.feed(build.render(list(reversed(prices))))
 assert {a['id'] for t,a in q.tags if a.get('class')=='model-prices'}=={a['id'] for a in sections}
 generated=[root/'site/ceny.html',root/'site/index.html',root/'site/data/prices.json']
 before=[p.read_bytes() for p in generated];assert run(root).returncode==0
 assert before==[p.read_bytes() for p in generated]
 # Invalid source must not overwrite any generated content.
 (root/'prices.csv').write_text('wrong\ninvalid\n');assert run(root).returncode!=0
 assert before==[p.read_bytes() for p in generated]
 shutil.copyfile(ROOT/'prices.csv',root/'prices.csv')
 promo=root/'promotions.csv';original=promo.read_text();rows=list(csv.DictReader(original.splitlines(),delimiter=';'))
 def write(rows):
  with promo.open('w') as f:
   w=csv.DictWriter(f,fieldnames=rows[0].keys(),delimiter=';');w.writeheader();w.writerows(rows)
 for row in rows:row['Показать']='нет'
 write(rows);assert run(root).returncode==0
 assert '<section class="promotions' not in (root/'site/index.html').read_text()
 rows[0]['Показать']='да';write(rows);assert run(root).returncode==0
 p=Parser();p.feed((root/'site/index.html').read_text());assert sum('promo-slide' in a.get('class','').split() for t,a in p.tags)==1
 rows[0]['Картинка']='missing.webp';write(rows);before=[p.read_bytes() for p in generated]
 assert run(root).returncode!=0;assert before==[p.read_bytes() for p in generated]
print('PASS: source preservation, fallback, stable IDs, idempotence, invalid input, zero/one slides')
