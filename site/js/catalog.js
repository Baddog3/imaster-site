(() => {
  const cats = [...document.querySelectorAll('.catalog-cat')];
  if (!cats.length) return;
  const models = [...document.querySelectorAll('.catalog-model')];
  const sections = [...document.querySelectorAll('.model-prices')];
  const modelStep = document.querySelector('#catalog-model-step');
  const serviceStep = document.querySelector('#catalog-service-step');
  const search = document.querySelector('#model-search');
  const back = document.querySelector('#change-model');
  let currentCategory = cats[0].dataset.category;
  function filter() {
    const query = search.value.trim().toLocaleLowerCase('ru');
    models.forEach(a => { a.hidden = a.dataset.category !== currentCategory || !a.dataset.model.toLocaleLowerCase('ru').includes(query); });
    document.querySelector('#catalog-empty').hidden = models.some(a => !a.hidden);
  }
  function category(key) {
    currentCategory = cats.some(a => a.dataset.category === key) ? key : cats[0].dataset.category;
    cats.forEach(a => { if (a.dataset.category === currentCategory) a.setAttribute('aria-current','true'); else a.removeAttribute('aria-current'); });
    search.value = '';
    document.querySelector('#catalog-model-heading').textContent = 'Выберите модель — ' + cats.find(a => a.dataset.category === currentCategory).querySelector('span').textContent;
    serviceStep.hidden = true; modelStep.hidden = false; filter();
  }
  function route() {
    const hash = location.hash.slice(1);
    const selected = models.find(a => a.hash.slice(1) === hash);
    category(selected ? selected.dataset.category : hash);
    if (selected) {
      sections.forEach(s => { s.hidden = s.id !== hash; });
      document.querySelector('#catalog-service-heading').textContent = selected.dataset.model + ' — услуги и цены';
      serviceStep.hidden = false; modelStep.hidden = true;
    }
  }
  function navigate(event, hash) {
    if(event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if(location.hash !== hash) history.pushState(null,'',hash);
    route();
    const target = serviceStep.hidden ? modelStep : serviceStep;
    target.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
    const heading=target.querySelector('h2'); heading.tabIndex=-1;heading.focus({preventScroll:true});
  }
  [...cats,...models].forEach(a => a.addEventListener('click',event => navigate(event,a.hash)));
  back.addEventListener('click',event => navigate(event,'#'+currentCategory));
  search.addEventListener('input',filter);
  window.addEventListener('hashchange',route);
  window.addEventListener('popstate',route);
  route();
  document.querySelectorAll('.catalog-fallback-heading').forEach(h => {h.hidden=true;});
  search.closest('label').hidden=false;back.hidden=false;
})();
