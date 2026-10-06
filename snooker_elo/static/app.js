const state = {
  selectedPlayer: null,
  compare: [],
  seeded: false,
  metadataLoaded: false,
  dynastyPlayer: "Stephen Hendry",
  dynastyBaseline: "gap_to_top10_field",
  dynastyCollection: null,
  peaks: [],
  activePeakIndex: 0,
  peakHitAreas: [],
};

const dateInput = document.querySelector("#date");
const ratingInput = document.querySelector("#rating");
const startYearInput = document.querySelector("#start-year");
const endYearInput = document.querySelector("#end-year");
const leaderboard = document.querySelector("#leaderboard");
const statusText = document.querySelector("#status");
const statMatches = document.querySelector("#stat-matches");
const statPlayers = document.querySelector("#stat-players");
const statRange = document.querySelector("#stat-range");
const metaText = document.querySelector("#meta");
const eraRange = document.querySelector("#era-range");
const playersEl = document.querySelector("#players");
const detailEl = document.querySelector("#player-detail");
const compareListEl = document.querySelector("#compare-list");
const peaksEl = document.querySelector("#peaks");
const peakChart = document.querySelector("#peak-chart");
const peakDetailEl = document.querySelector("#peak-detail");
const historyChart = document.querySelector("#history-chart");
const compareChart = document.querySelector("#compare-chart");
const dynastyLoadingEl = document.querySelector("#dynasty-loading");
const dynastySelectorEl = document.querySelector("#dynasty-selector");
const dynastyPlayerEl = document.querySelector("#dynasty-player");
const dynastyPhotoEl = document.querySelector(".dynasty-photo");
const dynastyImageCreditEl = document.querySelector("#dynasty-image-credit");
const dynastyPeriodEl = document.querySelector("#dynasty-period");
const dynastyTitleEl = document.querySelector("#dynasty-title");
const dynastyCopyEl = document.querySelector("#dynasty-copy");
const dynastyCoverageEl = document.querySelector("#dynasty-coverage");
const dynastyGapEl = document.querySelector("#dynasty-gap");
const dynastyGapLabelEl = document.querySelector("#dynasty-gap-label");
const dynastyBaselineEl = document.querySelector("#dynasty-baseline");
const dynastyMainChart = document.querySelector("#dynasty-main-chart");
const palette = ["#0d5b45", "#315f96", "#946b34", "#765096", "#9f3b34", "#5d6660", "#287c74", "#8a5a44"];
const defaultLegends = [
  "Ronnie O'Sullivan",
  "Stephen Hendry",
  "Steve Davis",
  "John Higgins",
  "Mark Selby",
  "Judd Trump",
];
const baselineLabels = {
  gap_to_second: "#2 player",
  gap_to_top5_field: "Top 5 field average",
  gap_to_top10_field: "Top 10 field average",
};
const baselineSeries = {
  gap_to_second: "second_elo",
  gap_to_top5_field: "top5_field_average",
  gap_to_top10_field: "top10_field_average",
};
const dynastyImages = {
  "Steve Davis": {
    src: "/assets/steve-davis.jpg",
    credit: "Photo: seantruscott / Public domain",
  },
  "Stephen Hendry": {
    src: "/assets/stephen-hendry.jpg",
    credit: "Photo: Bill da Flute / CC BY-SA 3.0",
  },
  "Ronnie O'Sullivan": {
    src: "/assets/ronnie-osullivan.jpg",
    credit: "Photo: Eurosport / Tom Shaw / CC BY 3.0",
  },
  "Judd Trump": {
    src: "/assets/judd-trump.jpg",
    credit: "Photo: Martin Rulsch / CC BY-SA 4.0",
  },
};

dateInput.value = new Date().toISOString().slice(0, 10);
preloadDynastyImages();

document.querySelector("#controls").addEventListener("submit", (event) => {
  event.preventDefault();
  refresh();
});

document.querySelector("#player-search").addEventListener("submit", async (event) => {
  event.preventDefault();
  await searchPlayers(document.querySelector("#search").value);
});

document.querySelectorAll(".preset-player").forEach((button) => {
  button.addEventListener("click", async () => {
    await addPlayerByName(button.dataset.name);
  });
});

dynastyBaselineEl?.querySelectorAll("button").forEach((button) => {
  button.addEventListener("click", () => {
    state.dynastyBaseline = button.dataset.baseline;
    renderDynasty();
  });
});

window.addEventListener("resize", () => {
  renderCompare();
  renderDynasty();
  renderPeaks();
  if (state.selectedPlayer) {
    loadPlayer(state.selectedPlayer.player_id, state.selectedPlayer.player_name);
  }
});

peakChart?.addEventListener("pointermove", handlePeakChartPointer);
peakChart?.addEventListener("pointerleave", () => {
  peakChart.style.cursor = "default";
});
peakChart?.addEventListener("click", handlePeakChartPointer);

async function refresh() {
  await loadMetadata();
  renderEloExplainer();
  await Promise.all([loadRankings(), loadDynasties(), loadPeaks()]);
  if (!state.seeded) {
    await seedDefaultLegends();
  }
  await renderCompare();
  if (state.selectedPlayer) {
    await loadPlayer(state.selectedPlayer.player_id, state.selectedPlayer.player_name);
  }
}

async function loadMetadata() {
  const data = await api("/api/metadata");
  if (data.error) {
    statusText.textContent = data.error;
    statusText.className = "error";
    return;
  }
  statusText.className = "";
  statusText.textContent = `${Number(data.usable_matches ?? 0).toLocaleString()} usable matches`;
  statMatches.textContent = Number(data.usable_matches ?? 0).toLocaleString();
  statPlayers.textContent = Number(data.unique_players ?? 0).toLocaleString();
  statRange.textContent = `${trimDate(data.earliest_match).slice(0, 4)}-${trimDate(data.latest_match).slice(0, 4)}`;
  metaText.textContent = `${trimDate(data.earliest_match)} to ${trimDate(data.latest_match)}`;
  if (!startYearInput.value) {
    startYearInput.value = trimDate(data.earliest_match).slice(0, 4);
  }
  if (!endYearInput.value) {
    endYearInput.value = trimDate(data.latest_match).slice(0, 4);
  }
  updateRangeText();
  if (!state.metadataLoaded && data.latest_match) {
    dateInput.value = trimDate(data.latest_match);
  }
  state.metadataLoaded = true;
}

async function loadRankings() {
  const data = await api(`/api/rankings?date=${dateInput.value}&rating=${ratingInput.value}&limit=25`);
  leaderboard.innerHTML = "";
  if (data.error) {
    leaderboard.innerHTML = `<tr><td colspan="5" class="error">${escapeHtml(data.error)}</td></tr>`;
    drawEmptyChart(compareChart, "No generated database");
    drawEmptyChart(historyChart, "No generated database");
    return;
  }
  if (!data.length) {
    leaderboard.innerHTML = `<tr><td colspan="5" class="empty">No players</td></tr>`;
    return;
  }

  leaderboard.innerHTML = data.map(leaderboardRow).join("");
  leaderboard.querySelectorAll("tr").forEach((row) => {
    row.addEventListener("click", async () => {
      addCompare(row.dataset.id, row.dataset.name);
      await loadPlayer(row.dataset.id, row.dataset.name);
    });
  });

  if (!state.selectedPlayer && data[0]) {
    await loadPlayer(data[0].player_id, data[0].player_name);
  }
}

function leaderboardRow(row) {
  return `
    <tr data-id="${escapeHtml(row.player_id)}" data-name="${escapeHtml(row.player_name)}">
      <td>${row.rank}</td>
      <td>${escapeHtml(row.player_name)}</td>
      <td>${formatRating(row.match_elo)}</td>
      <td>${formatRating(row.frame_elo)}</td>
      <td>${row.matches_played}</td>
    </tr>
  `;
}

async function searchPlayers(query) {
  const data = await api(`/api/players?search=${encodeURIComponent(query)}&limit=12`);
  if (data.error) {
    playersEl.innerHTML = `<div class="error">${escapeHtml(data.error)}</div>`;
    return;
  }
  playersEl.innerHTML =
    data
      .map(
        (player) => `
          <div class="player-row">
            <div>
              <strong>${escapeHtml(player.player_name)}</strong>
              <span>${player.matches_played} matches</span>
            </div>
            <button type="button" data-id="${escapeHtml(player.player_id)}" data-name="${escapeHtml(player.player_name)}">
              Add
            </button>
          </div>
        `,
      )
      .join("") || `<div class="empty">No matches</div>`;

  playersEl.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", async () => {
      addCompare(button.dataset.id, button.dataset.name);
      await loadPlayer(button.dataset.id, button.dataset.name);
    });
  });
}

async function addPlayerByName(name) {
  const matches = await api(`/api/players?search=${encodeURIComponent(name)}&limit=8`);
  if (!Array.isArray(matches)) {
    return;
  }
  const exact = matches.find((player) => player.player_name.toLowerCase() === name.toLowerCase());
  const player = exact || matches[0];
  if (player) {
    addCompare(player.player_id, player.player_name);
    await loadPlayer(player.player_id, player.player_name);
  }
}

async function loadPlayer(playerId, playerName) {
  state.selectedPlayer = { player_id: playerId, player_name: playerName };
  const data = await api(
    `/api/player?id=${encodeURIComponent(playerId)}&date=${dateInput.value}&rating=${ratingInput.value}`,
  );
  if (data.error) {
    detailEl.innerHTML = `<div class="error">${escapeHtml(data.error)}</div>`;
    drawEmptyChart(historyChart, "No player data");
    return;
  }
  if (!data.rating) {
    detailEl.innerHTML = `<div class="empty">No rating at this date</div>`;
    drawEmptyChart(historyChart, "No rating at this date");
    return;
  }

  detailEl.innerHTML = `
    <div class="metric-grid">
      <div class="metric-row">
        <strong>${escapeHtml(playerName)}</strong>
        <span>Rank ${data.rank?.rank ?? "-"}</span>
      </div>
      <div class="metric-row">
        <strong>${data.rating?.matches_played ?? "-"}</strong>
        <span>Matches played</span>
      </div>
      <div class="metric-row">
        <strong>${formatRating(data.rating?.match_elo)}</strong>
        <span>Match Elo</span>
      </div>
      <div class="metric-row">
        <strong>${formatRating(data.rating?.frame_elo)}</strong>
        <span>Frame Elo</span>
      </div>
      <div class="metric-row">
        <strong>${formatRating(selectedPeak(data.peak_rating))}</strong>
        <span>Peak ${ratingInput.value} Elo</span>
      </div>
      <div class="metric-row">
        <strong>${data.peak_rank?.rank ?? "-"}</strong>
        <span>Peak rank</span>
      </div>
    </div>
  `;

  drawSeriesChart(historyChart, [
    {
      label: playerName,
      color: palette[0],
      points: filterPoints(data.history.map((event) => eventPoint(event))),
    },
  ]);
}

function addCompare(playerId, playerName, redraw = true) {
  if (!state.compare.some((player) => player.player_id === playerId)) {
    state.compare.push({ player_id: playerId, player_name: playerName });
  }
  renderChips();
  if (redraw) {
    renderCompare();
  }
}

function removeCompare(playerId) {
  state.compare = state.compare.filter((player) => player.player_id !== playerId);
  renderChips();
  renderCompare();
}

function renderChips() {
  compareListEl.innerHTML =
    state.compare
      .map(
        (player, index) => `
          <span class="chip" style="border-color:${palette[index % palette.length]}">
            ${escapeHtml(player.player_name)}
            <button type="button" data-id="${escapeHtml(player.player_id)}">x</button>
          </span>
        `,
      )
      .join("") || `<div class="empty">No players selected</div>`;
  compareListEl.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => removeCompare(button.dataset.id));
  });
}

async function renderCompare() {
  renderChips();
  if (!state.compare.length) {
    drawEmptyChart(compareChart, "No players selected");
    return;
  }

  const ids = state.compare.map((player) => encodeURIComponent(player.player_id)).join(",");
  const data = await api(`/api/compare?ids=${ids}&start=${startYearInput.value}-01-01&end=${endYearInput.value}-12-31`);
  if (data.error) {
    drawEmptyChart(compareChart, "No comparison data");
    return;
  }

  drawSeriesChart(
    compareChart,
    state.compare.map((player, index) => ({
      label: player.player_name,
      color: palette[index % palette.length],
      points: filterPoints((data[player.player_id] || []).map((event) => eventPoint(event))),
    })),
  );
}

async function loadDynasties() {
  updateRangeText();
  dynastyLoadingEl.hidden = false;
  const data = await api(`/api/dynasties?rating=${ratingInput.value}`);
  if (data.error) {
    drawEmptyChart(dynastyMainChart, "No dynasty data");
    return;
  }
  state.dynastyCollection = data;
  if (!findDynasty(state.dynastyPlayer)) {
    state.dynastyPlayer = data.dynasties?.[0]?.player_name || state.dynastyPlayer;
  }
  dynastyLoadingEl.hidden = true;
  renderDynasty();
}

function selectDynasty(playerName) {
  const started = performance.now();
  state.dynastyPlayer = playerName;
  renderDynasty();
  window.__lastDynastySwitchMs = performance.now() - started;
}

function renderDynasty() {
  const data = state.dynastyCollection;
  const selected = findDynasty(state.dynastyPlayer);
  if (!data?.dynasties?.length || !selected) {
    drawEmptyChart(dynastyMainChart, "Loading");
    return;
  }

  const points = selected.points || [];
  const peak = selected.peak_snapshot;
  const baseline = state.dynastyBaseline;
  const baselineLabel = baselineLabels[baseline] || "field average";
  const peakGap = peak?.[baseline];

  dynastyBaselineEl?.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("active", button.dataset.baseline === baseline);
  });
  renderDynastyImage(selected.player_name);
  dynastyPlayerEl.textContent = selected.player_name;
  dynastyPeriodEl.textContent = formatDominancePeriod(selected.period);
  dynastyTitleEl.textContent = `The ${surname(selected.player_name)} Years`;
  dynastyCopyEl.innerHTML = peakGap == null
    ? `${escapeHtml(selected.player_name)} reached Elo No.1, but this era has limited field data.`
    : `At his strongest snapshot, ${escapeHtml(selected.player_name)} stood <strong>${signed(peakGap)} Elo</strong> above the ${escapeHtml(baselineLabel)}.`;
  dynastyCoverageEl.textContent = coverageSentence(peak);
  dynastyGapEl.textContent = peakGap == null ? "Limited data" : `${signed(peakGap)} Elo`;
  dynastyGapLabelEl.textContent = `Peak gap above the ${baselineLabel}`;

  renderDynastySelectors(data.dynasties || []);
  drawDynastyFieldChart(dynastyMainChart, points);
}

function renderDynastyImage(playerName) {
  const image = dynastyImages[playerName];
  if (!image) {
    dynastyPhotoEl.style.removeProperty("--dynasty-image");
    dynastyImageCreditEl.textContent = "Wikimedia Commons";
    return;
  }
  dynastyPhotoEl.style.setProperty("--dynasty-image", `url("${image.src}")`);
  dynastyImageCreditEl.textContent = image.credit;
}

function preloadDynastyImages() {
  Object.values(dynastyImages).forEach((image) => {
    const preload = new Image();
    preload.src = image.src;
  });
}

async function loadPeaks() {
  const data = await api(`/api/peaks?rating=${ratingInput.value}&limit=12`);
  if (data.error) {
    peaksEl.innerHTML = `<div class="error">${escapeHtml(data.error)}</div>`;
    peakDetailEl.innerHTML = "";
    drawEmptyChart(peakChart, "No peak data");
    return;
  }
  state.peaks = Array.isArray(data) ? data : [];
  state.activePeakIndex = Math.min(state.activePeakIndex, Math.max(0, state.peaks.length - 1));
  renderPeaks();
}

function renderPeaks() {
  if (!peaksEl || !peakChart || !peakDetailEl) {
    return;
  }
  if (!state.peaks.length) {
    peaksEl.innerHTML = `<div class="empty">No peak data</div>`;
    peakDetailEl.innerHTML = "";
    drawEmptyChart(peakChart, "No peak data");
    return;
  }

  peaksEl.innerHTML = state.peaks.map(peakChip).join("");
  peaksEl.querySelectorAll(".peak-card").forEach((card) => {
    const index = Number(card.dataset.index);
    card.addEventListener("pointerenter", () => selectPeak(index));
    card.addEventListener("focus", () => selectPeak(index));
    card.addEventListener("click", () => selectPeak(index));
  });
  renderPeakDetail();
  drawPeakChart(peakChart, state.peaks, state.activePeakIndex);
}

function peakChip(row, index) {
  return `
    <button type="button" class="peak-card${index === state.activePeakIndex ? " active" : ""}" data-index="${index}">
      <span class="peak-rank">#${index + 1}</span>
      <b>${escapeHtml(row.player_name)}</b>
      <strong>${formatRating(Number(row.rating))}</strong>
    </button>
  `;
}

function selectPeak(index) {
  if (!Number.isInteger(index) || index < 0 || index >= state.peaks.length || index === state.activePeakIndex) {
    return;
  }
  state.activePeakIndex = index;
  renderPeaks();
}

function renderPeakDetail() {
  const row = state.peaks[state.activePeakIndex];
  if (!row) {
    peakDetailEl.innerHTML = "";
    return;
  }
  peakDetailEl.innerHTML = `
    <span>Peak ${state.activePeakIndex + 1}</span>
    <strong>${formatRating(Number(row.rating))}</strong>
    <h3>${escapeHtml(row.player_name)}</h3>
    <p>${ratingInput.value === "frame" ? "Frame Elo" : "Match Elo"} peak on ${trimDate(row.date)}</p>
  `;
}

function handlePeakChartPointer(event) {
  const rect = peakChart.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const hit = state.peakHitAreas.find((area) => Math.hypot(area.x - x, area.y - y) <= area.radius);
  peakChart.style.cursor = hit ? "pointer" : "default";
  if (hit) {
    selectPeak(hit.index);
  }
}

function renderDynastySelectors(dynasties) {
  dynastySelectorEl.innerHTML = dynasties
    .map((profile) => dynastySelectorButton(profile, "dynasty-name"))
    .join("");
  document.querySelectorAll("[data-dynasty-name]").forEach((button) => {
    button.addEventListener("click", () => selectDynasty(button.dataset.dynastyName));
  });
}

function dynastySelectorButton(profile, className) {
  const active = profile.player_name === state.dynastyPlayer;
  return `
    <button type="button" class="${className}${active ? " active" : ""}" data-dynasty-name="${escapeHtml(profile.player_name)}">
      <span>${splitName(profile.player_name)}</span>
      <strong>${profile.period ? periodYears(profile.period) : "No sustained reign"}</strong>
    </button>
  `;
}

function findDynasty(playerName) {
  return state.dynastyCollection?.dynasties?.find((profile) => profile.player_name === playerName) || null;
}

async function seedDefaultLegends() {
  const selected = [];
  for (const name of defaultLegends) {
    const matches = await api(`/api/players?search=${encodeURIComponent(name)}&limit=8`);
    if (!Array.isArray(matches)) {
      continue;
    }
    const exact = matches.find((player) => player.player_name.toLowerCase() === name.toLowerCase());
    const player = exact || matches[0];
    if (player && !selected.some((item) => item.player_id === player.player_id)) {
      selected.push(player);
    }
  }
  selected.forEach((player) => addCompare(player.player_id, player.player_name, false));
  state.seeded = true;
}

function renderEloExplainer() {
  const matchDelta = 24 * (1 - 0.5);
  const tightFrameDelta = 4 * (10 - 19 * 0.5);
  const dominantFrameDelta = 4 * (10 - 10 * 0.5);
  document.querySelector("#match-tight").textContent = signed(matchDelta);
  document.querySelector("#match-dom").textContent = signed(matchDelta);
  document.querySelector("#frame-tight").textContent = signed(tightFrameDelta);
  document.querySelector("#frame-dom").textContent = signed(dominantFrameDelta);
}

function updateRangeText() {
  eraRange.textContent = `${startYearInput.value || "1900"} to ${endYearInput.value || "present"}`;
}

async function api(path) {
  const response = await fetch(path);
  return response.json();
}

function eventPoint(event) {
  return {
    x: new Date(event.played_at).getTime(),
    y: selectedEventRating(event),
  };
}

function selectedEventRating(event) {
  return ratingInput.value === "frame" ? event.frame_elo_after : event.match_elo_after;
}

function selectedPeak(rating) {
  if (!rating) {
    return null;
  }
  return ratingInput.value === "frame" ? rating.frame_elo : rating.match_elo;
}

function filterPoints(points) {
  const start = Date.parse(`${startYearInput.value || "1900"}-01-01`);
  const end = Date.parse(`${endYearInput.value || "2100"}-12-31`);
  return points.filter((point) => point.x >= start && point.x <= end);
}

function formatRating(value) {
  return Number.isFinite(value) ? Math.round(value).toString() : "-";
}

function formatDominancePeriod(period) {
  if (!period?.start || !period?.end) {
    return "No sustained monthly Elo No.1 reign found";
  }
  return `${formatMonthYear(period.start)} - ${formatMonthYear(period.end)} / ${period.label || formatMonths(period.months_at_number_one)} at Elo No.1`;
}

function periodYears(period) {
  if (!period?.start || !period?.end) {
    return "No sustained reign";
  }
  return `${new Date(period.start).getFullYear()}-${new Date(period.end).getFullYear()}`;
}

function formatMonthYear(value) {
  if (!value) {
    return "";
  }
  return new Intl.DateTimeFormat("en", { month: "short", year: "numeric" }).format(new Date(value));
}

function formatMonths(months) {
  const total = Number(months || 0);
  if (!total) {
    return "0 months";
  }
  const years = Math.floor(total / 12);
  const rest = total % 12;
  if (!years) {
    return `${rest} month${rest === 1 ? "" : "s"}`;
  }
  if (!rest) {
    return `${years} year${years === 1 ? "" : "s"}`;
  }
  return `${years} year${years === 1 ? "" : "s"}, ${rest} month${rest === 1 ? "" : "s"}`;
}

function coverageSentence(peak) {
  if (!peak) {
    return "End-of-month Elo snapshots. Limited historical field data.";
  }
  if (peak.coverage !== "full_top10_field") {
    return `Limited historical field data: ${Number(peak.active_players || 0).toLocaleString()} active rated players at the selected snapshot.`;
  }
  return `End-of-month Elo snapshot with ${Number(peak.active_players || 0).toLocaleString()} active rated players.`;
}

function surname(name) {
  const parts = String(name || "").trim().split(/\s+/);
  return parts[parts.length - 1]?.replace("O'Sullivan", "O'Sullivan") || "Dynasty";
}

function splitName(name) {
  const parts = String(name || "").trim().split(/\s+/);
  if (parts.length < 2) {
    return escapeHtml(name);
  }
  return `${escapeHtml(parts.slice(0, -1).join(" "))}<br>${escapeHtml(parts.at(-1))}`;
}

function signed(value) {
  return `${value >= 0 ? "+" : ""}${Math.round(value)}`;
}

function trimDate(value) {
  return value ? String(value).slice(0, 10) : "";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function drawEmptyChart(canvas, label) {
  const ctx = prepareCanvas(canvas);
  ctx.fillStyle = "#7a817b";
  ctx.font = "14px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(label, canvas.width / 2, canvas.height / 2);
}

function drawPeakChart(canvas, peaks, activeIndex) {
  const points = peaks
    .map((row, index) => ({
      index,
      player: row.player_name,
      date: trimDate(row.date),
      x: Date.parse(row.date),
      y: Number(row.rating),
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  const ctx = prepareCanvas(canvas);
  state.peakHitAreas = [];
  if (!points.length) {
    drawEmptyChart(canvas, "No peak data");
    return;
  }

  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  let minY = Math.min(...points.map((point) => point.y));
  let maxY = Math.max(...points.map((point) => point.y));
  const yPadding = Math.max(10, (maxY - minY) * 0.22);
  minY -= yPadding;
  maxY += yPadding * 0.7;

  const pad = { left: 58, right: 28, top: 28, bottom: 48 };
  const width = canvas.width - pad.left - pad.right;
  const height = canvas.height - pad.top - pad.bottom;
  const xSpan = Math.max(1, maxX - minX);
  const ySpan = Math.max(1, maxY - minY);
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const coords = new Map();

  drawChartGrid(ctx, canvas, pad, width, height, minY, maxY, minX, maxX);

  sorted.forEach((point) => {
    const x = pad.left + ((point.x - minX) / xSpan) * width;
    const y = pad.top + height - ((point.y - minY) / ySpan) * height;
    coords.set(point.index, { x, y });
  });

  ctx.beginPath();
  sorted.forEach((point, index) => {
    const { x, y } = coords.get(point.index);
    if (index === 0) {
      ctx.moveTo(x, pad.top + height);
      ctx.lineTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  const last = coords.get(sorted[sorted.length - 1].index);
  ctx.lineTo(last.x, pad.top + height);
  ctx.closePath();
  ctx.fillStyle = "rgba(13, 91, 69, 0.08)";
  ctx.fill();

  ctx.beginPath();
  sorted.forEach((point, index) => {
    const { x, y } = coords.get(point.index);
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.strokeStyle = "rgba(13, 91, 69, 0.55)";
  ctx.lineWidth = 2;
  ctx.stroke();

  points.forEach((point) => {
    const { x, y } = coords.get(point.index);
    const active = point.index === activeIndex;
    ctx.strokeStyle = active ? "rgba(148, 107, 52, 0.9)" : "rgba(23, 33, 29, 0.18)";
    ctx.lineWidth = active ? 1.6 : 1;
    ctx.beginPath();
    ctx.moveTo(x, y + 8);
    ctx.lineTo(x, pad.top + height);
    ctx.stroke();

    if (active) {
      ctx.beginPath();
      ctx.arc(x, y, 18, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(148, 107, 52, 0.13)";
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(x, y, active ? 7 : 4.5, 0, Math.PI * 2);
    ctx.fillStyle = active ? "#946b34" : "#0d5b45";
    ctx.fill();
    ctx.strokeStyle = "#fbfaf6";
    ctx.lineWidth = 2;
    ctx.stroke();

    state.peakHitAreas.push({ index: point.index, x, y, radius: active ? 24 : 18 });
  });

  const activePoint = points.find((point) => point.index === activeIndex) || points[0];
  const activeCoord = coords.get(activePoint.index);
  if (activeCoord) {
    const labelX = Math.min(Math.max(activeCoord.x + 14, pad.left), canvas.width - 210);
    const labelY = Math.max(activeCoord.y - 34, pad.top + 16);
    ctx.fillStyle = "rgba(251, 250, 246, 0.92)";
    ctx.strokeStyle = "rgba(23, 33, 29, 0.14)";
    ctx.lineWidth = 1;
    roundRect(ctx, labelX - 10, labelY - 18, 198, 46, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#17211d";
    ctx.font = "700 12px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(activePoint.player.slice(0, 24), labelX, labelY);
    ctx.fillStyle = "rgba(23, 33, 29, 0.56)";
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillText(`${formatRating(activePoint.y)} Elo - ${activePoint.date}`, labelX, labelY + 18);
  }
}

function drawSeriesChart(canvas, series) {
  const active = series
    .map((item) => ({
      ...item,
      points: downsample(
        item.points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)),
        800,
      ),
    }))
    .filter((item) => item.points.length);
  const ctx = prepareCanvas(canvas);
  if (!active.length) {
    drawEmptyChart(canvas, "No chart data");
    return;
  }

  const allPoints = active.flatMap((item) => item.points);
  const minX = Math.min(...allPoints.map((point) => point.x));
  const maxX = Math.max(...allPoints.map((point) => point.x));
  const minY = Math.min(...allPoints.map((point) => point.y));
  const maxY = Math.max(...allPoints.map((point) => point.y));
  const pad = { left: 52, right: 22, top: 20, bottom: 46 };
  const width = canvas.width - pad.left - pad.right;
  const height = canvas.height - pad.top - pad.bottom;
  const ySpan = Math.max(1, maxY - minY);
  const xSpan = Math.max(1, maxX - minX);

  drawGrid(ctx, canvas, pad, width, height, minY, maxY, minX, maxX);

  active.forEach((item) => {
    ctx.strokeStyle = item.color;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    item.points.forEach((point, index) => {
      const x = pad.left + ((point.x - minX) / xSpan) * width;
      const y = pad.top + height - ((point.y - minY) / ySpan) * height;
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
  });

  drawLegend(ctx, active, pad.left, 14);
}

function drawDynastyFieldChart(canvas, points) {
  const baselineKey = baselineSeries[state.dynastyBaseline] || "top10_field_average";
  const baselineLabel = baselineLabels[state.dynastyBaseline] || "field average";
  const series = [
    {
      label: state.dynastyPlayer,
      color: "#17211d",
      points: points.map((point) => ({ x: Date.parse(point.date), y: point.rating })),
      width: 3,
    },
    {
      label: baselineLabel,
      color: "#6b9d88",
      points: points.map((point) => ({ x: Date.parse(point.date), y: point[baselineKey] })),
      width: 2.4,
    },
  ].map((item) => ({
    ...item,
    points: item.points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)),
  }));

  drawLineChart(canvas, series, {
    empty: "No dynasty chart data",
    fillBetween: true,
  });
}

function drawLineChart(canvas, series, options = {}) {
  const active = series.filter((item) => item.points.length);
  const ctx = prepareCanvas(canvas);
  if (!active.length) {
    drawEmptyChart(canvas, options.empty || "No chart data");
    return;
  }

  const allPoints = active.flatMap((item) => item.points);
  const minX = Math.min(...allPoints.map((point) => point.x));
  const maxX = Math.max(...allPoints.map((point) => point.x));
  let minY = Math.min(...allPoints.map((point) => point.y));
  let maxY = Math.max(...allPoints.map((point) => point.y));
  if (options.zeroLine || options.fillToZero) {
    minY = Math.min(0, minY);
    maxY = Math.max(0, maxY);
  }
  const yPadding = Math.max(8, (maxY - minY) * 0.1);
  minY -= yPadding;
  maxY += yPadding;

  const pad = { left: 58, right: 128, top: 28, bottom: 48 };
  const width = canvas.width - pad.left - pad.right;
  const height = canvas.height - pad.top - pad.bottom;
  const ySpan = Math.max(1, maxY - minY);
  const xSpan = Math.max(1, maxX - minX);
  drawChartGrid(ctx, canvas, pad, width, height, minY, maxY, minX, maxX, options);

  if (options.fillBetween && active.length >= 2) {
    const upper = active[0].points;
    const lower = new Map(active[1].points.map((point) => [point.x, point]));
    const paired = upper
      .map((point) => ({ upper: point, lower: lower.get(point.x) }))
      .filter((pair) => pair.lower);
    if (paired.length) {
      ctx.beginPath();
      paired.forEach((pair, index) => {
        const x = pad.left + ((pair.upper.x - minX) / xSpan) * width;
        const y = pad.top + height - ((pair.upper.y - minY) / ySpan) * height;
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      [...paired].reverse().forEach((pair) => {
        const x = pad.left + ((pair.lower.x - minX) / xSpan) * width;
        const y = pad.top + height - ((pair.lower.y - minY) / ySpan) * height;
        ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = "rgba(148, 107, 52, 0.12)";
      ctx.fill();
    }
  }

  if (options.fillToZero) {
    const line = active[0];
    const zeroY = pad.top + height - ((0 - minY) / ySpan) * height;
    ctx.beginPath();
    line.points.forEach((point, index) => {
      const x = pad.left + ((point.x - minX) / xSpan) * width;
      const y = pad.top + height - ((point.y - minY) / ySpan) * height;
      if (index === 0) {
        ctx.moveTo(x, zeroY);
        ctx.lineTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    const last = line.points[line.points.length - 1];
    const lastX = pad.left + ((last.x - minX) / xSpan) * width;
    ctx.lineTo(lastX, zeroY);
    ctx.closePath();
    ctx.fillStyle = "rgba(148, 107, 52, 0.14)";
    ctx.fill();
  }

  active.forEach((item) => {
    ctx.strokeStyle = item.color;
    ctx.lineWidth = item.width || 2.2;
    ctx.beginPath();
    item.points.forEach((point, index) => {
      const x = pad.left + ((point.x - minX) / xSpan) * width;
      const y = pad.top + height - ((point.y - minY) / ySpan) * height;
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();

    const last = item.points[item.points.length - 1];
    const labelX = pad.left + ((last.x - minX) / xSpan) * width + 8;
    const labelY = pad.top + height - ((last.y - minY) / ySpan) * height + 4;
    ctx.fillStyle = item.color;
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(item.label.slice(0, 18), Math.min(labelX, canvas.width - pad.right + 10), labelY);
  });
}

function drawGrid(ctx, canvas, pad, width, height, minY, maxY, minX, maxX) {
  ctx.strokeStyle = "#dedbd2";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (height * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(canvas.width - pad.right, y);
    ctx.stroke();
  }

  ctx.fillStyle = "#7a817b";
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(Math.round(maxY), pad.left - 8, pad.top + 4);
  ctx.fillText(Math.round(minY), pad.left - 8, pad.top + height);

  const years = yearTicks(minX, maxX, width);
  ctx.textAlign = "center";
  years.forEach((year) => {
    const xValue = Date.parse(`${year}-01-01`);
    const x = pad.left + ((xValue - minX) / Math.max(1, maxX - minX)) * width;
    ctx.strokeStyle = "rgba(23, 33, 29, 0.1)";
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, pad.top + height + 4);
    ctx.stroke();
    ctx.fillStyle = "#7a817b";
    ctx.fillText(String(year), x, pad.top + height + 22);
  });
}

function drawChartGrid(ctx, canvas, pad, width, height, minY, maxY, minX, maxX, options = {}) {
  ctx.strokeStyle = "rgba(23, 33, 29, 0.1)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (height * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(canvas.width - pad.right, y);
    ctx.stroke();
  }

  if (options.zeroLine && minY < 0 && maxY > 0) {
    const zeroY = pad.top + height - ((0 - minY) / Math.max(1, maxY - minY)) * height;
    ctx.strokeStyle = "rgba(23, 33, 29, 0.24)";
    ctx.beginPath();
    ctx.moveTo(pad.left, zeroY);
    ctx.lineTo(canvas.width - pad.right, zeroY);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(23, 33, 29, 0.56)";
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i += 1) {
    const value = maxY - ((maxY - minY) * i) / 4;
    const y = pad.top + (height * i) / 4 + 4;
    ctx.fillText(Math.round(value), pad.left - 10, y);
  }

  const xTicks = options.xFormatter ? numericTicks(minX, maxX, width) : yearTicks(minX, maxX, width);
  ctx.textAlign = "center";
  xTicks.forEach((tick) => {
    const value = options.xFormatter ? tick : Date.parse(`${tick}-01-01`);
    const x = pad.left + ((value - minX) / Math.max(1, maxX - minX)) * width;
    ctx.strokeStyle = "rgba(23, 33, 29, 0.08)";
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, pad.top + height + 4);
    ctx.stroke();
    ctx.fillStyle = "rgba(23, 33, 29, 0.52)";
    ctx.fillText(options.xFormatter ? options.xFormatter(tick) : String(tick), x, pad.top + height + 24);
  });
}

function prepareCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width));
  canvas.height = Math.max(1, Math.floor(rect.height));
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  return ctx;
}

function drawLegend(ctx, series, x, y) {
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "left";
  let offset = 0;
  series.slice(0, 6).forEach((item) => {
    ctx.fillStyle = item.color;
    ctx.fillRect(x + offset, y - 8, 10, 10);
    ctx.fillStyle = "#7a817b";
    const label = item.label.slice(0, 18);
    ctx.fillText(label, x + offset + 14, y);
    offset += Math.min(142, 34 + label.length * 7);
  });
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function downsample(points, limit) {
  if (points.length <= limit) {
    return points;
  }
  const step = Math.ceil(points.length / limit);
  return points.filter((_, index) => index % step === 0 || index === points.length - 1);
}

function yearTicks(minX, maxX, width) {
  const minYear = new Date(minX).getFullYear();
  const maxYear = new Date(maxX).getFullYear();
  const span = Math.max(1, maxYear - minYear);
  const targetTicks = Math.max(4, Math.min(10, Math.floor(width / 95)));
  const rawStep = Math.ceil(span / targetTicks);
  const step = rawStep <= 1 ? 1 : rawStep <= 2 ? 2 : rawStep <= 5 ? 5 : 10;
  const first = Math.ceil(minYear / step) * step;
  const ticks = [];
  for (let year = first; year <= maxYear; year += step) {
    ticks.push(year);
  }
  if (!ticks.includes(minYear)) {
    ticks.unshift(minYear);
  }
  if (!ticks.includes(maxYear)) {
    ticks.push(maxYear);
  }
  return [...new Set(ticks)].sort((a, b) => a - b);
}

function numericTicks(minX, maxX, width) {
  const span = Math.max(1, maxX - minX);
  const targetTicks = Math.max(4, Math.min(8, Math.floor(width / 120)));
  const rawStep = Math.ceil(span / targetTicks);
  const step = rawStep <= 6 ? 6 : rawStep <= 12 ? 12 : rawStep <= 24 ? 24 : 36;
  const ticks = [];
  const first = Math.ceil(minX / step) * step;
  for (let tick = first; tick <= maxX; tick += step) {
    ticks.push(tick);
  }
  if (!ticks.includes(0) && minX <= 0) {
    ticks.unshift(0);
  }
  if (!ticks.length) {
    ticks.push(minX, maxX);
  }
  return [...new Set(ticks)].sort((a, b) => a - b);
}

drawEmptyChart(compareChart, "Loading");
drawEmptyChart(historyChart, "Select a player");
drawEmptyChart(peakChart, "Loading peaks");
drawEmptyChart(dynastyMainChart, "Loading");
refresh();
