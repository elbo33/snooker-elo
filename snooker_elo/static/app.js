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
  metaText.textContent = `${data.earliest_match ?? ""} to ${data.latest_match ?? ""}`;
}

async function loadRankings() {
  const data = await api(`/api/rankings?date=${dateInput.value}&rating=${ratingInput.value}&limit=50`);
  leaderboard.innerHTML = "";
  if (data.error) {
    leaderboard.innerHTML = `<tr><td colspan="5" class="error">${escapeHtml(data.error)}</td></tr>`;
    return;
  }
  if (!data.length) {
    leaderboard.innerHTML = `<tr><td colspan="5" class="empty">No players</td></tr>`;
    return;
  }
  leaderboard.innerHTML = data
    .map(
      (row) => `
        <tr>
          <td>${row.rank}</td>
          <td>${escapeHtml(row.player_name)}</td>
          <td>${formatRating(row.match_elo)}</td>
          <td>${formatRating(row.frame_elo)}</td>
          <td>${row.matches_played}</td>
        </tr>
      `,
    )
    .join("");
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
    return;
  }
  detailEl.innerHTML = `
    <div class="metric-row">
      <strong>${escapeHtml(playerName)}</strong>
      <span>Rank ${data.rank?.rank ?? "-"}</span>
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
      <strong>${formatRating(data.peak_rating?.match_elo)}</strong>
      <span>Peak match Elo</span>
    </div>
    <div class="metric-row">
      <strong>${data.peak_rank?.rank ?? "-"}</strong>
      <span>Peak rank</span>
    </div>
  `;
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
    return;
  }
  const ids = state.compare.map((player) => encodeURIComponent(player.player_id)).join(",");
  const data = await api(`/api/compare?ids=${ids}`);
  if (data.error) {
    compareEl.innerHTML = `<div class="error">${escapeHtml(data.error)}</div>`;
    return;
  }
  compareEl.innerHTML = state.compare
    .map((player) => {
      const events = data[player.player_id] || [];
      const last = events.at(-1);
      return `
        <div class="compare-row">
          <strong>${escapeHtml(player.player_name)}</strong>
          <span>${events.length} events</span>
          <span>${last ? `${formatRating(last.match_elo_after)} match Elo` : "-"}</span>
        </div>
      `;
    })
    .join("");
}

async function api(path) {
  const response = await fetch(path);
  return response.json();
}

function formatRating(value) {
  return Number.isFinite(value) ? Math.round(value).toString() : "-";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

refresh();
