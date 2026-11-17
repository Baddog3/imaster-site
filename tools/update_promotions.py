"""Update the static promotion section from promotions.csv."""
import csv
import io
import re
from html import escape
from pathlib import Path
from tempfile import NamedTemporaryFile

ROOT = Path(__file__).resolve().parents[1]
COLUMNS = ("Показать", "Заголовок", "Когда", "Скидка", "Условие", "Промокод", "Картинка")
DESKTOP_COLUMN = "Готовый баннер для ПК"
CODE_HINT_COLUMN = "Подпись к промокоду"
START = "<!-- promotions:start -->"
END = "<!-- promotions:end -->"
SAFE_IMAGE = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_-]*\.(?:webp|png|jpg|jpeg|avif)", re.I)


def read_slides():
    source = (ROOT / "promotions.csv").read_text(encoding="utf-8-sig")
    delimiter = ";" if ";" in source.partition("\n")[0] else ","
    reader = csv.DictReader(io.StringIO(source), delimiter=delimiter, strict=True)
    columns = tuple(reader.fieldnames or ())
    if columns not in (COLUMNS, (*COLUMNS, DESKTOP_COLUMN), (*COLUMNS, DESKTOP_COLUMN, CODE_HINT_COLUMN)):
        raise ValueError("Восстановите названия и порядок столбцов в первой строке promotions.csv.")

    slides = []
    for row in reader:
        line = reader.line_num
        if None in row or any(value is None for value in row.values()):
            raise ValueError(f"Строка {line}: проверьте количество столбцов.")
        show, title, day, discount, condition, code, image = (row[key].strip() for key in COLUMNS)
        if show.casefold() in ("", "нет"):
            continue
        if show.casefold() != "да" or not all((title, day, discount, condition)):
            raise ValueError(f"Строка {line}: укажите «да» или «нет» и заполните условия видимой акции.")
        desktop = row.get(DESKTOP_COLUMN, "").strip()
        for filename in filter(None, (image, desktop)):
            if not SAFE_IMAGE.fullmatch(filename) or not (
                ROOT / "site" / "images" / "promotions" / filename
            ).is_file():
                raise ValueError(f"Строка {line}: файл изображения не найден или имеет неверное имя: {filename}")
        hint = row.get(CODE_HINT_COLUMN, "").strip()
        slides.append((title, day, discount, condition, code, image, desktop, hint))
    return slides


def render(slides):
    if not slides:
        return ""
    cards = []
    for title, day, discount, condition, code, image, desktop, hint in slides:
        code_html = ""
        if code and hint:
            code_html = (
                f'<p class="promo-code promo-code-guided"><span>{escape(hint)}</span> '
                f'<strong>{escape(code)}</strong></p>'
            )
        elif code:
            code_html = f'<p class="promo-code">Промокод <strong>{escape(code)}</strong></p>'
        art = (f'<img class="promo-art" src="images/promotions/{escape(image)}" alt="" '
               'width="650" height="650" loading="lazy" decoding="async"/>') if image else ""
        card_class = "promo-slide" if image else "promo-slide promo-slide-text"
        desktop_art = ""
        if desktop:
            card_class += " promo-slide-printed"
            desktop_art = f'''<picture class="promo-print">
        <source media="(min-width: 901px)" srcset="images/promotions/{escape(desktop)}"/>
        <img src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" alt=""
             width="1200" height="400" loading="lazy" decoding="async"/>
      </picture>'''
        cards.append(f'''    <article class="{card_class}" aria-label="{escape(title)}">
      {desktop_art}
      <div class="promo-copy">
        <p class="promo-day">{escape(day)}</p>
        <h3>{escape(title)}</h3>
        <p class="promo-discount">{escape(discount)}</p>
        <p class="promo-condition">{escape(condition)}</p>
        {code_html}
        <a class="button" href="tel:+74012905015">Позвонить в сервис</a>
      </div>
      {art}
    </article>''')
    return '\n'.join([
        '<section class="promotions container" aria-labelledby="promotions-heading">',
        '  <h2 id="promotions-heading">Акции iМастер</h2>',
        '  <div class="promo-slides" id="promo-slides">',
        *cards,
        '  </div>',
        '  <div class="promo-controls" hidden>',
        '    <button type="button" class="promo-arrow" data-promo-prev aria-controls="promo-slides" aria-label="Предыдущая акция">←</button>',
        '    <div class="promo-dots" role="group" aria-label="Выбор акции"></div>',
        '    <button type="button" class="promo-arrow" data-promo-next aria-controls="promo-slides" aria-label="Следующая акция">→</button>',
        '    <button type="button" class="promo-play" data-promo-play>Пауза</button>',
        '  </div>',
        '  <p class="promo-status" aria-live="polite" aria-atomic="true"></p>',
        '</section>',
    ])


def main():
    slides = read_slides()
    index = ROOT / "site" / "index.html"
    page = index.read_text(encoding="utf-8")
    if page.count(START) != 1 or page.count(END) != 1 or page.index(START) > page.index(END):
        raise ValueError("В site/index.html не найдены единственные границы блока акций.")
    before, separator, remainder = page.partition(START)
    _, end, after = remainder.partition(END)
    updated = before + separator + "\n" + render(slides) + "\n" + end + after
    if updated != page:
        with NamedTemporaryFile(mode="w", encoding="utf-8", dir=index.parent, delete=False) as tmp:
            tmp.write(updated)
        draft = Path(tmp.name)
        try:
            draft.chmod(index.stat().st_mode & 0o777)
            draft.replace(index)
        finally:
            draft.unlink(missing_ok=True)
    print(f"Готово. Баннеров в site/index.html: {len(slides)}.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, UnicodeError, csv.Error, ValueError) as error:
        raise SystemExit(f"Обновление отменено. {error}") from None
