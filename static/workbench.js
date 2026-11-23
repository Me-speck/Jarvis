import { beamMesh, inspectMesh, radialMesh, readSTL, Viewport, writeSTL } from "./mesh.js";

const element = id => document.getElementById(id);
const format = value => new Intl.NumberFormat(undefined, { maximumSignificantDigits: 4 }).format(value);
const beamForm = element("beam-form");
const partForm = element("part-form");
const viewport = new Viewport(element("mesh-canvas"));
const PART_NAMES = { tube: "Tube", block: "Rectangular block", cylinder: "Cylinder", taper: "Tapered cylinder" };
const MATERIALS = {
  aluminum: { name: "6061-T6 aluminum", modulus: 69, density: 2700, yield: 276 },
  steel: { name: "Mild steel, nominal", modulus: 200, density: 7850, yield: 250 },
  pla: { name: "PLA, illustrative bulk", modulus: 3.5, density: 1240, yield: 50 },
};
const STEPS = [
  "Verify the dimensions and units against the drawing.",
  "Confirm material, stock, and process with the fabricator.",
  "Export the STL and inspect it in the downstream fabrication tool.",
  "Dry-fit the part and verify clearances before final assembly.",
  "Inspect the assembled part and record dimensional deviations.",
];
let mesh;
let meshName;
let metrics;
let meshKind;
let beam;
let simulation;
let assemblyChecks = [];

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}

function save(key, value, status) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { status.textContent = "Browser storage is full or unavailable. Export your changes."; }
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.querySelectorAll("[data-view]").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-view]").forEach(tab => {
      const selected = tab === button;
      tab.setAttribute("aria-pressed", String(selected));
      element(tab.dataset.view).hidden = !selected;
    });
    if (button.dataset.view === "design") viewport.invalidate();
  });
});

function updateMaterial() {
  const material = MATERIALS[element("material").value];
  element("material-info").textContent = `E ${material.modulus} GPa · Density ${format(material.density)} kg/m³ · Nominal yield ${material.yield} MPa`;
}

function renderPlan() {
  element("plan-title").textContent = meshName;
  element("plan-summary").textContent = `Current model: ${metrics.size.map(format).join(" × ")} mm`;
  const list = element("plan-steps");
  list.replaceChildren();
  STEPS.forEach((step, index) => {
    const row = document.createElement("li");
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(assemblyChecks[index]);
    checkbox.addEventListener("change", () => { assemblyChecks[index] = checkbox.checked; });
    label.append(checkbox, document.createTextNode(step));
    row.append(label);
    list.append(row);
  });
}

function setMesh(nextMesh, name, kind) {
  const stats = inspectMesh(nextMesh);
  mesh = nextMesh;
  meshName = name;
  meshKind = kind;
  metrics = stats;
  viewport.setMesh(mesh, metrics, kind !== "imported");
  element("mesh-label").textContent = meshName;
  element("bounds").textContent = `${metrics.size.map(format).join(" × ")} mm`;
  element("triangles").textContent = metrics.count.toLocaleString();
  element("area").textContent = format(metrics.area) + " mm²";
  element("edge-counts").textContent = metrics.boundary + " / " + metrics.nonManifold;
  element("zero-faces").textContent = metrics.degenerate.toLocaleString();
  element("winding").textContent = metrics.winding.toLocaleString();
  element("volume").textContent = metrics.volume === null ? "Unavailable" : format(metrics.volume) + " mm³";
  const health = element("mesh-health");
  const hasIssues = metrics.volume === null || metrics.inward || metrics.volume === 0;
  health.dataset.issues = String(hasIssues);
  health.textContent = hasIssues ? "Review mesh" : "Closed edge pairs";
  const notes = [];
  if (kind === "imported") notes.push("STL has no unit metadata. Inspection assumes millimeters.");
  if (metrics.inward) notes.push("The signed volume is negative. Check face orientation in your slicer.");
  if (!viewport.renderer && metrics.count > 10000) notes.push("Viewport samples triangles for orbit performance.");
  element("mesh-status").textContent = notes.join(" ");
  assemblyChecks = [];
  renderPlan();
}

function updatePartFields() {
  const shape = element("part-shape").value;
  partForm.querySelectorAll("[data-shapes]").forEach(label => {
    label.hidden = !label.dataset.shapes.split(" ").includes(shape);
    label.querySelector("input, select").disabled = label.hidden;
  });
  element("part-status").textContent = "";
}

function buildPart() {
  const values = Object.fromEntries(new FormData(partForm));
  const { shape } = values;
  const height = Number(values.partHeight);
  const status = element("part-status");
  const diameter = Number(values.diameter);
  const bore = shape === "tube" ? Number(values.bore) : 0;
  if (bore && diameter - bore < 0.02) {
    status.textContent = "The outer diameter must exceed the bore by at least 0.02 mm.";
    return;
  }
  const next = shape === "block"
    ? beamMesh(Number(values.partLength), Number(values.partWidth), height)
    : radialMesh(diameter, shape === "taper" ? Number(values.topDiameter) : diameter, height, bore, Number(values.segments));
  try {
    setMesh(next, PART_NAMES[shape], "part");
    status.textContent = "";
    save("jarvis-part-v1", values, status);
  } catch (error) {
    status.textContent = error.message;
  }
}

function analyzeBeam({ length, width, height, load }, material) {
  const inertia = width * height ** 3 / 12;
  const deflection = load * length ** 3 / (3 * material.modulus * 1000 * inertia);
  const stress = load * length * height / (2 * inertia);
  const mass = length * width * height * material.density / 1e9;
  return { deflection, stress, mass, ratio: stress ? material.yield / stress : null };
}

function runSimulation(showModel) {
  const data = new FormData(beamForm);
  const nextBeam = Object.fromEntries(["length", "width", "height", "load"].map(key => [key, Number(data.get(key))]));
  nextBeam.material = data.get("material");
  const { length, width, height } = nextBeam;
  const material = MATERIALS[nextBeam.material];
  simulation = analyzeBeam(nextBeam, material);
  const { deflection, stress, mass, ratio } = simulation;
  const geometryChanged = !beam || ["length", "width", "height"].some(key => nextBeam[key] !== beam[key]);
  beam = nextBeam;
  if (!mesh || (meshKind === "beam" && geometryChanged) || (showModel && meshKind !== "beam")) {
    setMesh(beamMesh(length, width, height), "Beam prototype", "beam");
  }
  element("deflection").textContent = format(deflection) + " mm";
  element("stress").textContent = format(stress) + " MPa";
  element("mass").textContent = format(mass) + " kg";
  element("margin").textContent = ratio === null ? "— (zero load)" : format(ratio);
  const comparison = element("material-comparison");
  comparison.replaceChildren();
  for (const preset of Object.values(MATERIALS)) {
    const result = analyzeBeam(nextBeam, preset);
    const row = comparison.insertRow();
    const name = document.createElement("th");
    name.scope = "row";
    name.textContent = preset.name;
    row.appendChild(name);
    row.insertCell().textContent = format(result.deflection) + " mm";
    row.insertCell().textContent = format(result.mass) + " kg";
  }
  const notices = [];
  if (length < 10 * height) notices.push("Short beam: shear deformation may be significant.");
  if (deflection > length / 20) notices.push("Large deflection: the linear estimate is outside its intended range.");
  if (stress >= material.yield) notices.push("Estimated stress reaches nominal yield. The linear result is outside its intended range.");
  if (nextBeam.material === "pla") notices.push("Printed PLA properties vary with layer orientation and process.");
  const status = element("simulation-note");
  status.textContent = notices.join(" ");
  save("jarvis-beam-v1", beam, status);
}

const savedBeam = load("jarvis-beam-v1", {});
for (const [key, value] of Object.entries(savedBeam || {})) {
  const field = beamForm.elements.namedItem(key);
  if (field instanceof HTMLInputElement && typeof value === "number") field.value = value;
  if (field === element("material") && typeof value === "string" && Object.hasOwn(MATERIALS, value)) field.value = value;
}
if (!beamForm.checkValidity()) beamForm.reset();
const savedPart = load("jarvis-part-v1", {});
for (const [key, value] of Object.entries(savedPart)) {
  const field = partForm.elements.namedItem(key);
  if (field && typeof value === "string") {
    if (field instanceof HTMLInputElement || Array.from(field.options).some(option => option.value === value)) {
      field.value = value;
    }
  }
}
updatePartFields();
if (!partForm.checkValidity()) {
  partForm.reset();
  updatePartFields();
}
buildPart();
element("part-shape").addEventListener("change", updatePartFields);
partForm.addEventListener("submit", event => {
  event.preventDefault();
  buildPart();
});
updateMaterial();
runSimulation(false);
beamForm.addEventListener("input", () => {
  updateMaterial();
  element("simulation-note").textContent = "Inputs changed. Run the simulation to refresh these results.";
});
beamForm.addEventListener("submit", event => {
  event.preventDefault();
  runSimulation(false);
});
element("show-beam").addEventListener("click", () => {
  if (beamForm.reportValidity()) runSimulation(true);
});
element("mesh-file").addEventListener("change", async event => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    if (file.size > 16 * 1024 * 1024) throw new Error("Open an STL smaller than 16 MB.");
    setMesh(readSTL(await file.arrayBuffer()), file.name, "imported");
  } catch (error) {
    element("mesh-status").textContent = error.message;
  }
});
element("wireframe").addEventListener("click", event => {
  viewport.wireframe = !viewport.wireframe;
  event.target.setAttribute("aria-pressed", String(viewport.wireframe));
  viewport.invalidate();
});
element("reset-camera").addEventListener("click", () => viewport.reset());
element("export-stl").addEventListener("click", () => {
  const name = meshKind === "imported" ? meshName.replace(/\.stl$/i, "") : meshName.toLowerCase().replaceAll(" ", "-");
  download(name + ".stl", writeSTL(mesh), "model/stl");
});
element("export-plan").addEventListener("click", () => {
  const design = `# Build plan: ${meshName}\n\nModel bounds: ${metrics.size.join(" × ")} mm.\n`;
  const analysis = meshKind === "beam"
    ? `Material: ${MATERIALS[beam.material].name}. Tip load: ${beam.load} N.\nEstimated deflection: ${format(simulation.deflection)} mm. Estimated stress: ${format(simulation.stress)} MPa.\n`
    : "This mesh has no cantilever simulation result.\n";
  const checks = STEPS.map((step, index) => `- [${assemblyChecks[index] ? "x" : " "}] ${step}`).join("\n");
  download("build-plan.md", design + analysis + "\n" + checks + "\n", "text/markdown");
});

const MAX_FILES = 16;
const MAX_SOURCE = 160000;
const starter = { name: "example.py", source: "def millimeters_to_meters(length_mm):\n    return length_mm / 1000\n" };
const storedFiles = load("jarvis-project-files-v1", [starter]);
const files = Array.isArray(storedFiles) ? storedFiles : [starter];
const editor = element("source");
const fileSelect = element("file-select");
const fileStatus = element("file-status");
const output = element("code-output");
const copy = element("copy-code");
const review = element("review-code");
const editDialog = element("edit-dialog");
const editPreview = element("edit-preview");
const applyEdit = element("apply-edit");
const editValidation = element("edit-validation");
const codeForm = element("code-form");
const assist = codeForm.querySelector("button[type=submit]");
const draft = element("draft-edit");
const modelEnabled = !assist.disabled;
const checkCode = element("check-code");
let active = 0;
let coding = false;
let proposal;

function canApply(candidate) {
  return candidate && files[active] === candidate.file && candidate.file.name === candidate.name &&
    candidate.file.source === candidate.original;
}

function refreshReview() {
  review.disabled = !canApply(proposal);
  if (proposal && review.disabled) {
    element("edit-status").textContent = "Original file changed or is not selected.";
  } else {
    element("edit-status").textContent = "";
  }
}

function renderFiles() {
  fileSelect.replaceChildren();
  files.forEach((file, index) => {
    fileSelect.add(new Option(file.name, index, index === active, index === active));
  });
  editor.value = files[active]?.source ?? "";
  for (const control of [editor, fileSelect, element("rename-file"), element("remove-file"), element("download-file"), checkCode]) {
    control.disabled = !files.length;
  }
  checkCode.disabled = coding || !files.length;
  draft.disabled = coding || !modelEnabled || !files.length;
  refreshReview();
}

function storeFiles() {
  save("jarvis-project-files-v1", files, fileStatus);
}

function nextFileName(original) {
  let name = original;
  let suffix = 2;
  const dot = original.lastIndexOf(".");
  const stem = dot > 0 ? original.slice(0, dot) : original;
  const extension = dot > 0 ? original.slice(dot, dot + 20) : "";
  while (files.some(file => file.name === name)) name = `${stem.slice(0, 90)} (${suffix++})${extension}`;
  return name;
}

fileSelect.addEventListener("change", () => {
  active = Number(fileSelect.value);
  renderFiles();
});
editor.addEventListener("input", () => {
  if (!files[active]) return;
  files[active].source = editor.value;
  fileStatus.textContent = "Saved in this browser.";
  storeFiles();
  refreshReview();
});
editor.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    requestCode("check");
  }
});
element("code-files").addEventListener("change", async event => {
  const chosen = Array.from(event.target.files);
  event.target.value = "";
  let opened = 0;
  for (const file of chosen) {
    if (files.length >= MAX_FILES) break;
    if (file.size > MAX_SOURCE * 4 || file.name.length > 120) continue;
    try {
      const contents = await file.text();
      if (contents.length > MAX_SOURCE || contents.includes("\0") || files.length >= MAX_FILES) continue;
      files.push({ name: nextFileName(file.name), source: contents });
      active = files.length - 1;
      opened++;
    } catch {
      continue;
    }
  }
  fileStatus.textContent = `Opened ${opened} of ${chosen.length} files. Limit: 16 text files, 160,000 characters each.`;
  renderFiles();
  storeFiles();
});
const dialog = element("file-dialog");
let renameTarget;
element("new-file").addEventListener("click", () => {
  if (files.length >= MAX_FILES) {
    fileStatus.textContent = "Remove a file to make room. The workspace holds up to 16 files.";
    return;
  }
  element("new-file-name").value = "";
  element("new-file-status").textContent = "";
  element("confirm-file").textContent = "Create file";
  renameTarget = undefined;
  dialog.showModal();
});
element("rename-file").addEventListener("click", () => {
  renameTarget = files[active];
  element("new-file-name").value = renameTarget.name;
  element("new-file-status").textContent = "";
  element("confirm-file").textContent = "Rename file";
  dialog.showModal();
});
element("cancel-new-file").addEventListener("click", () => dialog.close());
element("new-file-form").addEventListener("submit", event => {
  event.preventDefault();
  const name = element("new-file-name").value.trim();
  if (!name || /[/\\]/.test(name) || name === "." || name === ".." ||
      files.some(file => file !== renameTarget && file.name === name)) {
    element("new-file-status").textContent = "Enter a unique file name with no path separators.";
    return;
  }
  if (renameTarget) {
    renameTarget.name = name;
  } else if (files.length < MAX_FILES) {
    files.push({ name, source: "" });
    active = files.length - 1;
  } else {
    element("new-file-status").textContent = "The workspace already holds 16 files.";
    return;
  }
  dialog.close();
  renderFiles();
  storeFiles();
  editor.focus();
});
element("download-file").addEventListener("click", () => {
  const file = files[active];
  if (file) download(file.name, file.source, "text/plain");
});
element("remove-file").addEventListener("click", () => {
  const file = files[active];
  if (!file || !window.confirm(`Remove "${file.name}" from this browser workspace?`)) return;
  files.splice(active, 1);
  active = Math.max(0, Math.min(active, files.length - 1));
  renderFiles();
  storeFiles();
});

async function callCode(payload) {
  const response = await fetch("/workbench/code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { ok: response.ok, result: await response.json() };
}

async function requestCode(action, drafting = false) {
  if (coding) return;
  const file = files[active];
  const payload = { action, name: file?.name ?? "scratch.txt", source: file?.source ?? "" };
  const original = payload.source;
  let start = 0;
  let end = original.length;
  proposal = undefined;
  refreshReview();
  if (action === "assist") {
    payload.draft = drafting;
    payload.prompt = element("coding-request").value;
    const selection = editor.value.slice(editor.selectionStart, editor.selectionEnd);
    if (selection) {
      start = editor.selectionStart;
      end = editor.selectionEnd;
      payload.source = selection;
      payload.selection = true;
    }
    if (payload.source.length > 4500) {
      copy.disabled = true;
      output.textContent = "Select up to 4,500 characters of code for Jarvis to review.";
      return;
    }
  }
  coding = true;
  assist.disabled = true;
  draft.disabled = true;
  checkCode.disabled = true;
  copy.disabled = true;
  output.textContent = action === "assist" ? "Jarvis is reviewing the request…" : "Checking syntax…";
  try {
    const { ok, result } = await callCode(payload);
    output.textContent = result.response ?? result.error;
    copy.disabled = action !== "assist" || !ok;
    if (drafting && ok && file && typeof result.replacement === "string") {
      let code = result.replacement;
      if (code && original.slice(start, end).endsWith("\n") && !code.endsWith("\n")) code += "\n";
      proposal = { file, name: payload.name, original, start, end, selected: Boolean(payload.selection), code };
      refreshReview();
    }
  } catch {
    output.textContent = "The local coding service could not be reached.";
  } finally {
    coding = false;
    assist.disabled = !modelEnabled;
    draft.disabled = !modelEnabled || !files.length;
    checkCode.disabled = !files.length;
  }
}

review.addEventListener("click", () => {
  if (!canApply(proposal)) return;
  element("edit-target").textContent = proposal.selected
    ? `Replace the original selection in ${proposal.name}.`
    : `Replace the entire contents of ${proposal.name}.`;
  editPreview.value = proposal.code;
  editValidation.textContent = "";
  editDialog.showModal();
});
element("cancel-edit").addEventListener("click", () => editDialog.close());
applyEdit.addEventListener("click", async () => {
  const candidate = proposal;
  if (!canApply(candidate)) {
    editValidation.textContent = "The original file changed. Request a fresh edit.";
    return;
  }
  const replacement = editPreview.value;
  const updated = candidate.original.slice(0, candidate.start) + replacement + candidate.original.slice(candidate.end);
  if (updated.length > MAX_SOURCE) {
    editValidation.textContent = "This edit exceeds the editor's file size limit.";
    return;
  }
  applyEdit.disabled = true;
  editPreview.disabled = true;
  try {
    if (/\.(py|json)$/i.test(candidate.name)) {
      editValidation.textContent = "Checking the updated file…";
      const { ok, result } = await callCode({ action: "check", name: candidate.name, source: updated });
      if (!ok || !result.ok) {
        editValidation.textContent = result.response ?? result.error;
        return;
      }
    }
    if (!editDialog.open || proposal !== candidate || !canApply(candidate)) return;
    candidate.file.source = updated;
    proposal = undefined;
    fileStatus.textContent = "Reviewed edit applied.";
    storeFiles();
    editDialog.close();
    renderFiles();
    editor.focus();
  } catch {
    editValidation.textContent = "Could not check the updated file.";
  } finally {
    applyEdit.disabled = false;
    editPreview.disabled = false;
  }
});
checkCode.addEventListener("click", () => requestCode("check"));
codeForm.addEventListener("submit", event => {
  event.preventDefault();
  requestCode("assist", event.submitter === draft);
});
copy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(output.textContent);
    fileStatus.textContent = "Reply copied.";
  } catch {
    fileStatus.textContent = "Select the reply to copy it manually.";
  }
});
renderFiles();
