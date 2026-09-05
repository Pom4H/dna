const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const words = {
  starting: "Запускается",
  "awaiting-payment": "Ожидает оплату",
  "awaiting-deposit": "Ожидает аванс",
  "awaiting-installation": "Ожидает монтаж",
  "awaiting-kit": "Ожидает комплект",
  "reserving-kit": "Резервирует комплект",
  retrying: "Восстанавливает шаг",
  "blocked-capacity": "Не хватает часов",
  installing: "Выполняет монтаж",
  "awaiting-acceptance": "Ожидает приёмку",
  "awaiting-activation": "Ожидает активацию",
  activating: "Активирует ПО",
  completed: "Обязательство выполнено",
  failed: "Ошибка исполнения",
  pending: "Ожидание",
  running: "Выполняется",
};
let state = null,
  selected = "supplier",
  tab = "decisions",
  busy = false,
  evolution = null;
let sessionId = localStorage.getItem("dna-session") || "";
let shell = localStorage.getItem("dna-shell") || "network";
document.documentElement.dataset.theme =
  localStorage.getItem("dna-theme") || "dark";
document.documentElement.dataset.shell = shell;
let lastInstance = sessionStorage.getItem("dna-instance");
let toastTimer,
  requestEpoch = 0;
function toast(message) {
  $("toast").textContent = message;
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 4500);
}
async function api(path, data, actor) {
  const response = await fetch(path, {
    method: data ? "POST" : "GET",
    headers: {
      ...(data ? { "Content-Type": "application/json" } : {}),
      ...(actor
        ? { Authorization: `Bearer ${state?.capabilities?.[actor] || ""}` }
        : {}),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`);
  return value;
}
function labelStage(value) {
  const key = String(value).split(" · ")[0];
  return words[key] || key;
}
function positions(n) {
  const mobile = innerWidth < 600;
  return Array.from({ length: n }, (_, i) => {
    const angle = Math.PI + (2 * Math.PI * i) / n;
    return {
      x: 50 + Math.cos(angle) * (mobile ? 25 : 31),
      y: 50 + Math.sin(angle) * (mobile ? 32 : 33),
    };
  });
}
function metrics(subject) {
  return subject.metrics
    .map(
      (m) =>
        `<div><label>${esc(m.label)}</label><b class="${m.value.length > 12 ? "long-value" : ""}">${esc(m.value)}</b>${m.unit ? `<small>${esc(m.unit)}</small>` : ""}</div>`,
    )
    .join("");
}
function renderNetwork(ui) {
  const canvas = $("canvas");
  canvas.className = `network-canvas ${shell === "workspace" ? "workspace" : ""}`;
  if (!ui) {
    canvas.innerHTML =
      '<div class="empty-canvas"><span class="empty-symbol">⌘</span><h2>Соберите движение из условий</h2><p>Запустите сделку и наблюдайте, как независимые процессы компаний договариваются через события и подтверждения.</p><div class="preview-subjects"><span>01 Покупатель</span><span>↔</span><span>02 Поставщик</span><span>↔</span><span>03 Монтажник</span></div></div>';
    return;
  }
  const points = positions(ui.subjects.length),
    point = (id) => points[ui.subjects.findIndex((s) => s.id === id)];
  const width = Math.max(canvas.clientWidth, 350),
    height = canvas.clientHeight;
  const edges = ui.relations
    .map((r, i) => {
      const a = point(r.from),
        b = point(r.to);
      if (!a || !b) return "";
      const x1 = (a.x * width) / 100,
        y1 = (a.y * height) / 100,
        x2 = (b.x * width) / 100,
        y2 = (b.y * height) / 100;
      const offset = i % 2 === 0 ? -26 : 26,
        mx = (x1 + x2) / 2,
        my = (y1 + y2) / 2 + offset;
      const shortLabel = r.label
        .replace("Получен поставщиком", "Аванс получен")
        .replace("Комплект и заказ на монтаж", "Комплект → монтаж")
        .replace("Установка и передача результата", "Монтаж и приёмка")
        .replace("Активация ПО после приёмки", "Подписка на ПО");
      const tw = Math.min(180, shortLabel.length * 5 + 18);
      return `<path class="edge ${esc(r.state)}" d="M${x1} ${y1} Q${mx} ${my + offset} ${x2} ${y2}"/><g class="edge-label"><rect x="${mx - tw / 2}" y="${my - 9}" width="${tw}" height="18" rx="3"/><text x="${mx}" y="${my + 3}" text-anchor="middle">${esc(shortLabel)}</text></g>`;
    })
    .join("");
  canvas.innerHTML = `<svg class="connection-svg" viewBox="0 0 ${width} ${height}" aria-hidden="true">${edges}</svg><div class="dna-core"><b>dna</b><small>${ui.decisions.filter((d) => d.status === "pass").length} / ${ui.decisions.length} CHECKS</small></div>${ui.subjects.map((subject, i) => `<button class="company ${subject.id === selected ? "selected" : ""}" data-subject="${esc(subject.id)}" data-color="${esc(subject.color)}" style="left:${points[i].x}%;top:${points[i].y}%" aria-pressed="${subject.id === selected}"><div class="company-head"><span class="company-icon">${["⌑", "◈", "⊞", "◇"][i % 4]}</span><div><h3>${esc(subject.label)}</h3><div class="company-role">${esc(subject.role)}</div></div><span class="company-index">0${i + 1}</span></div><div class="company-state">${esc(labelStage(subject.state))}</div><div class="company-metrics">${metrics(subject)}</div></button>`).join("")}`;
}
function renderInspector() {
  const ui = state?.ui,
    box = $("inspector-content");
  if (!ui) {
    box.innerHTML =
      '<h3 class="inspector-subject">У каждого действия<br>есть основание.</h3><p class="inspector-note">Выберите компанию, чтобы увидеть её решения, доступные действия и цифровой след.</p><div class="decision"><b>Модель → Решение → Действие</b><p>Состояние интерфейса приходит из версионированного UI IR.</p></div>';
    return;
  }
  const subject = ui.subjects.find((s) => s.id === selected) || ui.subjects[0];
  if (tab === "passport") {
    const p = state.passport;
    box.innerHTML = `<h3 class="inspector-subject">Паспорт экземпляра</h3><p class="inspector-note">Один физический экземпляр связан с договором, компонентами и подтверждениями.</p><div class="passport-visual"><div class="device"></div></div>${p ? passportRows(p) : '<p class="inspector-note">Паспорт появится в данных сессии.</p>'}<p class="inspector-note" style="margin-top:16px">Идентификаторы демонстрационные. Подлинность чипа здесь не удостоверяется.</p>`;
    return;
  }
  if (tab === "evolution") {
    box.innerHTML = `<h3 class="inspector-subject">Варианты будущего</h3><p class="inspector-note">Ограниченный поиск по синтетическим участникам. Цена и обязательства этой сделки сохраняются.</p>${evolution ? evolutionRows(evolution) : '<p class="muted">Варианты загружаются…</p>'}<div class="run-box"><label>ПРОЦЕСС ИЗМЕНЕНИЯ</label><code>Вариант → симуляция → инварианты → Git review</code></div>`;
    return;
  }
  const flow = state.workflows.find((w) => w.company === subject.id);
  box.innerHTML = `<h3 class="inspector-subject">${esc(subject.label)}</h3><p class="inspector-note">${esc(subject.role)} · ${esc(labelStage(subject.state))}</p>${ui.decisions.map((d) => `<div class="decision"><div class="decision-head"><b>${esc(d.label)}</b><span class="status ${esc(d.status)}">${esc({ pass: "PASS", fail: "WAIT", unknown: "UNKNOWN", conflict: "CONFLICT", error: "ERROR" }[d.status])}</span></div><p>${esc(d.message)}</p></div>`).join("")}${flow ? `<div class="run-box"><label>WORKFLOW · ${esc(flow.status.toUpperCase())}</label><code>${esc(flow.runId)}</code></div>` : ""}<details class="knowledge-details"><summary>Основания и состояния знания ↗</summary>${(ui.knowledge?.facts || []).map((f) => `<div class="fact">${esc(f.label)}<br><b>${esc(f.status)} · ${esc(f.value)}</b></div>`).join("")}<p class="inspector-note">${esc(ui.knowledge?.label || "")}</p></details>`;
}
function passportRows(p) {
  const i = p.identity;
  const rows = [
    ["Экземпляр", i.instanceId],
    ["Серийный номер", i.serial],
    ["Модель / ревизия", `${i.productModelId} / ${i.productRevision}`],
    ["BOM / ревизия", `${i.bomId} / ${i.bomRevision}`],
    ...p.components.map((c) => [
      c.kind === "chip" ? "UID чипа" : "Плата",
      c.id,
    ]),
  ];
  const identity = rows
    .map(
      ([k, v]) =>
        `<div class="passport-row"><label>${esc(k)}</label><code>${esc(v)}</code></div>`,
    )
    .join("");
  const trace = p.trace
    .map(
      (e) =>
        `<div class="passport-row"><label>${esc({ "order-assignment": "Закреплён за заказом", "site-binding": "Установлен на объекте", "scope-acceptance": "Принят заказчиком", "service-activation": "Сервис активирован" }[e.kind])}</label><code>${esc(e.targetId)}</code><details><summary>Подтверждение ↗</summary><code>${esc(e.receiptId)}<br>${esc(e.operationKey)}<br>${esc(e.scopeRevision)} · v${e.version}</code></details></div>`,
    )
    .join("");
  return (
    identity +
    `<h4>История привязок · ${p.trace.length}</h4>` +
    (trace ||
      '<p class="inspector-note">Привязки появятся после подтверждённых операций.</p>')
  );
}
function evolutionRows(result) {
  const candidates = result.candidates || [];
  return (
    candidates
      .map(
        (c) =>
          `<div class="candidate ${c.id === result.bestId ? "best" : ""}"><b>${esc(c.label || c.id)} ${c.id === result.bestId ? "↗ Лучший" : ""}</b><div><span>${c.feasible ? "Допустим" : c.decisions?.quality?.status === "fail" ? "Объём качества" : c.decisions?.buyer?.status === "fail" ? "Предел цены" : "Ограничение"}</span><span>${esc(c.metrics?.unitMarginCents !== undefined ? `${c.metrics.unitMarginCents / 100} EUR` : "")}</span></div></div>`,
      )
      .join("") +
    `<p class="inspector-note" style="margin-top:15px">Лучший вариант среди семи проверенных. Вклад до общих затрат; спрос и качество заданы допущениями.</p>`
  );
}
function render() {
  const ui = state?.ui;
  renderNetwork(ui);
  renderInspector();
  document.querySelectorAll("[data-shell]").forEach((b) => {
    if (b.tagName === "BUTTON")
      b.classList.toggle("selected", b.dataset.shell === shell);
  });
  document
    .querySelectorAll("[data-tab]")
    .forEach((b) => b.classList.toggle("selected", b.dataset.tab === tab));
  $("run-count").textContent = String(state?.workflows?.length || 0).padStart(
    2,
    "0",
  );
  $("receipt-count").textContent = String(
    state?.session?.events?.length || 0,
  ).padStart(2, "0");
  $("actions").innerHTML = (ui?.actions || [])
    .map(
      (a) =>
        `<button class="action-button ${a.enabled ? "enabled" : ""}" data-action="${esc(a.id)}" data-actor="${esc(a.actor)}" ${!a.enabled || busy ? "disabled" : ""} title="${esc(a.reason)}">${esc(a.label)}<small>${esc(ui.subjects.find((s) => s.id === a.actor)?.label || a.actor)}</small></button>`,
    )
    .join("");
  $("ir-label").textContent = ui
    ? `${ui.schema} / ${ui.version} · ${shell === "network" ? "Network shell" : "Workspace shell"}`
    : "Один UI IR · сменные оболочки и темы";
  $("session-label").textContent = state?.session
    ? `AGREEMENT ${state.session.id.slice(0, 8).toUpperCase()} / ${state.session.scopeRevision}`
    : "Сделка ещё не запущена";
  const receipts = (state?.session?.events || []).map((e) => ({
    id: e.id,
    at: e.at,
    actor: e.actor,
    label:
      {
        "pay-deposit": "Аванс получен поставщиком",
        "reserve-kit": "Комплект закреплён за договором",
        "reserve-capacity": "Шесть часов монтажа зарезервированы",
        "complete-installation": "Монтаж выполнен · подрядчик получил EUR 600",
        "accept-delivery": "Заказчик принял текущую версию работ",
        "activate-subscription": "Подписка активирована",
        "repair-capacity": "Подтверждены дополнительные часы",
      }[e.type] || e.type,
    detail: `${e.operationKey} · receipt ${e.id.slice(0, 8)}`,
    status: "receipt",
  }));
  const events = [...receipts, ...(ui?.events || [])].sort((a, b) =>
    b.at.localeCompare(a.at),
  );
  $("ledger-count").textContent = `${events.length} событий`;
  $("ledger").innerHTML = events.length
    ? events
        .map(
          (e) =>
            `<div class="ledger-row ${e.status === "fault" ? "fault" : ""}"><time>${esc(new Date(e.at).toLocaleTimeString("ru-RU"))}</time><span class="ledger-dot"></span><div><b>${esc(e.label)}</b><p>${esc(e.detail)}</p></div><span class="actor">${esc({ buyer: "Заказчик", supplier: "Контур", installer: "Реле" }[e.actor] || e.actor)}</span></div>`,
        )
        .join("")
    : '<p class="muted empty-ledger">Запустите сделку — здесь появятся реальные события локального runtime.</p>';
  if (ui)
    $("contract-total").textContent = (
      ui.contract.totalCents / 100
    ).toLocaleString("ru-RU");
  $("feedback-result").textContent = state?.feedback
    ? `↗ ${state.feedback.title}. Предложение для следующей версии, без изменения текущего договора.`
    : "";
  if (state?.runtime)
    $("instance").textContent =
      `Процесс: ${state.runtime.instanceId.slice(0, 8)}${state.runtime.recovered ? " · восстановлен" : ""}`;
}
async function refresh() {
  if (document.hidden || busy) return;
  const epoch = requestEpoch,
    requestedSession = sessionId;
  try {
    const response = await api(
      `/api/state${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""}`,
    );
    if (epoch !== requestEpoch || requestedSession !== sessionId || busy)
      return;
    state = response;
    $("connection").classList.remove("offline");
    $("connection").innerHTML = "<i></i>LOCAL RUNTIME";
    if (lastInstance && lastInstance !== state.runtime.instanceId)
      toast("Runtime перезапущен. История и процессы восстановлены.");
    lastInstance = state.runtime.instanceId;
    sessionStorage.setItem("dna-instance", lastInstance);
    render();
  } catch (error) {
    if (epoch !== requestEpoch || requestedSession !== sessionId) return;
    $("connection").classList.add("offline");
    $("connection").innerHTML = "<i></i>RECONNECTING";
    if (error.message.includes("ENOENT")) {
      sessionId = "";
      localStorage.removeItem("dna-session");
    }
  }
}
$("start").addEventListener("click", async () => {
  requestEpoch++;
  busy = true;
  $("start").disabled = true;
  try {
    state = await api("/api/sessions", {
      scenario: $("scenario").value,
      fault: $("fault").checked,
    });
    sessionId = state.session.id;
    localStorage.setItem("dna-session", sessionId);
    toast("Три независимых workflow запущены.");
    render();
  } catch (e) {
    toast(e.message);
  } finally {
    busy = false;
    $("start").disabled = false;
  }
});
$("actions").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-action]");
  if (!b || b.disabled || busy) return;
  requestEpoch++;
  busy = true;
  try {
    state = await api(
      "/api/actions",
      {
        sessionId: state.session.id,
        action: b.dataset.action,
        actor: b.dataset.actor,
      },
      b.dataset.actor,
    );
    toast(
      b.dataset.action === "feedback"
        ? "Обратная связь отправлена в процесс улучшения."
        : "Действие подтверждено.",
    );
    render();
  } catch (e) {
    toast(e.message);
  } finally {
    busy = false;
  }
});
$("canvas").addEventListener("click", (e) => {
  const b = e.target.closest("[data-subject]");
  if (b) {
    selected = b.dataset.subject;
    render();
  }
});
document.querySelectorAll("button[data-shell]").forEach((b) =>
  b.addEventListener("click", () => {
    shell = b.dataset.shell;
    localStorage.setItem("dna-shell", shell);
    document.documentElement.dataset.shell = shell;
    render();
  }),
);
document.querySelectorAll("[data-tab]").forEach((b) =>
  b.addEventListener("click", () => {
    tab = b.dataset.tab;
    render();
  }),
);
$("theme").addEventListener("click", () => {
  const theme =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("dna-theme", theme);
});
$("restart").addEventListener("click", async () => {
  try {
    await api("/api/restart", {});
    toast("Сервер остановлен. Подключаемся к новому процессу…");
  } catch (e) {
    toast(e.message);
  }
});
window.addEventListener("resize", () => renderNetwork(state?.ui));
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refresh();
});
api("/api/evolution")
  .then((result) => {
    evolution = result;
    if (tab === "evolution") renderInspector();
  })
  .catch(() => {});
render();
refresh();
setInterval(refresh, 900);
