(() => {
  const search = document.querySelector('#tool-search');
  const filters = Array.from(document.querySelectorAll('.filter'));
  const rows = Array.from(document.querySelectorAll('.tool-card'));
  const soonRow = document.querySelector('.tool-card--soon');
  const empty = document.querySelector('#tool-empty');
  const count = document.querySelector('#tool-count');
  const heroCount = document.querySelector('#hero-count');

  if (!search || !filters.length || !rows.length) return;

  const realRows = rows.filter((row) => !row.classList.contains('tool-card--soon'));
  let activeFilter = 'all';

  function apply() {
    const query = search.value.trim().toLowerCase();
    let visible = 0;

    realRows.forEach((row) => {
      const categories = (row.dataset.category || '').split(/\s+/);
      const haystack = (row.dataset.search || '').toLowerCase();
      const matchesFilter =
        activeFilter === 'all' || categories.includes(activeFilter);
      const matchesQuery = !query || haystack.includes(query);
      const show = matchesFilter && matchesQuery;
      row.hidden = !show;
      if (show) visible += 1;
    });

    if (soonRow) {
      soonRow.hidden = activeFilter !== 'all' || query.length > 0;
    }

    empty.hidden = visible > 0;
    count.textContent = `${visible} 个`;
    if (heroCount) heroCount.textContent = String(realRows.length).padStart(2, '0');
  }

  filters.forEach((button) => {
    button.addEventListener('click', () => {
      activeFilter = button.dataset.filter || 'all';
      filters.forEach((entry) => {
        const active = entry === button;
        entry.classList.toggle('is-active', active);
        entry.setAttribute('aria-pressed', String(active));
      });
      apply();
    });
  });

  search.addEventListener('input', apply);

  document.addEventListener('keydown', (event) => {
    if (event.key !== '/') return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    event.preventDefault();
    search.focus();
    search.select();
  });

  apply();
})();
