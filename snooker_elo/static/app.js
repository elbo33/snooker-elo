const state = {
  selectedPlayer: null,
  compare: [],
  seeded: false,
  metadataLoaded: false,
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
const dominanceEl = document.querySelector("#dominance");
const peaksEl = document.querySelector("#peaks");
const historyChart = document.querySelector("#history-chart");
const compareChart = document.querySelector("#compare-chart");
const eraChart = document.querySelector("#era-chart");
const palette = ["#13795b", "#2f66b3", "#a56a21", "#7f4da0", "#b23b35", "#44515f", "#0f766e", "#8a5a44"];
const defaultLegends = [
  "Ronnie O'Sullivan",
  "Stephen Hendry",
  "Steve Davis",
  "John Higgins",
  "Mark Selby",
  "Judd Trump",
];

dateInput.value = new Date().toISOString().slice(0, 10);

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

window.addEventListener("resize", () => {
  renderCompare();
  loadEras();
  if (state.selectedPlayer) {
    loadPlayer(state.selectedPlayer.player_id, state.selectedPlayer.player_name);
  }
});

async function refresh() {
  await loadMetadata();
  renderEloExplainer();
  await Promise.all([loadRankings(), loadEras(), loadPeaks()]);
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
    drawEmptyChart(eraChart, "No generated database");
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

async function loadEras() {
  const data = await api(
    `/api/eras?rating=${ratingInput.value}&start_year=${startYearInput.value}&end_year=${endYearInput.value}&leaders=3&limit=10`,
  );
  if (data.error) {
    drawEmptyChart(eraChart, "No era data");
    dominanceEl.innerHTML = `<div class="error">${escapeHtml(data.error)}</div>`;
    return;
  }
  eraRange.textContent = `${startYearInput.value} to ${endYearInput.value}`;
  drawEraChart(eraChart, data.periods || []);
  dominanceEl.innerHTML =
    (data.dominance || [])
      .map(
        (row) => `
          <div class="dominance-row">
            <div>
              <strong>${escapeHtml(row.player_name)}</strong>
              <span>${row.first_year} to ${row.latest_year}, longest streak ${row.longest_streak}</span>
            </div>
            <div class="dominance-years">${row.years_at_number_one}</div>
          </div>
        `,
      )
      .join("") || `<div class="empty">No dominance data</div>`;
}

async function loadPeaks() {
  const data = await api(`/api/peaks?rating=${ratingInput.value}&limit=6`);
  if (data.error) {
    peaksEl.innerHTML = `<div class="error">${escapeHtml(data.error)}</div>`;
    return;
  }
  peaksEl.innerHTML =
    data
      .map(
        (row, index) => `
          <article class="peak-card">
            <div>
              <div class="peak-rank">Peak ${index + 1}</div>
              <strong>${formatRating(row.rating)}</strong>
              <span>${ratingInput.value === "frame" ? "Frame Elo" : "Match Elo"}</span>
            </div>
            <div>
              <b>${escapeHtml(row.player_name)}</b>
              <span>${trimDate(row.date)}</span>
            </div>
          </article>
        `,
      )
      .join("") || `<div class="empty">No peak data</div>`;
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
  ctx.fillStyle = "#66717f";
  ctx.font = "14px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(label, canvas.width / 2, canvas.height / 2);
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

function drawGrid(ctx, canvas, pad, width, height, minY, maxY, minX, maxX) {
  ctx.strokeStyle = "#d8e1e8";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (height * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(canvas.width - pad.right, y);
    ctx.stroke();
  }

  ctx.fillStyle = "#66717f";
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(Math.round(maxY), pad.left - 8, pad.top + 4);
  ctx.fillText(Math.round(minY), pad.left - 8, pad.top + height);

  const years = yearTicks(minX, maxX, width);
  ctx.textAlign = "center";
  years.forEach((year) => {
    const xValue = Date.parse(`${year}-01-01`);
    const x = pad.left + ((xValue - minX) / Math.max(1, maxX - minX)) * width;
    ctx.strokeStyle = "rgba(216, 226, 222, 0.7)";
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, pad.top + height + 4);
    ctx.stroke();
    ctx.fillStyle = "#66717f";
    ctx.fillText(String(year), x, pad.top + height + 22);
  });
}

function drawEraChart(canvas, periods) {
  const ctx = prepareCanvas(canvas);
  if (!periods.length) {
    drawEmptyChart(canvas, "No era data");
    return;
  }
  const topLeaders = [...new Set(periods.map((period) => period.leaders[0]?.player_id).filter(Boolean))];
  const colorFor = (playerId) => palette[Math.max(0, topLeaders.indexOf(playerId)) % palette.length];
  const pad = { left: 52, right: 22, top: 24, bottom: 42 };
  const width = canvas.width - pad.left - pad.right;
  const height = canvas.height - pad.top - pad.bottom;
  const years = periods.map((period) => Number(period.year));
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  const span = Math.max(1, maxYear - minYear + 1);
  const bandWidth = width / span;

  periods.forEach((period) => {
    const leader = period.leaders[0];
    if (!leader) {
      return;
    }
    const x = pad.left + (Number(period.year) - minYear) * bandWidth;
    ctx.fillStyle = colorFor(leader.player_id);
    ctx.fillRect(x, pad.top, Math.max(1, bandWidth + 1), height);
  });

  ctx.fillStyle = "#18212b";
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "center";
  yearTicks(Date.parse(`${minYear}-01-01`), Date.parse(`${maxYear}-12-31`), width).forEach((year) => {
    const x = pad.left + ((year - minYear) / Math.max(1, maxYear - minYear)) * width;
    ctx.fillText(String(year), x, canvas.height - 14);
  });

  const legend = topLeaders.slice(0, 6).map((id) => {
    const period = periods.find((item) => item.leaders[0]?.player_id === id);
    return { label: period?.leaders[0]?.player_name || id, color: colorFor(id) };
  });
  drawLegend(ctx, legend, pad.left, 14);
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
    ctx.fillStyle = "#66717f";
    const label = item.label.slice(0, 18);
    ctx.fillText(label, x + offset + 14, y);
    offset += Math.min(142, 34 + label.length * 7);
  });
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

drawEmptyChart(compareChart, "Loading");
drawEmptyChart(historyChart, "Select a player");
drawEmptyChart(eraChart, "Loading");
refresh();
