const data = window.eligibilityData || { insurances: [], providers: [] };
const form = document.getElementById("eligibility-form");
const analyzeBtn = document.getElementById("analyzeBtn");
const addCaseBtn = document.getElementById("addCaseBtn");
const copyBtn = document.getElementById("copyBtn");
const exportPdfBtn = document.getElementById("exportPdfBtn");
const clearBatchBtn = document.getElementById("clearBatchBtn");
const riskList = document.getElementById("riskList");
const generatedNote = document.getElementById("generatedNote");
const finalStatus = document.getElementById("finalStatus");
const riskCount = document.getElementById("riskCount");
const primaryAction = document.getElementById("primaryAction");
const statusBanner = document.getElementById("statusBanner");
const insuranceSelect = document.getElementById("insuranceName");
const providerSelect = document.getElementById("provider");
const planTypeSelect = document.getElementById("planType");
const checkerNameInput = document.getElementById("checkerName");
const reportDateInput = document.getElementById("reportDate");
const lockDosModeInput = document.getElementById("lockDosMode");
const lockedDosInput = document.getElementById("lockedDos");
const checkerDisplay = document.getElementById("checkerDisplay");
const batchCount = document.getElementById("batchCount");
const batchTableBody = document.getElementById("batchTableBody");

const STORAGE_KEY = "eligibility-batch-cases";
let batchCases = [];

function value(id) {
  return document.getElementById(id).value.trim();
}

function setValue(id, nextValue) {
  document.getElementById(id).value = nextValue || "";
}

function dosField() {
  return document.getElementById("dos");
}

function prettyDate(input) {
  if (!input) return "N/A";
  const date = new Date(`${input}T00:00:00`);
  if (Number.isNaN(date.getTime())) return input;
  return date.toLocaleDateString("en-US");
}

function isDosLocked() {
  return lockDosModeInput.value === "on";
}

function syncDosLock() {
  const dosInput = dosField();
  const lockedValue = lockedDosInput.value;
  if (isDosLocked()) {
    dosInput.value = lockedValue || dosInput.value;
    dosInput.readOnly = true;
    dosInput.setAttribute("aria-readonly", "true");
  } else {
    dosInput.readOnly = false;
    dosInput.removeAttribute("aria-readonly");
  }
}

function normalizeBool(valueText) {
  const normalized = String(valueText || "").trim().toUpperCase();
  if (normalized === "YES") return "Yes";
  if (normalized === "NO") return "No";
  return "";
}

function selectedInsurance() {
  return data.insurances.find((item) => item.id === insuranceSelect.value) || null;
}

function selectedProvider() {
  return data.providers.find((item) => item.id === providerSelect.value) || null;
}

function formatInsuranceOption(item) {
  const location = [item.city, item.state].filter(Boolean).join(", ");
  const payer = item.payerId ? `Payer ${item.payerId}` : "No payer ID";
  return `${item.carrierName}${location ? ` - ${location}` : ""} - ${payer}`;
}

function populateDropdowns() {
  const insuranceGroups = [...data.insurances].sort((a, b) => a.carrierName.localeCompare(b.carrierName));
  insuranceGroups.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = formatInsuranceOption(item);
    insuranceSelect.appendChild(option);
  });

  [...data.providers].sort((a, b) => a.name.localeCompare(b.name)).forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.name;
    providerSelect.appendChild(option);
  });
}

function isNamedExceptionCarrier(name) {
  const upper = (name || "").toUpperCase();
  return ["AETNA", "BCBS", "OPTUM", "HPN", "UHC", "HUMANA", "SELECT", "SCAN"].some((token) => upper.includes(token));
}

function applyPlanRules() {
  const insurance = selectedInsurance();
  const authRequired = insurance ? normalizeBool(insurance.authRequired) : "";
  const referralRequired = insurance ? normalizeBool(insurance.referralRequired) : "";

  setValue("authRequired", authRequired);
  setValue("referralRequired", referralRequired);

  if (authRequired === "No") {
    setValue("authStatus", "Not Required");
  } else if (value("authStatus") === "Not Required") {
    setValue("authStatus", "");
  }
}

function syncInsuranceDetails() {
  const insurance = selectedInsurance();
  if (!insurance) {
    ["payerId", "streetAddress", "city", "state", "zipCode"].forEach((id) => setValue(id, ""));
    return;
  }

  setValue("payerId", insurance.payerId);
  setValue("streetAddress", insurance.streetAddress);
  setValue("city", insurance.city);
  setValue("state", insurance.state);
  setValue("zipCode", insurance.zipCode);

  if (insurance.defaultPlanType) {
    setValue("planType", insurance.defaultPlanType);
  }

  applyPlanRules();
}

function syncProviderDetails() {
  const provider = selectedProvider();
  setValue("providerNpi", provider?.npi || "");
}

function buildRisks() {
  const risks = [];
  const insurance = selectedInsurance();
  const carrierName = insurance?.carrierName || "";
  const sourceAuthRequired = insurance ? normalizeBool(insurance.authRequired) : "";
  const sourceReferralRequired = insurance ? normalizeBool(insurance.referralRequired) : "";
  const authRequired = value("authRequired");
  const authStatus = value("authStatus");
  const referralRequired = value("referralRequired");

  if (!value("patientName")) {
    risks.push({ severity: "hold", action: "Enter the patient name.", text: "Patient name is required for the case." });
  }
  if (!value("dos")) {
    risks.push({ severity: "hold", action: "Enter the date of service.", text: "DOS is required before the case can be added." });
  }
  if (value("demographicsMatch") === "No") {
    risks.push({ severity: "hold", action: "Correct patient demographics in the EHR.", text: "Demographic mismatch may lead to patient-not-found denials." });
  }
  if (!insurance) {
    risks.push({ severity: "hold", action: "Select an insurance from the master list.", text: "Insurance selection is required for payer routing." });
  }
  if (!value("payerId")) {
    risks.push({ severity: "hold", action: "Review payer ID before claim routing.", text: "Payer ID is missing." });
  }
  if (value("payerVerified") === "No") {
    risks.push({ severity: "hold", action: "Cross-check payer ID with the portal or card.", text: "Incorrect payer routing can cause front-end rejection." });
  }
  if (value("insuranceActive") === "No") {
    risks.push({ severity: "escalated", action: "Inform front desk and patient immediately.", text: "Coverage is inactive for DOS." });
  }
  if (value("insuranceActive") === "Unknown") {
    risks.push({ severity: "hold", action: "Verify active coverage through the portal.", text: "Coverage status is still unclear." });
  }
  if (value("benefitsVerified") === "No") {
    risks.push({ severity: "hold", action: "Verify financial responsibility before DOS.", text: "Benefits are not fully documented." });
  }
  if (authRequired === "Yes" && authStatus !== "Approved") {
    risks.push({ severity: "escalated", action: "Escalate to the authorization team.", text: `Authorization is required and current status is "${authStatus || "Unknown"}".` });
  }
  if (insurance && authRequired !== sourceAuthRequired) {
    risks.push({ severity: "hold", action: "Reset auth required to match the insurance master.", text: "Auth required does not match the value from the updated payer sheet." });
  }
  if (insurance && referralRequired !== sourceReferralRequired) {
    risks.push({ severity: "hold", action: "Reset referral required to match the insurance master.", text: "Referral required does not match the value from the updated payer sheet." });
  }
  if (carrierName.toUpperCase().includes("AETNA SELECT") && authRequired !== "Yes") {
    risks.push({ severity: "hold", action: "Confirm AETNA SELECT auth requirements against the updated payer sheet.", text: "AETNA SELECT should be reviewed carefully because it is a high-risk routing payer." });
  }
  if (value("cobVerified") === "No" || value("cobVerified") === "Unknown") {
    risks.push({ severity: "hold", action: "Resolve COB before completing the account.", text: "Unresolved COB can misroute claims or produce zero-payment EOBs." });
  }
  if (value("networkStatus") === "Out") {
    risks.push({ severity: "escalated", action: "Move the patient to an in-network option.", text: "Provider or facility is out of network." });
  }
  if (value("networkStatus") === "Unknown") {
    risks.push({ severity: "hold", action: "Verify network status with the payer.", text: "Network status has not been verified." });
  }
  if (value("effectiveDate") && value("terminationDate") && value("terminationDate") < value("effectiveDate")) {
    risks.push({ severity: "hold", action: "Fix the policy date range.", text: "Termination date is earlier than effective date." });
  }

  return risks;
}

function resolveStatus(risks) {
  if (risks.some((risk) => risk.severity === "escalated")) return "ESCALATED";
  if (risks.length) return "HOLD";
  return "READY";
}

function renderRisks(risks) {
  riskList.innerHTML = "";
  if (!risks.length) {
    const li = document.createElement("li");
    li.textContent = "No active leakage risks detected. Case can proceed to final documentation.";
    riskList.appendChild(li);
    return;
  }
  risks.forEach((risk) => {
    const li = document.createElement("li");
    li.textContent = `${risk.text} Action: ${risk.action}`;
    riskList.appendChild(li);
  });
}

function buildNote(status, risks) {
  const insurance = selectedInsurance();
  const provider = selectedProvider();
  const payerAddress = [value("streetAddress"), value("city"), value("state"), value("zipCode")].filter(Boolean).join(", ");
  const checker = checkerNameInput.value.trim() || "N/A";

  const lines = [
    `Checker: ${checker} | DOS: ${prettyDate(value("dos"))} | PT: ${value("patientName") || "Patient"} | MRN: ${value("mrn") || "N/A"}`,
    `Provider: ${provider?.name || "N/A"} | NPI: ${value("providerNpi") || "N/A"} | Visit Type: ${value("visitType") || "N/A"}`,
    `Insurance: ${insurance?.carrierName || "N/A"} | Plan Type: ${value("planType") || "N/A"} | Payer ID: ${value("payerId") || "N/A"} | Member ID: ${value("memberId") || "N/A"}`,
    `Payer Address: ${payerAddress || "N/A"}`,
    `Eligibility: ${value("insuranceActive") || "Unknown"} | Effective: ${prettyDate(value("effectiveDate"))} | Term: ${prettyDate(value("terminationDate"))}`,
    `Demographics Match: ${value("demographicsMatch") || "Unknown"} | Payer ID Verified: ${value("payerVerified") || "Unknown"} | Benefits Verified: ${value("benefitsVerified") || "Unknown"}`,
    `Copay: ${value("copay") || "N/A"} | Deductible Remaining: ${value("deductibleRemaining") || "N/A"} | Coinsurance: ${value("coinsurance") || "N/A"}`,
    `Out Of Pocket Total: ${value("outOfPocketTotal") || "N/A"} | Out Of Pocket Remaining: ${value("outOfPocketRemaining") || "N/A"}`,
    `Authorization Required: ${value("authRequired") || "Unknown"} | Auth Status: ${value("authStatus") || "Unknown"} | Auth Number: ${value("authNumber") || "N/A"} | Referral Required: ${value("referralRequired") || "Unknown"}`,
    `COB Status: ${value("cobVerified") || "Unknown"} | Network Status: ${value("networkStatus") || "Unknown"}`,
    `Final Status: ${status}`,
    `Leakage Risks: ${risks.length ? risks.map((risk) => risk.text).join(" ; ") : "No active leakage risks detected."}`
  ];

  if (value("additionalNotes")) lines.push(`Additional Notes: ${value("additionalNotes")}`);
  lines.push("Chart Note Summary: Eligibility reviewed and documented per pre-DOS verification workflow.");
  return lines.join("\n");
}

function updateStatusUI(status, risks) {
  finalStatus.textContent = status;
  riskCount.textContent = String(risks.length);
  primaryAction.textContent = risks.length ? risks[0].action : "Document note and mark ready";
  checkerDisplay.textContent = checkerNameInput.value.trim() || "Not set";
  statusBanner.classList.remove("hold", "escalated");
  if (status === "HOLD") statusBanner.classList.add("hold");
  if (status === "ESCALATED") statusBanner.classList.add("escalated");
}

function analyzeCurrentCase() {
  const risks = buildRisks();
  const status = resolveStatus(risks);
  renderRisks(risks);
  updateStatusUI(status, risks);
  generatedNote.value = buildNote(status, risks);
  return { risks, status, note: generatedNote.value };
}

function getCurrentCasePayload() {
  const insurance = selectedInsurance();
  const provider = selectedProvider();
  const analysis = analyzeCurrentCase();

  return {
    checker: checkerNameInput.value.trim(),
    reportDate: reportDateInput.value,
    dos: value("dos"),
    patientName: value("patientName"),
    mrn: value("mrn"),
    provider: provider?.name || "",
    providerNpi: value("providerNpi"),
    visitType: value("visitType"),
    insurance: insurance?.carrierName || "",
    planType: value("planType"),
    payerId: value("payerId"),
    memberId: value("memberId"),
    address: value("streetAddress"),
    city: value("city"),
    state: value("state"),
    zipCode: value("zipCode"),
    effectiveDate: value("effectiveDate"),
    terminationDate: value("terminationDate"),
    demographicsMatch: value("demographicsMatch"),
    insuranceActive: value("insuranceActive"),
    payerVerified: value("payerVerified"),
    benefitsVerified: value("benefitsVerified"),
    copay: value("copay"),
    deductibleRemaining: value("deductibleRemaining"),
    coinsurance: value("coinsurance"),
    outOfPocketTotal: value("outOfPocketTotal"),
    outOfPocketRemaining: value("outOfPocketRemaining"),
    authRequired: value("authRequired"),
    authStatus: value("authStatus"),
    authNumber: value("authNumber"),
    referralRequired: value("referralRequired"),
    cobVerified: value("cobVerified"),
    networkStatus: value("networkStatus"),
    additionalNotes: value("additionalNotes"),
    status: analysis.status,
    note: analysis.note
  };
}

function persistBatch() {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(batchCases));
}

function loadBatch() {
  try {
    batchCases = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    batchCases = [];
  }
}

function renderBatch() {
  batchTableBody.innerHTML = "";
  batchCount.textContent = String(batchCases.length);
  checkerDisplay.textContent = checkerNameInput.value.trim() || "Not set";

  if (!batchCases.length) {
    batchTableBody.innerHTML = '<tr><td colspan="11" class="empty-state">No patients added yet.</td></tr>';
    return;
  }

  batchCases.forEach((item) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${item.checker || "N/A"}</td>
      <td>${prettyDate(item.dos)}</td>
      <td>${item.patientName || "N/A"}</td>
      <td>${item.mrn || "N/A"}</td>
      <td>${item.provider || "N/A"}</td>
      <td>${item.insurance || "N/A"}</td>
      <td>${item.planType || "N/A"}</td>
      <td>${item.payerId || "N/A"}</td>
      <td>${item.authRequired || "N/A"}</td>
      <td>${item.referralRequired || "N/A"}</td>
      <td>${item.status}</td>
    `;
    batchTableBody.appendChild(row);
  });
}

function clearPatientForm() {
  form.reset();
  ["payerId", "providerNpi", "streetAddress", "city", "state", "zipCode"].forEach((id) => setValue(id, ""));
  riskList.innerHTML = "<li>No risks analyzed yet.</li>";
  generatedNote.value = "";
  finalStatus.textContent = "Awaiting Review";
  riskCount.textContent = "0";
  primaryAction.textContent = "Complete review";
  statusBanner.classList.remove("hold", "escalated");
  checkerDisplay.textContent = checkerNameInput.value.trim() || "Not set";
  if (isDosLocked()) {
    setValue("dos", lockedDosInput.value);
  }
}

function addCurrentCase() {
  if (!checkerNameInput.value.trim()) {
    window.alert("Please enter the checker name before adding patients to the batch.");
    checkerNameInput.focus();
    return;
  }

  if (isDosLocked() && !lockedDosInput.value) {
    window.alert("Please set the locked DOS before adding patients to the batch.");
    lockedDosInput.focus();
    return;
  }

  const payload = getCurrentCasePayload();
  batchCases.push(payload);
  persistBatch();
  renderBatch();
  clearPatientForm();
}

function exportBatchToPdf() {
  if (!batchCases.length) {
    window.alert("Add at least one patient before exporting the PDF report.");
    return;
  }

  const reportWindow = window.open("", "_blank", "width=1200,height=900");
  const insuranceSummaryMap = new Map();
  batchCases.forEach((item) => {
    const key = item.insurance || "Unspecified Insurance";
    if (!insuranceSummaryMap.has(key)) {
      insuranceSummaryMap.set(key, { total: 0, ready: 0, hold: 0, escalated: 0 });
    }
    const bucket = insuranceSummaryMap.get(key);
    bucket.total += 1;
    if (item.status === "READY") bucket.ready += 1;
    if (item.status === "HOLD") bucket.hold += 1;
    if (item.status === "ESCALATED") bucket.escalated += 1;
  });

  const insuranceSummaryRows = [...insuranceSummaryMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([insurance, counts]) => `
      <tr>
        <td>${insurance}</td>
        <td>${counts.total}</td>
        <td>${counts.ready}</td>
        <td>${counts.hold}</td>
        <td>${counts.escalated}</td>
      </tr>
    `)
    .join("");

  const reportRows = batchCases.map((item) => `
    <tr>
      <td>${item.checker || ""}</td>
      <td>${prettyDate(item.dos)}</td>
      <td>${item.patientName || ""}</td>
      <td>${item.mrn || ""}</td>
      <td>${item.provider || ""}</td>
      <td>${item.insurance || ""}</td>
      <td>${item.planType || ""}</td>
      <td>${item.payerId || ""}</td>
      <td>${item.authRequired || ""}</td>
      <td>${item.referralRequired || ""}</td>
      <td>${item.status || ""}</td>
    </tr>
    <tr class="note-row">
      <td colspan="11"><strong>Note:</strong><br>${item.note.replace(/\n/g, "<br>")}</td>
    </tr>
  `).join("");

  reportWindow.document.write(`
    <html>
    <head>
      <title>Eligibility Batch Report</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 24px; color: #1f2a37; }
        h1 { margin-bottom: 8px; }
        p { margin: 4px 0 12px; color: #4b5563; }
        table { width: 100%; border-collapse: collapse; margin-top: 18px; }
        th, td { border: 1px solid #cbd5e1; padding: 8px; vertical-align: top; font-size: 12px; text-align: left; }
        th { background: #e7f3f0; }
        .note-row td { background: #faf7f2; }
        @media print { button { display: none; } }
      </style>
    </head>
    <body>
      <h1>Eligibility Batch Report</h1>
      <p>Checker: ${checkerNameInput.value.trim() || "N/A"} | Report Date: ${prettyDate(reportDateInput.value)}</p>
      <h2>Batch Insights</h2>
      <p>Total Patients: ${batchCases.length} | Unique Insurances: ${insuranceSummaryMap.size}</p>
      <table>
        <thead>
          <tr>
            <th>Insurance</th>
            <th>Total Checked</th>
            <th>READY</th>
            <th>HOLD</th>
            <th>ESCALATED</th>
          </tr>
        </thead>
        <tbody>${insuranceSummaryRows}</tbody>
      </table>
      <h2>Patient Detail</h2>
      <table>
        <thead>
          <tr>
            <th>Checker</th>
            <th>DOS</th>
            <th>Patient</th>
            <th>MRN</th>
            <th>Provider</th>
            <th>Insurance</th>
            <th>Plan</th>
            <th>Payer ID</th>
            <th>Auth</th>
            <th>Referral</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${reportRows}</tbody>
      </table>
      <script>window.onload = () => window.print();<\/script>
    </body>
    </html>
  `);
  reportWindow.document.close();
}

checkerNameInput.addEventListener("input", () => {
  checkerDisplay.textContent = checkerNameInput.value.trim() || "Not set";
});
lockDosModeInput.addEventListener("change", syncDosLock);
lockedDosInput.addEventListener("change", () => {
  if (isDosLocked()) {
    setValue("dos", lockedDosInput.value);
  }
});
insuranceSelect.addEventListener("change", syncInsuranceDetails);
providerSelect.addEventListener("change", syncProviderDetails);
planTypeSelect.addEventListener("change", applyPlanRules);
document.getElementById("authRequired").addEventListener("change", () => {
  if (value("authRequired") === "No") setValue("authStatus", "Not Required");
});
analyzeBtn.addEventListener("click", analyzeCurrentCase);
addCaseBtn.addEventListener("click", addCurrentCase);
copyBtn.addEventListener("click", async () => {
  if (!generatedNote.value) analyzeCurrentCase();
  try {
    await navigator.clipboard.writeText(generatedNote.value);
  } catch {
    generatedNote.focus();
    generatedNote.select();
    document.execCommand("copy");
  }
  copyBtn.textContent = "Copied";
  window.setTimeout(() => { copyBtn.textContent = "Copy Note"; }, 1400);
});
exportPdfBtn.addEventListener("click", exportBatchToPdf);
clearBatchBtn.addEventListener("click", () => {
  batchCases = [];
  persistBatch();
  renderBatch();
});
form.addEventListener("reset", () => {
  window.setTimeout(clearPatientForm, 0);
});

function init() {
  populateDropdowns();
  loadBatch();
  renderBatch();
  reportDateInput.value = new Date().toISOString().slice(0, 10);
  syncDosLock();
}

init();
