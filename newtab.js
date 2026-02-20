/* Ticket Groups New Tab - fast vanilla JS
   - event delegation
   - minimal rerenders
   - storage.local persistence
*/

const STORAGE_KEY = "tgnt_v1";
const GROUP_COLOR_OPTIONS = [
  { value: "default", label: "Default" },
  { value: "yellow", label: "Yellow" },
  { value: "blue", label: "Blue" },
  { value: "green", label: "Green" },
  { value: "pink", label: "Pink" },
  { value: "purple", label: "Purple" },
  { value: "orange", label: "Orange" },
  { value: "teal", label: "Teal" },
  { value: "red", label: "Red" },
  { value: "mint", label: "Mint" },
  { value: "lavender", label: "Lavender" },
  { value: "peach", label: "Peach" },
  { value: "gray", label: "Gray" },
];

const GROUP_COLOR_STYLES = {
  default: null,
  yellow: { bg: "#3a2a14", border: "rgba(242,161,0,0.35)" },
  blue: { bg: "#1c2b3a", border: "rgba(114,170,255,0.35)" },
  green: { bg: "#1d3227", border: "rgba(96,194,141,0.35)" },
  pink: { bg: "#38232b", border: "rgba(228,127,160,0.35)" },
  purple: { bg: "#2a2136", border: "rgba(180,140,255,0.35)" },
  orange: { bg: "#3a2418", border: "rgba(255,170,90,0.35)" },
  teal: { bg: "#182f33", border: "rgba(110,220,210,0.35)" },
  red: { bg: "#361b1f", border: "rgba(255,120,130,0.35)" },
  mint: { bg: "#193126", border: "rgba(140,255,200,0.35)" },
  lavender: { bg: "#2d2436", border: "rgba(210,170,255,0.35)" },
  peach: { bg: "#3a2422", border: "rgba(255,190,170,0.35)" },
  gray: { bg: "#24262b", border: "rgba(180,180,190,0.25)" },
};

const $ = (sel, root = document) => root.querySelector(sel);

const els = {
  groups: $("#groups"),
  trashWrap: $("#trashWrap"),
  trash: $("#trash"),
  meta: $("#meta"),
  search: $("#search"),
  btnAddGroup: $("#btnAddGroup"),
  btnExport: $("#btnExport"),
  importFile: $("#importFile"),
  groupTpl: $("#groupTpl"),
  itemTpl: $("#itemTpl"),
  dlg: $("#dlg"),
  dlgTitle: $("#dlgTitle"),
  dlgBody: $("#dlgBody"),
  dlgOk: $("#dlgOk"),
};

const state = {
  data: {
    version: 1,
    groups: [],
    trash: [],
  },
  filter: "",
  saveTimer: null,
};

let dragGroupId = null;
let dragOverNode = null;

function normalizeGroupColor(color) {
  const key = String(color || "default").toLowerCase();
  return Object.prototype.hasOwnProperty.call(GROUP_COLOR_STYLES, key)
    ? key
    : "default";
}

function applyGroupColor(node, color) {
  const style = GROUP_COLOR_STYLES[normalizeGroupColor(color)];
  if (!style) return;
  node.style.backgroundColor = style.bg;
  node.style.borderColor = style.border;
}

function sanitizeGroupShape(g) {
  if (!g.id) g.id = uid();
  if (!Array.isArray(g.items)) g.items = [];
  for (const it of g.items) {
    if (!it.id) it.id = uid();
    it.done = !!it.done;
    it.kind = it.kind === "link" ? "link" : "text";
    it.value = String(it.value ?? "");
  }
  g.open = !!g.open;
  g.title = String(g.title ?? "Untitled");
  g.desc = String(g.desc ?? "");
  g.color = normalizeGroupColor(g.color);
}

function uid() {
  // compact id: time + random
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  ).toUpperCase();
}

function isLikelyUrl(s) {
  // simple URL detection: accepts http(s) or domain-like
  const t = (s || "").trim();
  if (!t) return false;
  if (/^https?:\/\/\S+/i.test(t)) return true;
  // domain.tld[/...]
  return /^[a-z0-9.-]+\.[a-z]{2,}([/?#]\S*)?$/i.test(t);
}

function normalizeUrl(s) {
  const t = (s || "").trim();
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) return t;
  // If user pasted "example.com", make it clickable.
  return "https://" + t;
}

function scheduleSave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveNow, 250);
}

async function saveNow() {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: state.data });
  } catch (e) {
    console.error("Save failed:", e);
  }
}

async function load() {
  const res = await chrome.storage.local.get(STORAGE_KEY);
  const loaded = res?.[STORAGE_KEY];
  if (loaded?.groups) state.data = loaded;
  if (!Array.isArray(state.data.trash)) state.data.trash = [];
  for (const g of state.data.groups) sanitizeGroupShape(g);
  for (const g of state.data.trash) sanitizeGroupShape(g);

  const pruned = pruneTrash();
  if (pruned) await saveNow();
  if (!state.data.groups.length) {
    // seed
    state.data.groups.push({
      id: uid(),
      title: "Example: TICKET-1234",
      desc: "Expand me. Add links and todos.",
      color: "default",
      open: true,
      items: [
        { id: uid(), done: false, kind: "link", value: "https://example.com" },
        { id: uid(), done: false, kind: "text", value: "Write update in Jira" },
      ],
    });
    await saveNow();
  }
  render();
}

function setMeta() {
  const g = state.data.groups.length;
  let items = 0;
  for (const gr of state.data.groups) items += gr.items.length;
  const f = state.filter ? ` • filtered` : "";
  els.meta.textContent = `${g} groups • ${items} items${f}`;
}

function matchesFilter(group) {
  const f = state.filter.trim().toLowerCase();
  if (!f) return true;
  if ((group.title || "").toLowerCase().includes(f)) return true;
  if ((group.desc || "").toLowerCase().includes(f)) return true;
  return group.items.some((it) => (it.value || "").toLowerCase().includes(f));
}

function render() {
  els.groups.textContent = "";
  els.trash.textContent = "";
  const frag = document.createDocumentFragment();

  const groups = state.data.groups.filter(matchesFilter);
  for (const g of groups) frag.appendChild(renderGroup(g));

  els.groups.appendChild(frag);
  renderTrash();
  setMeta();
}

function renderGroup(group) {
  const node = els.groupTpl.content.firstElementChild.cloneNode(true);
  node.dataset.groupId = group.id;
  node.dataset.open = group.open ? "1" : "0";
  node.draggable = false;
  applyGroupColor(node, group.color);

  const titleEl = node.querySelector('[data-field="title"]');
  const descEl = node.querySelector('[data-field="desc"]');
  const body = node.querySelector(".groupBody");
  const itemsEl = node.querySelector('[data-field="items"]');
  const newText = node.querySelector('[data-field="newText"]');

  titleEl.textContent = group.title || "(untitled)";
  descEl.textContent = group.desc || "";

  body.hidden = !group.open;

  // Render items
  const itemsFrag = document.createDocumentFragment();
  for (const it of group.items) itemsFrag.appendChild(renderItem(it));
  itemsEl.appendChild(itemsFrag);

  // keep the input empty
  newText.value = "";

  return node;
}

function renderTrash() {
  const frag = document.createDocumentFragment();
  const trash = state.data.trash || [];
  if (!trash.length) {
    els.trashWrap.hidden = true;
    return;
  }

  for (const g of trash) frag.appendChild(renderTrashGroup(g));
  els.trash.appendChild(frag);
  els.trashWrap.hidden = false;
}

function renderTrashGroup(group) {
  const node = els.groupTpl.content.firstElementChild.cloneNode(true);
  node.dataset.groupId = group.id;
  node.dataset.open = group.open ? "1" : "0";
  node.dataset.trash = "1";
  node.draggable = false;
  applyGroupColor(node, group.color);

  const titleEl = node.querySelector('[data-field="title"]');
  const descEl = node.querySelector('[data-field="desc"]');
  const body = node.querySelector(".groupBody");
  const itemsEl = node.querySelector('[data-field="items"]');
  const addRow = node.querySelector(".addRow");
  const btns = node.querySelector(".groupBtns");

  titleEl.textContent = group.title || "(untitled)";
  descEl.textContent = group.desc || "";
  body.hidden = !group.open;
  if (addRow) addRow.remove();

  // Replace action buttons with restore / delete forever
  btns.textContent = "";
  const restore = document.createElement("button");
  restore.className = "iconBtn";
  restore.dataset.action = "restore-group";
  restore.title = "Restore group";
  restore.textContent = "⟲";

  const purge = document.createElement("button");
  purge.className = "iconBtn danger";
  purge.dataset.action = "purge-group";
  purge.title = "Delete forever";
  purge.textContent = "🗑";

  btns.appendChild(restore);
  btns.appendChild(purge);

  const itemsFrag = document.createDocumentFragment();
  for (const it of group.items || []) itemsFrag.appendChild(renderItem(it));
  itemsEl.appendChild(itemsFrag);

  return node;
}

function renderItem(item) {
  const li = els.itemTpl.content.firstElementChild.cloneNode(true);
  li.dataset.itemId = item.id;
  li.dataset.done = item.done ? "1" : "0";
  li.dataset.kind = item.kind;

  const cb = li.querySelector('input[type="checkbox"]');
  cb.checked = !!item.done;

  const textEl = li.querySelector('[data-field="text"]');
  const linkEl = li.querySelector('[data-field="link"]');

  if (item.kind === "link") {
    const href = normalizeUrl(item.value);
    linkEl.href = href;
    linkEl.textContent = item.value;
    textEl.textContent = "";
  } else {
    textEl.textContent = item.value;
    linkEl.href = "";
    linkEl.textContent = "";
  }

  return li;
}

function getGroup(groupId) {
  return state.data.groups.find((g) => g.id === groupId);
}

function getItem(group, itemId) {
  return group.items.find((i) => i.id === itemId);
}

function removeById(arr, id) {
  const idx = arr.findIndex((x) => x.id === id);
  if (idx >= 0) arr.splice(idx, 1);
  return idx;
}

function reorderGroups(dragId, targetId) {
  if (!dragId || dragId === targetId) return;
  const arr = state.data.groups;
  const from = arr.findIndex((g) => g.id === dragId);
  if (from < 0) return;
  const [moved] = arr.splice(from, 1);
  if (!targetId) {
    arr.push(moved);
  } else {
    const to = arr.findIndex((g) => g.id === targetId);
    if (to < 0) arr.push(moved);
    else arr.splice(to, 0, moved);
  }
  scheduleSave();
  render();
}

function openDialog(title, fields, onSubmit) {
  els.dlgTitle.textContent = title;
  els.dlgBody.textContent = "";

  // Build form UI
  for (const f of fields) {
    const wrap = document.createElement("div");
    wrap.className = "field";

    const label = document.createElement("label");
    label.textContent = f.label;

    let input;
    if (f.type === "textarea") {
      input = document.createElement("textarea");
      input.value = f.value ?? "";
    } else if (f.type === "select") {
      input = document.createElement("select");
      for (const opt of f.options) {
        const o = document.createElement("option");
        o.value = opt.value;
        o.textContent = opt.label;
        if (opt.value === f.value) o.selected = true;
        input.appendChild(o);
      }
    } else {
      input = document.createElement("input");
      input.type = f.type || "text";
      input.value = f.value ?? "";
      if (f.placeholder) input.placeholder = f.placeholder;
    }
    input.name = f.name;

    wrap.appendChild(label);
    wrap.appendChild(input);
    els.dlgBody.appendChild(wrap);
  }

  const form = $("#dlgForm");
  const handler = (ev) => {
    // dialog returns close event after submit; use returnValue
    if (els.dlg.returnValue !== "ok") return cleanup();

    const values = {};
    for (const el of els.dlgBody.querySelectorAll("input, textarea, select")) {
      values[el.name] = el.value;
    }
    cleanup();
    onSubmit(values);
  };

  function cleanup() {
    form.removeEventListener("close", handler);
    els.dlg.removeEventListener("close", handler);
  }

  els.dlg.addEventListener("close", handler, { once: true });
  els.dlg.showModal();
}

function addGroup() {
  const g = {
    id: uid(),
    title: "New group",
    desc: "",
    color: "default",
    open: true,
    items: [],
  };
  state.data.groups.unshift(g);
  scheduleSave();
  render();
}

function editGroup(groupId) {
  const g = getGroup(groupId);
  if (!g) return;

  openDialog(
    "Edit group",
    [
      { name: "title", label: "Title", type: "text", value: g.title },
      { name: "desc", label: "Description", type: "textarea", value: g.desc },
      {
        name: "color",
        label: "Background color",
        type: "select",
        value: normalizeGroupColor(g.color),
        options: GROUP_COLOR_OPTIONS,
      },
    ],
    (vals) => {
      g.title = (vals.title || "").trim() || "Untitled";
      g.desc = (vals.desc || "").trim();
      g.color = normalizeGroupColor(vals.color);
      scheduleSave();
      render();
    }
  );
}

function deleteGroup(groupId) {
  const g = getGroup(groupId);
  if (!g) return;
  const ok = confirm("Delete this group? You can restore it from Deleted within 30 days.");
  if (!ok) return;

  const idx = removeById(state.data.groups, groupId);
  if (idx >= 0) {
    state.data.trash.unshift({
      ...g,
      open: false,
      deletedAt: Date.now(),
    });
    scheduleSave();
    render();
  }
}

function restoreGroup(groupId) {
  const t = state.data.trash || [];
  const idx = t.findIndex((g) => g.id === groupId);
  if (idx < 0) return;
  const [g] = t.splice(idx, 1);
  g.deletedAt = undefined;
  g.open = true;
  state.data.groups.unshift(g);
  scheduleSave();
  render();
}

function purgeGroup(groupId) {
  const t = state.data.trash || [];
  const idx = t.findIndex((g) => g.id === groupId);
  if (idx < 0) return;
  const ok = confirm("Delete this group forever? This can't be undone.");
  if (!ok) return;
  t.splice(idx, 1);
  scheduleSave();
  render();
}

function pruneTrash() {
  const t = state.data.trash || [];
  if (!t.length) return false;
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const before = t.length;
  state.data.trash = t.filter((g) => (g.deletedAt || 0) >= cutoff);
  return state.data.trash.length !== before;
}

function toggleGroup(groupId) {
  const g = getGroup(groupId);
  if (!g) return;
  g.open = !g.open;
  scheduleSave();

  // small DOM update (no full rerender)
  const node = els.groups.querySelector(`[data-group-id="${groupId}"]`);
  if (!node) return;
  node.dataset.open = g.open ? "1" : "0";
  const body = node.querySelector(".groupBody");
  body.hidden = !g.open;
}

function addItem(groupId, value) {
  const g = getGroup(groupId);
  if (!g) return;

  const v = (value || "").trim();
  if (!v) return;

  const kind = isLikelyUrl(v) ? "link" : "text";
  g.open = true;
  g.items.push({ id: uid(), done: false, kind, value: v });
  scheduleSave();
  render();
}

function editItem(groupId, itemId) {
  const g = getGroup(groupId);
  if (!g) return;
  const it = getItem(g, itemId);
  if (!it) return;

  openDialog(
    "Edit item",
    [
      {
        name: "value",
        label: "Text or URL",
        type: "text",
        value: it.value,
        placeholder: "e.g. https://jira... or 'Write release note'",
      },
      {
        name: "kind",
        label: "Type",
        type: "select",
        value: it.kind,
        options: [
          { value: "text", label: "Text" },
          { value: "link", label: "Link" },
        ],
      },
    ],
    (vals) => {
      const v = (vals.value || "").trim();
      if (!v) return;
      it.value = v;
      it.kind = vals.kind === "link" ? "link" : isLikelyUrl(v) ? "link" : "text";
      scheduleSave();
      render();
    }
  );
}

function deleteItem(groupId, itemId) {
  const g = getGroup(groupId);
  if (!g) return;
  const idx = removeById(g.items, itemId);
  if (idx >= 0) {
    scheduleSave();
    render();
  }
}

function toggleDone(groupId, itemId) {
  const g = getGroup(groupId);
  if (!g) return;
  const it = getItem(g, itemId);
  if (!it) return;
  it.done = !it.done;
  scheduleSave();

  // micro DOM update
  const groupNode = els.groups.querySelector(`[data-group-id="${groupId}"]`);
  if (!groupNode) return;
  const itemNode = groupNode.querySelector(`[data-item-id="${itemId}"]`);
  if (!itemNode) return;
  itemNode.dataset.done = it.done ? "1" : "0";
  itemNode.querySelector('input[type="checkbox"]').checked = it.done;
}

function handleQuickAdd(groupNode) {
  const groupId = groupNode.dataset.groupId;
  const inp = groupNode.querySelector('[data-field="newText"]');
  addItem(groupId, inp.value);
}

function exportJson() {
  const blob = new Blob([JSON.stringify(state.data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "groups-backup.json";
  a.click();
  URL.revokeObjectURL(url);
}

function importJsonFile(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const parsed = JSON.parse(String(reader.result || ""));
      if (!parsed || !Array.isArray(parsed.groups)) throw new Error("Bad format");
      const trash = Array.isArray(parsed.trash) ? parsed.trash : [];
      for (const g of parsed.groups) sanitizeGroupShape(g);
      for (const g of trash) sanitizeGroupShape(g);
      state.data = { version: 1, groups: parsed.groups, trash };
      await saveNow();
      render();
    } catch (e) {
      alert("Import failed: " + e.message);
    }
  };
  reader.readAsText(file);
}

/* --- Events (delegated) --- */

els.btnAddGroup.addEventListener("click", addGroup);
els.btnExport.addEventListener("click", exportJson);

els.importFile.addEventListener("change", (e) => {
  const f = e.target.files?.[0];
  if (f) importJsonFile(f);
  e.target.value = "";
});

els.search.addEventListener("input", () => {
  state.filter = els.search.value || "";
  render();
});

function handleGroupClick(e) {
  const groupNode = e.target.closest(".group");
  const groupId = groupNode?.dataset.groupId;

  const itemNode = e.target.closest(".item");
  const itemId = itemNode?.dataset.itemId;

  const header = e.target.closest(".groupHeader");

  if (
    header &&
    groupId &&
    !e.target.closest("[data-action]") &&
    !e.target.closest("button, a, input, label")
  ) {
    toggleGroup(groupId);
    return;
  }

  const btn = e.target.closest("[data-action]");
  if (!btn) return;

  const action = btn.dataset.action;
  if (!groupId) return;

  if (action === "toggle") toggleGroup(groupId);
  else if (action === "add-item") {
    const g = getGroup(groupId);
    if (g && !g.open) {
      g.open = true;
      scheduleSave();
      render();
    }
    const node =
      els.groups.querySelector(`[data-group-id="${groupId}"]`) || groupNode;
    const input = node.querySelector('[data-field="newText"]');
    if (input) {
      input.focus();
      input.select();
    }
  }
  else if (action === "edit-group") editGroup(groupId);
  else if (action === "delete-group") deleteGroup(groupId);
  else if (action === "quick-add") handleQuickAdd(groupNode);
  else if (action === "edit-item" && itemId) editItem(groupId, itemId);
  else if (action === "delete-item" && itemId) deleteItem(groupId, itemId);
  else if (action === "restore-group") restoreGroup(groupId);
  else if (action === "purge-group") purgeGroup(groupId);
}

els.groups.addEventListener("click", handleGroupClick);
els.trash.addEventListener("click", handleGroupClick);

els.groups.addEventListener("dragstart", (e) => {
  const handle = e.target.closest('[data-action="drag-group"]');
  if (!handle) {
    e.preventDefault();
    return;
  }
  const groupNode = handle.closest(".group");
  if (!groupNode) return;
  dragGroupId = groupNode.dataset.groupId || null;
  groupNode.classList.add("dragging");
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", dragGroupId || "");
  }
});

els.groups.addEventListener("dragover", (e) => {
  if (!dragGroupId) return;
  e.preventDefault();
  const groupNode = e.target.closest(".group");
  if (!groupNode || groupNode.dataset.groupId === dragGroupId) return;
  if (dragOverNode && dragOverNode !== groupNode) {
    dragOverNode.classList.remove("drag-over");
  }
  dragOverNode = groupNode;
  dragOverNode.classList.add("drag-over");
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
});

els.groups.addEventListener("drop", (e) => {
  if (!dragGroupId) return;
  e.preventDefault();
  const groupNode = e.target.closest(".group");
  const targetId = groupNode?.dataset.groupId || null;
  reorderGroups(dragGroupId, targetId);
  if (dragOverNode) dragOverNode.classList.remove("drag-over");
  dragOverNode = null;
  dragGroupId = null;
});

els.groups.addEventListener("dragend", () => {
  const dragging = els.groups.querySelector(".group.dragging");
  if (dragging) dragging.classList.remove("dragging");
  if (dragOverNode) dragOverNode.classList.remove("drag-over");
  dragOverNode = null;
  dragGroupId = null;
});

els.groups.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const groupNode = e.target.closest(".group");
  if (!groupNode) return;

  // Enter on quick-add input triggers add
  if (e.target.matches('[data-field="newText"]')) {
    e.preventDefault();
    handleQuickAdd(groupNode);
  }
});

els.groups.addEventListener("change", (e) => {
  if (e.target.matches('input[type="checkbox"][data-action="toggle-done"]')) {
    const groupNode = e.target.closest(".group");
    const itemNode = e.target.closest(".item");
    if (!groupNode || !itemNode) return;
    toggleDone(groupNode.dataset.groupId, itemNode.dataset.itemId);
  }
});

/* Start */
load();
