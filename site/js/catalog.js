(() => {
  const controls = document.querySelector('.catalog-controls');
  const results = document.querySelector('#catalog-service-step');
  if (!controls || !results) return;

  const deviceNames = {
    smartphones: 'Смартфоны',
    tablets: 'Планшеты',
    laptops: 'Ноутбуки',
    watches: 'Часы',
    earbuds: 'Наушники',
    accessories: 'Аксессуары',
  };
  const groupNames = [
    'iPhone SE', 'iPhone X, XR, XS', 'iPhone 8 и более ранние',
    'iPad', 'iPad Air', 'iPad Pro', 'iPad mini',
  ];
  const collator = new Intl.Collator('ru', {numeric: true});

  function deviceFor(category, name) {
    if (category !== 'accessories') return category;
    if (/\b(?:smart\s*)?watch|часы/iu.test(name)) return 'watches';
    if (/\b(?:airpods|earbuds|headphones|buds)|наушники/iu.test(name)) return 'earbuds';
    return category;
  }

  function groupFor(device, name) {
    if (device === 'smartphones') {
      const series = name.match(/^iPhone\s+(\d+|SE\b|X[RS]?\b)/i)?.[1]?.toUpperCase();
      if (series === 'SE') return 'iPhone SE';
      if (series?.startsWith('X')) return 'iPhone X, XR, XS';
      if (series) return Number(series) > 8 ? 'iPhone ' + series : 'iPhone 8 и более ранние';
    }
    if (device === 'tablets' && /^iPad\b/i.test(name)) {
      const family = name.match(/^iPad\s+(Air|Pro|mini)\b/i)?.[1]?.toLowerCase();
      return {air: 'iPad Air', pro: 'iPad Pro', mini: 'iPad mini'}[family] || 'iPad';
    }
    return '';
  }

  function groupOrder(name) {
    const generation = name.match(/^iPhone (\d+)$/);
    if (generation) return -Number(generation[1]);
    const index = groupNames.indexOf(name);
    return index === -1 ? groupNames.length : index;
  }

  const modelsById = new Map();
  const modelsByDevice = new Map();
  for (const section of results.querySelectorAll('.model-prices')) {
    const name = section.querySelector('h2').textContent;
    const device = deviceFor(section.dataset.category, name);
    const model = {id: section.id, name, device, section};
    modelsById.set(model.id, model);
    if (!modelsByDevice.has(device)) modelsByDevice.set(device, []);
    modelsByDevice.get(device).push(model);
  }

  const devices = Object.keys(deviceNames).filter(device => modelsByDevice.has(device));
  if (!devices.length) return;

  const switcher = controls.querySelector('.catalog-types');
  const select = controls.querySelector('select');
  const placeholder = select.options[0];
  const announcement = controls.querySelector('[role="status"]');
  const buttons = new Map();
  let currentDevice;
  let shown;

  function setDevice(device) {
    if (currentDevice === device) return;
    currentDevice = device;
    for (const [key, button] of buttons) {
      button.setAttribute('aria-pressed', String(key === device));
    }

    const models = modelsByDevice.get(device);
    const groups = new Map();
    for (const model of models) {
      const label = groupFor(device, model.name);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(model);
    }
    const options = document.createDocumentFragment();
    const sortedGroups = [...groups].sort(([a], [b]) => groupOrder(a) - groupOrder(b));
    for (const [label, group] of sortedGroups) {
      const parent = groups.size > 1 ? document.createElement('optgroup') : options;
      for (const model of group.sort((a, b) => collator.compare(a.name, b.name))) {
        parent.append(new Option(model.name, model.id));
      }
      if (parent !== options) {
        parent.label = label || 'Другие модели';
        options.append(parent);
      }
    }
    placeholder.disabled = models.length === 1;
    select.replaceChildren(placeholder, options);
  }

  function showModel(model) {
    if (shown) shown.section.hidden = true;
    shown = model;
    select.value = model?.id || '';
    results.hidden = !model;
    if (model) model.section.hidden = false;
    announcement.textContent = model ? 'Показаны цены на ремонт ' + model.name : 'Выберите модель устройства.';
  }

  function onlyModel(device) {
    const models = modelsByDevice.get(device);
    return models.length === 1 ? models[0] : undefined;
  }

  function updateHash() {
    const hash = '#' + (shown?.id || currentDevice);
    if (location.hash !== hash) history.pushState(null, '', hash);
  }

  const legacyAccessories = devices.find(device => ['watches', 'earbuds', 'accessories'].includes(device));
  function restoreFromHash() {
    const fragment = location.hash.slice(1);
    const model = modelsById.get(fragment);
    const category = modelsByDevice.has(fragment) ? fragment :
      fragment === 'accessories' ? legacyAccessories : undefined;
    const device = model?.device || category || devices[0];
    setDevice(device);
    const defaultModel = category ? undefined :
      modelsByDevice.get(device).find(item => item.name === 'iPhone 13 Pro');
    showModel(model || defaultModel || onlyModel(device));
    return model?.section || (category ? controls : null);
  }

  for (const device of devices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'catalog-type';
    button.textContent = deviceNames[device];
    button.setAttribute('aria-controls', 'catalog-model catalog-service-step');
    button.addEventListener('click', () => {
      if (device === currentDevice) return;
      setDevice(device);
      showModel(onlyModel(device));
      updateHash();
    });
    buttons.set(device, button);
    switcher.append(button);
  }
  select.addEventListener('change', () => {
    showModel(modelsById.get(select.value));
    updateHash();
  });
  window.addEventListener('hashchange', restoreFromHash);

  for (const item of document.querySelectorAll('.catalog-fallback, .catalog-fallback-heading, .model-prices')) {
    item.hidden = true;
  }
  const hash = location.hash;
  const target = restoreFromHash();
  controls.hidden = false;
  if (target) {
    requestAnimationFrame(() => {
      if (location.hash === hash) target.scrollIntoView({behavior: 'instant', block: 'start'});
    });
  }
})();
