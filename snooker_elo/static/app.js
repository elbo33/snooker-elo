const state = {
  selectedPlayer: null,
  compare: [],
};

const dateInput = document.querySelector("#date");
const ratingInput = document.querySelector("#rating");
const leaderboard = document.querySelector("#leaderboard");
const statusText = document.querySelector("#status");
const metaText = document.querySelector("#meta");
const playersEl = document.querySelector("#players");
const detailEl = document.querySelector("#player-detail");
const compareListEl = document.querySelector("#compare-list");
const compareEl = document.querySelector("#compare");
const historyChart = document.querySelector("#history-chart");
const compareChart = document.querySelector("#compare-chart");
const palette = ["#157f63", "#315caa", "#9a4d16", "#7c3f98", "#b3261e", "#59636f"];

dateInput.value = new Date().toISOString().slice(0, 10);

document.querySelector("#controls").addEventListener("submit", (event) => {
  event.preventDefault();
  refresh();
});

document.querySelector("#player-search").addEventListener("submit", async (event) => {
  event.preventDefault();
  await searchPlayers(document.querySelector("#search").value);
});

document.querySelector("#clear-compare").addEventListener("click", () => {
  state.compare = [];
  renderCompare();
});

window.addEventListener("resize", () => {
  if (state.selectedPlayer) {
    loadPlayer(state.selectedPlayer.player_id, state.selectedPlayer.player_name);
  }
  renderCompare();
});

async function refresh() {
  await Promise.all([loadMetadata(), loadRankings()]);
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
  statusText.textContent = `${data.usable_matches ?? 0} usable matches`;
  metaText.textContent = `${trimDate(data.earliest_match)} to ${trimDate(data.latest_match)}`;
}

async function loadRankings() {
  const data = await api(`/api/rankings?date=${dateInput.value}&rating=${ratingInput.value}&limit=50`);
  leaderboard.innerHTML = "";
  if (data.error) {
    leaderboard.innerHTML = `<tr><td colspan="5" class="error">${escapeHtml(data.error)}</td></tr>`;
    drawEmptyChart(historyChart, "No generated database");
    drawEmptyChart(compareChart, "No generated database");
    return;
  }
  if (!data.length) {
    leaderboard.innerHTML = `<tr><td colspan="5" class="empty">No players</td></tr>`;
    return;
  }

  leaderboard.innerHTML = data
    .map(
      (row) => `
        <tr data-id="${escapeHtml(row.player_id)}" data-name="${escapeHtml(row.player_name)}">
          <td>${row.rank}</td>
          <td>${escapeHtml(row.player_name)}</td>
          <td>${formatRating(row.match_elo)}</td>
          <td>${formatRating(row.frame_elo)}</td>
          <td>${row.matches_played}</td>
        </tr>
      `,
    )
    .join("");

  leaderboard.querySelectorAll("tr").forEach((row) => {
    row.addEventListener("click", async () => {
      await loadPlayer(row.dataset.id, row.dataset.name);
      addCompare(row.dataset.id, row.dataset.name);
    });
  });
}

async function searchPlayers(query) {
  const data = await api(`/api/players?search=${encodeURIComponent(query)}&limit=20`);
  if (data.error) {
    playersEl.innerHTML = `<div class="error">${escapeHtml(data.error)}</div>`;
    return;
  }
  playersEl.innerHTML =
    data
      .map(
        (player) => `
          <div class="player-row">
            <strong>${escapeHtml(player.player_name)}</strong>
            <span>${player.matches_played} matches</span>
            <button type="button" data-id="${escapeHtml(player.player_id)}" data-name="${escapeHtml(player.player_name)}">
              Select
            </button>
          </div>
        `,
      )
      .join("") || `<div class="empty">No matches</div>`;

  playersEl.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", async () => {
      await loadPlayer(button.dataset.id, button.dataset.name);
      addCompare(button.dataset.id, button.dataset.name);
    });
  });
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
      label: ratingInput.value === "frame" ? "Frame Elo" : "Match Elo",
      color: ratingInput.value === "frame" ? palette[1] : palette[0],
      points: data.history.map((event) => eventPoint(event)),
    },
  ]);
}

function addCompare(playerId, playerName) {
  if (!state.compare.some((player) => player.player_id === playerId)) {
    state.compare.push({ player_id: playerId, player_name: playerName });
  }
  renderCompare();
}

async function renderCompare() {
  compareListEl.innerHTML =
    state.compare
      .map((player) => `<div class="compare-row"><strong>${escapeHtml(player.player_name)}</strong></div>`)
      .join("") || `<div class="empty">No players</div>`;

  if (!state.compare.length) {
    compareEl.innerHTML = "";
    drawEmptyChart(compareChart, "No players selected");
    return;
  }

  const ids = state.compare.map((player) => encodeURIComponent(player.player_id)).join(",");
  const data = await api(`/api/compare?ids=${ids}`);
  if (data.error) {
    compareEl.innerHTML = `<div class="error">${escapeHtml(data.error)}</div>`;
    drawEmptyChart(compareChart, "No comparison data");
    return;
  }

  drawSeriesChart(
    compareChart,
    state.compare.map((player, index) => ({
      label: player.player_name,
      color: palette[index % palette.length],
      points: (data[player.player_id] || []).map((event) => eventPoint(event)),
    })),
  );

  compareEl.innerHTML = state.compare
    .map((player) => {
      const events = data[player.player_id] || [];
      const last = events.at(-1);
      return `
        <div class="compare-row">
          <strong>${escapeHtml(player.player_name)}</strong>
          <span>${events.length} events</span>
          <span>${last ? `${formatRating(selectedEventRating(last))} ${ratingInput.value} Elo` : "-"}</span>
        </div>
      `;
    })
    .join("");
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

function formatRating(value) {
  return Number.isFinite(value) ? Math.round(value).toString() : "-";
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
  ctx.fillStyle = "#65717f";
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
        600,
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
  const pad = { left: 46, right: 14, top: 18, bottom: 32 };
  const width = canvas.width - pad.left - pad.right;
  const height = canvas.height - pad.top - pad.bottom;
  const ySpan = Math.max(1, maxY - minY);
  const xSpan = Math.max(1, maxX - minX);

  ctx.strokeStyle = "#d9e0e7";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (height * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(canvas.width - pad.right, y);
    ctx.stroke();
  }

  ctx.fillStyle = "#65717f";
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(Math.round(maxY), pad.left - 8, pad.top + 4);
  ctx.fillText(Math.round(minY), pad.left - 8, pad.top + height);

  active.forEach((item) => {
    ctx.strokeStyle = item.color;
    ctx.lineWidth = 2;
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

  drawLegend(ctx, active, pad.left, canvas.height - 10);
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
  series.slice(0, 4).forEach((item) => {
    ctx.fillStyle = item.color;
    ctx.fillRect(x + offset, y - 8, 10, 10);
    ctx.fillStyle = "#65717f";
    const label = item.label.slice(0, 20);
    ctx.fillText(label, x + offset + 14, y);
    offset += Math.min(150, 34 + label.length * 7);
  });
}

function downsample(points, limit) {
  if (points.length <= limit) {
    return points;
  }
  const step = Math.ceil(points.length / limit);
  return points.filter((_, index) => index % step === 0 || index === points.length - 1);
}

drawEmptyChart(historyChart, "Select a player");
drawEmptyChart(compareChart, "No players selected");
refresh();
