import type { RegistryCatalog } from "../registry/catalog.js";

export function renderRegistryPage(catalog: RegistryCatalog): string {
  const initialSelection = catalog.entries[0]?.id ?? "";
  const payload = JSON.stringify(catalog).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Symphony Agent Registry</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f4efe6;
      --panel: rgba(255, 252, 247, 0.92);
      --panel-strong: #fffaf2;
      --line: #d7c7af;
      --text: #1f1a16;
      --muted: #6b6257;
      --accent: #0f766e;
      --accent-strong: #115e59;
      --chip: #efe4d2;
      --shadow: 0 18px 50px rgba(62, 39, 18, 0.12);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      background:
        radial-gradient(circle at top left, rgba(15, 118, 110, 0.18), transparent 28%),
        radial-gradient(circle at right, rgba(193, 117, 62, 0.12), transparent 24%),
        linear-gradient(180deg, #f8f4ed 0%, var(--bg) 100%);
      color: var(--text);
    }
    .shell {
      width: min(1200px, calc(100vw - 32px));
      margin: 32px auto;
      display: grid;
      gap: 20px;
    }
    .hero, .panel {
      background: var(--panel);
      border: 1px solid rgba(215, 199, 175, 0.8);
      border-radius: 24px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(10px);
    }
    .hero {
      padding: 32px;
      display: grid;
      gap: 18px;
    }
    .eyebrow {
      margin: 0;
      color: var(--accent-strong);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      font-size: 0.78rem;
      font-weight: 700;
    }
    h1 {
      margin: 0;
      font-size: clamp(2.4rem, 5vw, 4.5rem);
      line-height: 0.95;
      max-width: 12ch;
    }
    .hero p {
      margin: 0;
      color: var(--muted);
      font-size: 1.04rem;
      max-width: 64ch;
    }
    .stats {
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    }
    .stat {
      padding: 16px 18px;
      border-radius: 18px;
      background: var(--panel-strong);
      border: 1px solid var(--line);
    }
    .stat .label {
      display: block;
      color: var(--muted);
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .stat .value {
      display: block;
      margin-top: 6px;
      font-size: 2rem;
      font-weight: 700;
    }
    .workspace {
      display: grid;
      gap: 20px;
      grid-template-columns: minmax(0, 1.4fr) minmax(320px, 0.9fr);
      align-items: start;
    }
    .panel {
      padding: 22px;
    }
    .controls {
      display: grid;
      gap: 12px;
      grid-template-columns: minmax(0, 1.6fr) repeat(2, minmax(140px, 0.7fr));
      margin-bottom: 18px;
    }
    label {
      display: grid;
      gap: 8px;
      font-size: 0.9rem;
      color: var(--muted);
    }
    input, select {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 12px 14px;
      background: #fffdf8;
      color: var(--text);
      font: inherit;
    }
    .results-meta {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      color: var(--muted);
      margin-bottom: 14px;
      font-size: 0.9rem;
    }
    .registry-list {
      display: grid;
      gap: 14px;
    }
    .registry-card {
      width: 100%;
      text-align: left;
      padding: 18px;
      border-radius: 18px;
      border: 1px solid var(--line);
      background: #fffdf8;
      color: inherit;
      cursor: pointer;
      transition: transform 140ms ease, border-color 140ms ease, box-shadow 140ms ease;
    }
    .registry-card:hover, .registry-card:focus-visible {
      transform: translateY(-1px);
      border-color: var(--accent);
      box-shadow: 0 12px 26px rgba(15, 118, 110, 0.12);
      outline: none;
    }
    .registry-card[data-selected="true"] {
      border-color: var(--accent);
      box-shadow: 0 16px 28px rgba(15, 118, 110, 0.16);
    }
    .card-head, .detail-head {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: start;
    }
    .card-title, .detail-title {
      margin: 0;
      font-size: 1.25rem;
    }
    .entry-type {
      display: inline-flex;
      align-items: center;
      padding: 6px 10px;
      border-radius: 999px;
      background: var(--chip);
      color: var(--accent-strong);
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      white-space: nowrap;
    }
    .featured {
      background: rgba(15, 118, 110, 0.12);
    }
    .provider {
      margin: 8px 0 0;
      color: var(--muted);
      font-size: 0.94rem;
    }
    .description {
      margin: 14px 0;
      color: var(--text);
      line-height: 1.45;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
    }
    .chip {
      display: inline-flex;
      padding: 7px 10px;
      border-radius: 999px;
      background: var(--chip);
      color: var(--text);
      font-size: 0.82rem;
    }
    .detail-grid {
      display: grid;
      gap: 16px;
    }
    .detail-body {
      min-height: 320px;
    }
    .detail-section h3 {
      margin: 0 0 10px;
      font-size: 0.96rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
    }
    .detail-section p, .detail-section ul {
      margin: 0;
      line-height: 1.5;
    }
    .detail-section ul {
      padding-left: 18px;
    }
    .empty {
      padding: 28px;
      border: 1px dashed var(--line);
      border-radius: 18px;
      background: rgba(255, 253, 248, 0.65);
      color: var(--muted);
      text-align: center;
    }
    .topbar {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      margin-bottom: 16px;
    }
    .topbar a {
      color: var(--accent-strong);
    }
    @media (max-width: 920px) {
      .workspace {
        grid-template-columns: 1fr;
      }
      .controls {
        grid-template-columns: 1fr;
      }
      .detail-body {
        min-height: 0;
      }
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="hero">
      <p class="eyebrow">AI Agent Marketplace</p>
      <h1>Registry for agents and MCP servers</h1>
      <p>Browse available capabilities, filter by use case, and inspect the tools each entry brings into the marketplace. Use the registry to compare delivery agents and the MCP servers they depend on.</p>
      <div class="stats">
        <div class="stat"><span class="label">Catalog entries</span><span class="value">${catalog.counts.total}</span></div>
        <div class="stat"><span class="label">AI agents</span><span class="value">${catalog.counts.agents}</span></div>
        <div class="stat"><span class="label">MCP servers</span><span class="value">${catalog.counts.mcp_servers}</span></div>
        <div class="stat"><span class="label">Generated at</span><span class="value" style="font-size:1.1rem">${esc(catalog.generated_at)}</span></div>
      </div>
    </section>

    <section class="workspace">
      <div class="panel">
        <div class="topbar">
          <h2 style="margin:0">Browse registry</h2>
          <a href="/">View orchestration dashboard</a>
        </div>
        <div class="controls">
          <label>
            Search
            <input id="search-input" type="search" placeholder="Search by name, tag, capability, or use case">
          </label>
          <label>
            Type
            <select id="type-filter">
              <option value="all">All entries</option>
              <option value="agent">AI agents</option>
              <option value="mcp_server">MCP servers</option>
            </select>
          </label>
          <label>
            Capability
            <select id="capability-filter">
              <option value="all">All capabilities</option>
            </select>
          </label>
        </div>
        <div class="results-meta">
          <span id="results-count"></span>
          <span>Selections update the detail panel on the right.</span>
        </div>
        <div id="registry-list" class="registry-list" aria-live="polite"></div>
      </div>

      <aside class="panel detail-body">
        <div id="detail-panel" class="detail-grid"></div>
      </aside>
    </section>
  </main>

  <script type="application/json" id="registry-data">${payload}</script>
  <script>
    const catalog = JSON.parse(document.getElementById("registry-data").textContent);
    const searchInput = document.getElementById("search-input");
    const typeFilter = document.getElementById("type-filter");
    const capabilityFilter = document.getElementById("capability-filter");
    const list = document.getElementById("registry-list");
    const detail = document.getElementById("detail-panel");
    const resultsCount = document.getElementById("results-count");

    for (const capability of catalog.filters.capabilities) {
      const option = document.createElement("option");
      option.value = capability;
      option.textContent = capability;
      capabilityFilter.appendChild(option);
    }

    let selectedId = "${esc(initialSelection)}";

    function entryMatches(entry) {
      const query = searchInput.value.trim().toLowerCase();
      const selectedType = typeFilter.value;
      const selectedCapability = capabilityFilter.value;

      if (selectedType !== "all" && entry.type !== selectedType) {
        return false;
      }

      if (selectedCapability !== "all" && !entry.capabilities.includes(selectedCapability)) {
        return false;
      }

      if (!query) {
        return true;
      }

      const haystack = [
        entry.name,
        entry.description,
        entry.provider,
        ...entry.tags,
        ...entry.capabilities,
        ...entry.use_cases,
      ].join(" ").toLowerCase();

      return haystack.includes(query);
    }

    function renderDetail(entry) {
      if (!entry) {
        detail.innerHTML = '<div class="empty">No registry entry matches the current filters.</div>';
        return;
      }

      const modeLabel = entry.type === "agent" ? "Interaction model" : "Transport";
      const modeValue = entry.type === "agent" ? entry.interaction_model : entry.transport;
      const typeLabel = entry.type === "agent" ? "AI Agent" : "MCP Server";

      detail.innerHTML = [
        '<div class="detail-head">',
        '  <div>',
        '    <h2 class="detail-title">' + escapeHtml(entry.name) + '</h2>',
        '    <p class="provider">' + escapeHtml(entry.provider) + '</p>',
        '  </div>',
        '  <span class="entry-type ' + (entry.featured ? 'featured' : '') + '">' + typeLabel + '</span>',
        '</div>',
        '<p class="description">' + escapeHtml(entry.description) + '</p>',
        '<div class="detail-section">',
        '  <h3>' + modeLabel + '</h3>',
        '  <p>' + escapeHtml(modeValue) + '</p>',
        '</div>',
        '<div class="detail-section">',
        '  <h3>Capabilities</h3>',
        '  <div class="chips">' + entry.capabilities.map((item) => '<span class="chip">' + escapeHtml(item) + '</span>').join('') + '</div>',
        '</div>',
        '<div class="detail-section">',
        '  <h3>Recommended use cases</h3>',
        '  <ul>' + entry.use_cases.map((item) => '<li>' + escapeHtml(item) + '</li>').join('') + '</ul>',
        '</div>',
        '<div class="detail-section">',
        '  <h3>Tags</h3>',
        '  <div class="chips">' + entry.tags.map((item) => '<span class="chip">' + escapeHtml(item) + '</span>').join('') + '</div>',
        '</div>',
      ].join('');
    }

    function renderList() {
      const filtered = catalog.entries.filter(entryMatches);
      resultsCount.textContent = filtered.length + ' result' + (filtered.length === 1 ? '' : 's');

      if (!filtered.some((entry) => entry.id === selectedId)) {
        selectedId = filtered[0] ? filtered[0].id : '';
      }

      if (filtered.length === 0) {
        list.innerHTML = '<div class="empty">No agents or MCP servers matched the current search.</div>';
        renderDetail(null);
        return;
      }

      list.innerHTML = filtered.map((entry) => {
        const typeLabel = entry.type === "agent" ? "AI Agent" : "MCP Server";
        return [
          '<button class="registry-card" data-entry-id="' + escapeHtml(entry.id) + '" data-selected="' + String(entry.id === selectedId) + '">',
          '  <div class="card-head">',
          '    <div>',
          '      <h3 class="card-title">' + escapeHtml(entry.name) + '</h3>',
          '      <p class="provider">' + escapeHtml(entry.provider) + '</p>',
          '    </div>',
          '    <span class="entry-type ' + (entry.featured ? 'featured' : '') + '">' + typeLabel + '</span>',
          '  </div>',
          '  <p class="description">' + escapeHtml(entry.description) + '</p>',
          '  <div class="chips">' + entry.capabilities.slice(0, 3).map((item) => '<span class="chip">' + escapeHtml(item) + '</span>').join('') + '</div>',
          '</button>',
        ].join('');
      }).join('');

      for (const button of list.querySelectorAll("[data-entry-id]")) {
        button.addEventListener("click", () => {
          selectedId = button.getAttribute("data-entry-id");
          renderList();
        });
      }

      renderDetail(filtered.find((entry) => entry.id === selectedId) ?? filtered[0]);
    }

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    searchInput.addEventListener("input", renderList);
    typeFilter.addEventListener("change", renderList);
    capabilityFilter.addEventListener("change", renderList);
    renderList();
  </script>
</body>
</html>`;
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
