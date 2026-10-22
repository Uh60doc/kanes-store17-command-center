/* Zones/print, Executive Report, Imports, Setup panels. */
(function () {
  const E = globalThis.InventoryEvents;
  const Persist = globalThis.InventoryPersist;
  const Report = globalThis.InventoryReport;
  const Print = globalThis.InventoryPrint;
  const Import = globalThis.InventoryImport;
  const Sync = globalThis.InventorySync;

  let nav = "scanner";
  let reportView = "full";
  let lastIdentifiedValidation = null;
  let lastExpectedValidation = null;
  let lastIdentifiedText = "";
  let lastExpectedText = "";

  function app() {
    return globalThis.FloorApp;
  }

  function state() {
    return app().getState();
  }

  function catalogMap() {
    return app().bySku();
  }

  function bind() {
    document.querySelectorAll("[data-nav]").forEach((btn) => {
      btn.addEventListener("click", () => {
        nav = btn.getAttribute("data-nav");
        renderNav();
        if (nav === "scanner") app().focusScan();
      });
    });

    document.querySelectorAll("[data-report-view]").forEach((btn) => {
      btn.addEventListener("click", () => {
        reportView = btn.getAttribute("data-report-view");
        renderReport();
      });
    });
    const reportSearch = document.querySelector("#report-search");
    if (reportSearch) {
      reportSearch.addEventListener("input", () => renderReport());
    }
    const statusZone = document.querySelector("#status-zone");
    if (statusZone) {
      statusZone.addEventListener("change", () => {
        document.querySelector("#print-zone").value = statusZone.value;
        fillAreaSelect();
      });
    }

    const printReport = document.querySelector("#print-report");
    if (printReport) {
      printReport.addEventListener("click", () => {
        window.print();
      });
    }

    const zoneSelect = document.querySelector("#print-zone");
    const areaSelect = document.querySelector("#print-area");
    if (zoneSelect) {
      zoneSelect.addEventListener("change", () => {
        fillAreaSelect();
        previewPrint();
      });
    }
    if (areaSelect) {
      areaSelect.addEventListener("change", previewPrint);
    }
    const printBtn = document.querySelector("#print-area-sheet");
    if (printBtn) {
      printBtn.addEventListener("click", () => {
        const html = document.querySelector("#print-preview")?.getAttribute("data-html");
        if (!html) return;
        const w = window.open("", "_blank");
        if (!w) return;
        w.document.write(html);
        w.document.close();
      });
    }

    document.querySelectorAll("[data-import-type]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelector("#import-identified-panel").hidden = btn.getAttribute("data-import-type") !== "identified";
        document.querySelector("#import-expected-panel").hidden = btn.getAttribute("data-import-type") !== "expected";
      });
    });

    const idFile = document.querySelector("#import-identified-file");
    if (idFile) {
      idFile.addEventListener("change", async () => {
        const file = idFile.files && idFile.files[0];
        if (!file) return;
        lastIdentifiedText = await file.text();
        lastIdentifiedValidation = Import.validateIdentified(lastIdentifiedText, {
          catalogBySku: catalogMap(),
          allowCreateArea: true,
        });
        showValidation("#identified-validation", lastIdentifiedValidation);
      });
    }
    const expFile = document.querySelector("#import-expected-file");
    if (expFile) {
      expFile.addEventListener("change", async () => {
        const file = expFile.files && expFile.files[0];
        if (!file) return;
        lastExpectedText = await file.text();
        lastExpectedValidation = Import.validateExpected(lastExpectedText);
        showValidation("#expected-validation", lastExpectedValidation);
      });
    }

    const confirmId = document.querySelector("#confirm-identified");
    if (confirmId) {
      confirmId.addEventListener("click", () => {
        if (!lastIdentifiedValidation || !lastIdentifiedValidation.ok) {
          app().say("Fix validation errors before confirming.");
          return;
        }
        const result = Import.commitIdentified(state(), lastIdentifiedValidation, {});
        Persist.appendAudit(state(), {
          action: "import_identified",
          detail: `batch ${result.batchId} added ${result.added} duplicate=${result.duplicate}`,
        });
        app().save();
        document.querySelector("#identified-receipt").textContent = result.duplicate
          ? `Duplicate batch (checksum). No extra units. Batch ${result.batchId}.`
          : `Imported ${result.added} units. Batch ${result.batchId}.`;
        renderZones();
      });
    }

    const confirmExp = document.querySelector("#confirm-expected");
    if (confirmExp) {
      confirmExp.addEventListener("click", () => {
        if (!lastExpectedValidation || !lastExpectedValidation.ok) {
          app().say("Fix validation errors before confirming.");
          return;
        }
        const date = document.querySelector("#expected-date")?.value || "";
        const source = document.querySelector("#expected-source")?.value || "csv-import";
        const result = Import.commitExpected(state(), lastExpectedValidation, {
          snapshotDate: date,
          source,
        });
        Persist.appendAudit(state(), {
          action: "import_expected",
          detail: `batch ${result.batchId}`,
        });
        app().save();
        document.querySelector("#expected-receipt").textContent =
          `Expected snapshot loaded (${state().expected.rows.length} SKUs). Batch ${result.batchId}.`;
        renderReport();
        renderGoNoGo();
      });
    }

    const saveSync = document.querySelector("#save-sync-settings");
    if (saveSync) {
      saveSync.addEventListener("click", () => {
        state().syncEndpoint = document.querySelector("#sync-endpoint").value.trim();
        state().syncToken = document.querySelector("#sync-token").value.trim();
        app().save();
        app().say("Sync settings saved locally.");
      });
    }

    const exportRecovery = document.querySelector("#export-recovery");
    if (exportRecovery) {
      exportRecovery.addEventListener("click", () => {
        const blob = new Blob([Persist.exportRecoveryJson(state())], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "store17-inventory-recovery.json";
        a.click();
        URL.revokeObjectURL(a.href);
      });
    }

    document.querySelectorAll("[data-area-status-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const zone = document.querySelector("#status-zone")?.value;
        const area = document.querySelector("#status-area")?.value;
        const status = btn.getAttribute("data-area-status-action");
        if (!zone || !area) return;
        Persist.setAreaStatus(state(), zone, area, status, { bumpRevision: status === "complete" });
        Persist.appendAudit(state(), { action: "area_status", detail: `${zone}/${area}=${status}` });
        app().save();
        renderZones();
        renderGoNoGo();
      });
    });

    renderNav();
  }

  function showValidation(sel, validation) {
    const el = document.querySelector(sel);
    if (!el) return;
    const lines = [];
    lines.push(validation.ok ? "Validation OK" : "Validation FAILED");
    lines.push(`Checksum ${validation.checksum}`);
    if (validation.unitTotal != null) lines.push(`Units to create: ${validation.unitTotal}`);
    for (const e of validation.errors.slice(0, 20)) lines.push(`ERROR: ${e}`);
    for (const w of validation.warnings.slice(0, 20)) lines.push(`WARN: ${w}`);
    el.textContent = lines.join("\n");
  }

  function renderNav() {
    document.querySelectorAll("[data-nav]").forEach((btn) => {
      btn.setAttribute("aria-pressed", btn.getAttribute("data-nav") === nav ? "true" : "false");
    });
    const map = {
      scanner: "#panel-scanner",
      zones: "#panel-zones",
      report: "#panel-report",
      imports: "#panel-imports",
      setup: "#panel-setup",
    };
    Object.entries(map).forEach(([key, sel]) => {
      const el = document.querySelector(sel);
      if (el) el.hidden = key !== nav;
    });
    const tools = document.querySelector("#scanner-tools");
    if (tools) tools.hidden = nav !== "scanner";
    if (nav === "zones") renderZones();
    if (nav === "report") renderReport();
    if (nav === "setup") renderSetup();
    if (nav === "imports") { /* noop */ }
  }

  function incompleteAreaKeys() {
    const keys = new Set();
    const st = state();
    for (const areaId of Object.keys(st.areaOwner || {})) {
      const zoneId = st.areaOwner[areaId];
      const row = Persist.ensureAreaStatus(st, zoneId, areaId);
      if (row.status !== "complete") keys.add(`${zoneId}|${areaId}`);
    }
    return keys;
  }

  function renderReport() {
    const built = Report.buildReport({
      events: state().events,
      expected: state().expected,
      catalogBySku: catalogMap(),
      view: reportView,
      query: document.querySelector("#report-search")?.value || "",
      incompleteAreaKeys: incompleteAreaKeys(),
    });
    const notice = document.querySelector("#report-notice");
    if (notice) notice.textContent = built.coverage.notice;
    const meta = document.querySelector("#report-meta");
    if (meta) {
      meta.textContent = `Generated ${built.coverage.generatedAt} · Snapshot ${built.coverage.snapshotDate || "n/a"} · ${built.rows.length} rows`;
    }
    document.querySelectorAll("[data-report-view]").forEach((btn) => {
      btn.setAttribute("aria-pressed", btn.getAttribute("data-report-view") === reportView ? "true" : "false");
    });
    const body = document.querySelector("#report-body");
    if (!body) return;
    body.replaceChildren();
    for (const row of built.rows) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="sku">${escape(row.sku)}</td>
        <td>${escape(row.description)}</td>
        <td>${escape(row.expectedLabel)}</td>
        <td>${row.identifiedQty}</td>
        <td>${escape(row.varianceLabel)}${row.preliminary ? " *" : ""}</td>
        <td>${escape(row.locationsLabel)}</td>`;
      body.appendChild(tr);
    }
  }

  function fillZoneSelects() {
    const zones = [...new Set((state().zones || []).map((z) => z.id || z.letter))].sort(LCompare);
    for (const sel of ["#print-zone", "#status-zone"]) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const cur = el.value;
      el.replaceChildren();
      for (const z of zones) {
        const o = document.createElement("option");
        o.value = z;
        o.textContent = z;
        el.appendChild(o);
      }
      if (zones.includes(cur)) el.value = cur;
    }
  }

  function LCompare(a, b) {
    return globalThis.FloorLogic.compareZoneNames(a, b);
  }

  function fillAreaSelect() {
    const zone = document.querySelector("#print-zone")?.value;
    const el = document.querySelector("#print-area");
    if (!el) return;
    el.replaceChildren();
    const whole = document.createElement("option");
    whole.value = "";
    whole.textContent = "Entire Zone";
    el.appendChild(whole);
    const areas = Object.keys(state().areaOwner || {})
      .filter((a) => state().areaOwner[a] === zone)
      .sort();
    for (const a of areas) {
      const o = document.createElement("option");
      o.value = a;
      o.textContent = a;
      el.appendChild(o);
    }
    const statusArea = document.querySelector("#status-area");
    if (statusArea) {
      statusArea.replaceChildren();
      for (const a of areas) {
        const o = document.createElement("option");
        o.value = a;
        o.textContent = a;
        statusArea.appendChild(o);
      }
    }
  }

  function previewPrint() {
    const zoneId = document.querySelector("#print-zone")?.value;
    if (!zoneId) return;
    const areaId = document.querySelector("#print-area")?.value || null;
    const model = Print.buildPrintModel({
      zoneId,
      areaId,
      events: state().events,
      areaStatus: state().areaStatus,
      catalogBySku: catalogMap(),
    });
    const html = Print.renderPrintHtml(model);
    const preview = document.querySelector("#print-preview");
    if (preview) {
      preview.setAttribute("data-html", html);
      preview.innerHTML = `<p>${model.totalUnits} barcode(s) · ${model.mode === "area" ? `Area ${areaId}` : "Entire zone"} · rev shown per area</p>`;
    }
  }

  function renderZones() {
    fillZoneSelects();
    fillAreaSelect();
    previewPrint();
    const body = document.querySelector("#zone-progress-body");
    if (!body) return;
    body.replaceChildren();
    const st = state();
    for (const areaId of Object.keys(st.areaOwner || {}).sort()) {
      const zoneId = st.areaOwner[areaId];
      const row = Persist.ensureAreaStatus(st, zoneId, areaId);
      const units = E.areaUnitList(st.events, zoneId, areaId).length;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escape(zoneId)}</td>
        <td>${escape(areaId)}</td>
        <td>${escape(row.status)}</td>
        <td>${row.revision}</td>
        <td>${units}</td>
        <td>${escape(row.updatedAt)}</td>`;
      body.appendChild(tr);
    }
    renderGoNoGo();
  }

  function renderSetup() {
    const ep = document.querySelector("#sync-endpoint");
    const tok = document.querySelector("#sync-token");
    if (ep) ep.value = state().syncEndpoint || "";
    if (tok) tok.value = state().syncToken || "";
    const health = document.querySelector("#sync-health");
    if (health) {
      const s = Sync.summaryBadges(state().events);
      health.textContent = `${s.label} · last sync ${state().lastSyncAt || "never"} · events ${state().events.length}`;
    }
    renderGoNoGo();
  }

  function renderGoNoGo() {
    const el = document.querySelector("#go-nogo");
    if (!el) return;
    const st = state();
    const pending = E.pendingSync(st.events).filter((e) => e.syncStatus === "error");
    const incomplete = incompleteAreaKeys().size;
    const checks = [
      {
        ok: Boolean(st.expected && st.expected.loaded),
        label: st.expected?.loaded
          ? `Expected snapshot loaded (${st.expected.snapshotDate || "?"})`
          : "Expected snapshot NOT loaded",
      },
      {
        ok: incomplete === 0 && Object.keys(st.areaOwner || {}).length > 0,
        label: incomplete
          ? `${incomplete} area(s) not Complete`
          : Object.keys(st.areaOwner || {}).length
            ? "All known areas Complete"
            : "No areas started",
      },
      {
        ok: pending.length === 0,
        label: pending.length ? `${pending.length} sync error(s)` : "No sync errors",
      },
      {
        ok: true,
        label: "Barcode hardware verification: NOT TESTED in this environment (operator check)",
      },
    ];
    const go = checks.every((c) => c.ok || c.label.includes("NOT TESTED"));
    // GO only if expected loaded, areas complete, no sync errors
    const ready = checks[0].ok && checks[1].ok && checks[2].ok;
    el.innerHTML = `<p><strong>${ready ? "GO" : "NO-GO"}</strong> for inventory day</p><ul>${
      checks.map((c) => `<li>${c.ok ? "✓" : "✗"} ${escape(c.label)}</li>`).join("")
    }</ul>`;
  }

  function escape(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
    ));
  }

  globalThis.InventoryPanels = {
    onStateChange() {
      if (nav === "zones") renderZones();
      if (nav === "report") renderReport();
      if (nav === "setup") renderSetup();
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
