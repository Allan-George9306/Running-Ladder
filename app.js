const STORAGE_KEY = "runner-ladder-votes-v1";
const DEFAULT_ORDER_STORAGE_KEY = "runner-ladder-default-order-v1";
const FORCE_DEFAULT_SYNC_STORAGE_KEY = "runner-ladder-force-default-sync-version-v1";
const FORCE_DEFAULT_SYNC_VERSION = "2026-04-22-current-order-sync-1";
const DEFAULT_SORT = "score";
const STARTING_TOP_SCORE = 100;
const REMOTE_POLL_INTERVAL_MS = 15000;
const collator = new Intl.Collator(undefined, { sensitivity: "base" });

const LOCAL_RUNNER_DATA = cloneRunnerData(window.RUNNER_DATA || []);
const SUPABASE_CONFIG = window.RUNNER_LADDER_SUPABASE || {};

const searchInput = document.getElementById("searchInput");
const eventSortSelect = document.getElementById("eventSortSelect");
const resetVotesButton = document.getElementById("resetVotesButton");
const setDefaultOrderButton = document.getElementById("setDefaultOrderButton");
const curatorModeButton = document.getElementById("curatorModeButton");
const reverseSortButton = document.getElementById("reverseSortButton");
const summaryCards = document.getElementById("summaryCards");
const boardMeta = document.getElementById("boardMeta");
const rankingList = document.getElementById("rankingList");
const detailPanel = document.getElementById("detailPanel");
const sortButtons = Array.from(document.querySelectorAll("[data-sort]"));
const connectionBadge = document.getElementById("connectionBadge");
const connectionStatus = document.getElementById("connectionStatus");
const authStatus = document.getElementById("authStatus");

const state = {
  search: "",
  selectedEvent: "",
  sort: DEFAULT_SORT,
  isReverseSort: false,
  activeRunnerId: null,
  curatorMode: false
};

const dragState = {
  draggedRunnerId: null,
  dropTargetId: null,
  placeAfter: false
};

const remoteState = {
  enabled: false,
  voteApiUrl: "",
  statusMessage: "Local-only mode. Votes are stored in this browser.",
  authMessage: "Shared mode is not configured yet. When enabled, each IP gets one vote per runner.",
  voteTotalsByRunnerId: {},
  ownVotesByRunnerId: {},
  pollHandle: null
};

const APP_EVENT_SORT_INFO = {
  "400m": { categoryRank: 0, distance: 400, variantRank: 0 },
  "440 yards": { categoryRank: 0, distance: 402.34, variantRank: 0 },
  "600m": { categoryRank: 0, distance: 600, variantRank: 0 },
  "800m": { categoryRank: 0, distance: 800, variantRank: 0 },
  "Half mile": { categoryRank: 0, distance: 804.67, variantRank: 0 },
  "880 yards": { categoryRank: 0, distance: 804.67, variantRank: 0 },
  "1000m": { categoryRank: 0, distance: 1000, variantRank: 0 },
  "1500m": { categoryRank: 0, distance: 1500, variantRank: 0 },
  "1600m": { categoryRank: 0, distance: 1600, variantRank: 0 },
  "Mile": { categoryRank: 0, distance: 1609.34, variantRank: 0 },
  "2000m steeple": { categoryRank: 0, distance: 2000, variantRank: 1 },
  "3200 yards": { categoryRank: 0, distance: 2926.08, variantRank: 0 },
  "3000m": { categoryRank: 0, distance: 3000, variantRank: 0 },
  "3000m steeple": { categoryRank: 0, distance: 3000, variantRank: 1 },
  "2 mile": { categoryRank: 0, distance: 3218.69, variantRank: 0 },
  "3200m": { categoryRank: 0, distance: 3200, variantRank: 0 },
  "3 mile": { categoryRank: 0, distance: 4828.03, variantRank: 0 },
  "5000m": { categoryRank: 0, distance: 5000, variantRank: 0 },
  "10k": { categoryRank: 0, distance: 10000, variantRank: 0 },
  "20k": { categoryRank: 0, distance: 20000, variantRank: 0 },
  "Marathon": { categoryRank: 0, distance: 42195, variantRank: 0 },
  "3 mile XC": { categoryRank: 1, distance: 4828.03, variantRank: 0 },
  "3 miles XC": { categoryRank: 1, distance: 4828.03, variantRank: 0 },
  "5k XC": { categoryRank: 1, distance: 5000, variantRank: 0 },
  "8k XC": { categoryRank: 1, distance: 8000, variantRank: 0 }
};

const CURATED_DEFAULT_ORDER = [
  "Jim Ryun",
  "Gerry Lindgren",
  "Dathan Ritzenhein",
  "Alan Webb",
  "Lukas Verzbicas",
  "Craig Virgin",
  "Colin Sahlman",
  "Owen Powell",
  "Simeon Birnbaum",
  "Nico Young",
  "Daniel Simmons",
  "Steve Prefontaine",
  "Spencer Jackson",
  "Drew Griffith",
  "German Fernandez",
  "Leo Young",
  "Josiah Tostenson",
  "Lex Young",
  "Jeff Nelson",
  "Galen Rupp",
  "Drew Hunter",
  "Rudy Chapa",
  "Hobbs Kessler",
  "Edward Cheserek",
  "Grant Fisher",
  "Eric Hulst",
  "Tayvon Kitchen",
  "Chris Derrick",
  "Thom Hunt",
  "Marty Liquori",
  "Rich Kimball",
  "Gary Martin",
  "Ralph Serna",
  "Chris Solinsky",
  "Bill McChesney",
  "Adam Goucher",
  "Connor Burns",
  "Casey Clinger",
  "Aaron Sahlman",
  "Ryan Hall",
  "Rocky Hansen",
  "Futsum Zienasellassie",
  "Don Sage",
  "Reed Brown",
  "Cooper Lutkenhaus"
];

const BASELINE_STAT_WEIGHTS = [6, 0.55, 0.08];
const BASELINE_ACHIEVEMENT_WEIGHTS = [0.32, 0.08, 0.02];
const PREFERRED_INSERT_POSITIONS = {
  "Noah Bontrager": 88
};

let runnerData = cloneRunnerData(LOCAL_RUNNER_DATA);
let voteStore = loadVoteStore();
let defaultOrder = buildCompleteDefaultOrder(loadDefaultOrder() || CURATED_DEFAULT_ORDER);
let defaultOrderIndex = buildDefaultOrderIndex(defaultOrder);
let DATASET_EVENT_BESTS = {};
let DATASET_YEAR_RANGE = { min: 0, max: 0 };
let STARTING_SCORE_BY_ID = {};

function cloneRunnerData(data) {
  return data.map((runner) => ({
    ...runner,
    stats: (runner.stats || []).map((stat) => ({ ...stat })),
    achievements: [...(runner.achievements || [])]
  }));
}

function loadVoteStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function saveVoteStore() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(voteStore));
}

function loadDefaultOrder() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DEFAULT_ORDER_STORAGE_KEY) || "null");
    return Array.isArray(parsed)
      ? parsed.filter((runnerName) => typeof runnerName === "string" && runnerName.trim())
      : null;
  } catch {
    return null;
  }
}

function saveDefaultOrder(order) {
  localStorage.setItem(DEFAULT_ORDER_STORAGE_KEY, JSON.stringify(order));
}

function buildCompleteDefaultOrder(order) {
  const completeOrder = [];
  const seenNames = new Set();
  const preferredInsertions = [];

  (Array.isArray(order) ? order : []).forEach((runnerName) => {
    if (typeof runnerName !== "string" || !runnerName.trim() || seenNames.has(runnerName)) {
      return;
    }

    seenNames.add(runnerName);
    completeOrder.push(runnerName);
  });

  runnerData.forEach((runner) => {
    if (!runner?.name || seenNames.has(runner.name)) {
      return;
    }

    seenNames.add(runner.name);

    if (Number.isFinite(PREFERRED_INSERT_POSITIONS[runner.name])) {
      preferredInsertions.push(runner.name);
      return;
    }

    completeOrder.push(runner.name);
  });

  preferredInsertions
    .sort(
      (leftRunnerName, rightRunnerName) =>
        PREFERRED_INSERT_POSITIONS[leftRunnerName] - PREFERRED_INSERT_POSITIONS[rightRunnerName]
    )
    .forEach((runnerName) => {
      const preferredIndex = Math.max(
        0,
        Math.min(completeOrder.length, (PREFERRED_INSERT_POSITIONS[runnerName] || 1) - 1)
      );

      completeOrder.splice(preferredIndex, 0, runnerName);
    });

  return completeOrder;
}

function buildDefaultOrderIndex(order) {
  return order.reduce((orderIndex, runnerName, index) => {
    if (!(runnerName in orderIndex)) {
      orderIndex[runnerName] = index;
    }

    return orderIndex;
  }, {});
}

function hasVoteChanges(store) {
  return Object.values(store).some(
    (entry) => (Number(entry?.up) || 0) !== 0 || (Number(entry?.down) || 0) !== 0
  );
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatMileDisplayText(value) {
  return String(value)
    .replace(/\b(\d+)\s*miles\b/gi, "$1 Mile")
    .replace(/\b(\d+)\s*mile\b/gi, "$1 Mile")
    .replace(/\b(\d+)-mile\b/gi, "$1-Mile")
    .replace(/\bHalf mile\b/gi, "Half Mile")
    .replace(/^mile\b/gi, "Mile")
    .replace(
      /\bmile\b(?=\s+(champion|2nd|3rd|4th|5th|6th|7th|8th|9th|10th|record|records|title|titles|final|finals|heat|heats|race|races|championship|championships|nationals|national|outdoor|indoor|invitational|invite|winner))/gi,
      "Mile"
    );
}

function normalizeEventKey(eventLabel) {
  return eventLabel === "3 miles XC" ? "3 mile XC" : eventLabel;
}

function parseMarkToSeconds(mark) {
  const normalized = String(mark).trim().replace(/i$/i, "");
  const parts = normalized.split(":");

  if (!parts.length || parts.some((part) => part.trim() === "" || Number.isNaN(Number(part)))) {
    return Number.POSITIVE_INFINITY;
  }

  if (parts.length === 1) {
    return Number(parts[0]);
  }

  if (parts.length === 2) {
    return Number(parts[0]) * 60 + Number(parts[1]);
  }

  if (parts.length === 3) {
    return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
  }

  return Number.POSITIVE_INFINITY;
}

function getAppEventSortInfo(eventLabel) {
  return (
    APP_EVENT_SORT_INFO[eventLabel] || {
      categoryRank: /XC/i.test(eventLabel) ? 1 : 0,
      distance: Number.POSITIVE_INFINITY,
      variantRank: 0
    }
  );
}

function getDefaultOrderRank(runnerName) {
  return defaultOrderIndex[runnerName] ?? Number.POSITIVE_INFINITY;
}

function getRunnerByIdFromDataset(runnerId) {
  return runnerData.find((runner) => runner.id === runnerId) || null;
}

function getRunnerNameById(runnerId) {
  return getRunnerByIdFromDataset(runnerId)?.name || null;
}

function canUseCuratorTools() {
  return !state.search.trim() && !state.selectedEvent && state.sort === "score" && !state.isReverseSort;
}

function getCuratorToolBlockReason() {
  if (state.selectedEvent) {
    return "Clear the event filter to edit the saved board order.";
  }

  if (state.search.trim()) {
    return "Clear search to edit the full board order.";
  }

  if (state.sort !== "score") {
    return "Switch back to By Votes to edit the saved board order.";
  }

  if (state.isReverseSort) {
    return "Turn off reverse order to edit the saved board order.";
  }

  return "Curator tools are ready.";
}

function clearDragState() {
  dragState.draggedRunnerId = null;
  dragState.dropTargetId = null;
  dragState.placeAfter = false;
}

function getRunnerBestMarksByEvent(runner) {
  return runner.stats.reduce((marks, stat) => {
    const eventKey = normalizeEventKey(stat.event);
    const seconds = parseMarkToSeconds(stat.displayMark || stat.mark);

    if (!Number.isFinite(seconds)) {
      return marks;
    }

    const currentBest = marks[eventKey];
    if (!currentBest || seconds < currentBest.seconds) {
      marks[eventKey] = {
        seconds,
        stat
      };
    }

    return marks;
  }, {});
}

function getAchievementBaselineValue(achievement) {
  const normalized = achievement.toLowerCase();
  let score = 0;

  if (/\bnational record\b|\bworld record\b/.test(normalized)) {
    score += 0.52;
  }

  if (/\brepresented usa\b|\bolympic trials qualifier\b/.test(normalized)) {
    score += 0.18;
  }

  if (/\bchampion\b|\bwinner\b/.test(normalized)) {
    score += 0.22;
  }

  if (/\brunner-up\b/.test(normalized)) {
    score += 0.15;
  }

  const placeMatch = normalized.match(/\b(\d+)(?:st|nd|rd|th)\b/);
  if (placeMatch) {
    const place = Number(placeMatch[1]);
    if (place === 1) {
      score += 0.22;
    } else if (place === 2) {
      score += 0.15;
    } else if (place === 3) {
      score += 0.11;
    } else if (place <= 5) {
      score += 0.07;
    } else if (place <= 10) {
      score += 0.04;
    } else if (place <= 20) {
      score += 0.02;
    }
  }

  const repeatMatch = normalized.match(/\b([2-9])\s*time\b|\b([2-9])x\b/);
  if (repeatMatch) {
    score += (Number(repeatMatch[1] || repeatMatch[2]) - 1) * 0.05;
  }

  if (
    /\bolympic\b|\bworld\b|\busatf\b|\biaaf\b|\bfoot locker\b|\bnike xc\b|\bnike cross nationals\b|\bnxn\b|\bbrooks\b|\brunninglane\b|\bnationals\b|\bchampionships\b/.test(
      normalized
    )
  ) {
    score += 0.08;
  }

  if (/\bfirst sub 4\b/.test(normalized)) {
    score += 0.36;
  }

  if (/\bbest .* in the world\b/.test(normalized)) {
    score += 0.3;
  }

  if (/\bolympic trials\b/.test(normalized)) {
    score += 0.12;
  }

  if (/\bolympic final\b/.test(normalized)) {
    score += 0.18;
  }

  return score;
}

function getBaselineStatScore(bestMarksByEvent) {
  const statScores = Object.entries(bestMarksByEvent)
    .map(([eventKey, entry]) => {
      const bestSeconds = DATASET_EVENT_BESTS[eventKey];
      if (!bestSeconds || !Number.isFinite(entry.seconds) || entry.seconds <= 0) {
        return 0;
      }

      const eventInfo = getAppEventSortInfo(eventKey);
      const categoryWeight = eventInfo.categoryRank === 1 ? 0.97 : 1;
      const roadWeight = eventInfo.distance >= 20000 ? 0.94 : 1;
      const ratio = bestSeconds / entry.seconds;

      return Math.pow(ratio, 8) * categoryWeight * roadWeight;
    })
    .filter((score) => score > 0)
    .sort((leftScore, rightScore) => rightScore - leftScore);

  return statScores.reduce((totalScore, statScore, index) => {
    const weight = BASELINE_STAT_WEIGHTS[index];
    return weight ? totalScore + statScore * weight : totalScore;
  }, 0);
}

function getBaselineAchievementScore(achievements) {
  const achievementScores = achievements
    .map(getAchievementBaselineValue)
    .filter((score) => score > 0)
    .sort((leftScore, rightScore) => rightScore - leftScore);

  return achievementScores.reduce((totalScore, achievementScore, index) => {
    const weight = BASELINE_ACHIEVEMENT_WEIGHTS[index];
    return weight ? totalScore + achievementScore * weight : totalScore;
  }, 0);
}

function getDatasetEventBestMarks() {
  const bestMarks = {};

  runnerData.forEach((runner) => {
    runner.stats.forEach((stat) => {
      const eventKey = normalizeEventKey(stat.event);
      const seconds = parseMarkToSeconds(stat.displayMark || stat.mark);

      if (!Number.isFinite(seconds)) {
        return;
      }

      if (!bestMarks[eventKey] || seconds < bestMarks[eventKey]) {
        bestMarks[eventKey] = seconds;
      }
    });
  });

  return bestMarks;
}

function getDatasetYearRange() {
  const years = runnerData.map((runner) => runner.year).filter((year) => Number.isFinite(year));

  if (!years.length) {
    return { min: 0, max: 0 };
  }

  return {
    min: Math.min(...years),
    max: Math.max(...years)
  };
}

function getEraBaselineMultiplier(year) {
  const { min, max } = DATASET_YEAR_RANGE;
  const span = Math.max(max - min, 1);
  const historicalShare = Math.max(0, Math.min(1, (max - year) / span));
  const pre2000Boost = year < 2000 ? Math.min((2000 - year) / 40, 1) * 0.05 : 0;
  const pre1980Boost = year < 1980 ? Math.min((1980 - year) / 20, 1) * 0.03 : 0;

  return 1 + historicalShare * 0.1 + pre2000Boost + pre1980Boost;
}

function getRunnerBaselineScore(runner, bestMarksByEvent) {
  return (
    (getBaselineStatScore(bestMarksByEvent) + getBaselineAchievementScore(runner.achievements)) *
    getEraBaselineMultiplier(runner.year)
  );
}

function getStartingScoreByRunnerId() {
  const orderedRunners = runnerData
    .map((runner) => {
      const bestMarksByEvent = getRunnerBestMarksByEvent(runner);

      return {
        ...runner,
        bestMarksByEvent,
        baselineScore: getRunnerBaselineScore(runner, bestMarksByEvent)
      };
    })
    .sort(
      (left, right) =>
        getDefaultOrderRank(left.name) - getDefaultOrderRank(right.name) ||
        right.baselineScore - left.baselineScore ||
        left.seedRank - right.seedRank
    );

  return orderedRunners.reduce((scoreMap, runner, index) => {
    scoreMap[runner.id] = Math.max(STARTING_TOP_SCORE - index, 1);
    return scoreMap;
  }, {});
}

function refreshComputedState() {
  defaultOrder = buildCompleteDefaultOrder(defaultOrder.length ? defaultOrder : CURATED_DEFAULT_ORDER);
  defaultOrderIndex = buildDefaultOrderIndex(defaultOrder);
  DATASET_EVENT_BESTS = getDatasetEventBestMarks();
  DATASET_YEAR_RANGE = getDatasetYearRange();
  STARTING_SCORE_BY_ID = getStartingScoreByRunnerId();
  populateEventSortOptions();
}

function applyDefaultOrder(order, { clearVotes = false, persist = true } = {}) {
  defaultOrder = buildCompleteDefaultOrder(order);
  defaultOrderIndex = buildDefaultOrderIndex(defaultOrder);

  if (persist) {
    saveDefaultOrder(defaultOrder);
  }

  STARTING_SCORE_BY_ID = getStartingScoreByRunnerId();

  if (clearVotes && !remoteState.enabled) {
    voteStore = {};
    localStorage.removeItem(STORAGE_KEY);
  }
}

function getSortedRunnerNamesForCurrentVotes(startingScoreById) {
  const orderedRunners = runnerData
    .map((runner) => {
      const votes = getVoteTotals(runner.id);
      const bestMarksByEvent = getRunnerBestMarksByEvent(runner);

      return {
        ...runner,
        votes,
        engagement: votes.up + votes.down,
        score: (startingScoreById[runner.id] ?? 0) + votes.up - votes.down,
        baselineScore: getRunnerBaselineScore(runner, bestMarksByEvent)
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.votes.up - left.votes.up ||
        right.engagement - left.engagement ||
        getDefaultOrderRank(left.name) - getDefaultOrderRank(right.name) ||
        right.baselineScore - left.baselineScore ||
        left.seedRank - right.seedRank
    );

  return orderedRunners.map((runner) => runner.name);
}

function promoteCurrentVoteOrderToDefaultIfNeeded() {
  if (remoteState.enabled || localStorage.getItem(DEFAULT_ORDER_STORAGE_KEY) || !hasVoteChanges(voteStore)) {
    return;
  }

  const startingScoreById = getStartingScoreByRunnerId();
  defaultOrder = buildCompleteDefaultOrder(getSortedRunnerNamesForCurrentVotes(startingScoreById));
  defaultOrderIndex = buildDefaultOrderIndex(defaultOrder);
  saveDefaultOrder(defaultOrder);
  voteStore = {};
  localStorage.removeItem(STORAGE_KEY);
}

function forceCurrentOrderToDefaultOnce() {
  if (remoteState.enabled) {
    return;
  }

  if (localStorage.getItem(FORCE_DEFAULT_SYNC_STORAGE_KEY) === FORCE_DEFAULT_SYNC_VERSION) {
    return;
  }

  const startingScoreById = getStartingScoreByRunnerId();
  defaultOrder = buildCompleteDefaultOrder(getSortedRunnerNamesForCurrentVotes(startingScoreById));
  defaultOrderIndex = buildDefaultOrderIndex(defaultOrder);
  saveDefaultOrder(defaultOrder);
  voteStore = {};
  localStorage.removeItem(STORAGE_KEY);
  localStorage.setItem(FORCE_DEFAULT_SYNC_STORAGE_KEY, FORCE_DEFAULT_SYNC_VERSION);
}

function initializeLocalDefaults() {
  defaultOrder = buildCompleteDefaultOrder(defaultOrder);
  defaultOrderIndex = buildDefaultOrderIndex(defaultOrder);
  DATASET_EVENT_BESTS = getDatasetEventBestMarks();
  DATASET_YEAR_RANGE = getDatasetYearRange();
  promoteCurrentVoteOrderToDefaultIfNeeded();
  forceCurrentOrderToDefaultOnce();
  refreshComputedState();
}

function isSharedModeConfigured() {
  return Boolean(SUPABASE_CONFIG.enabled && SUPABASE_CONFIG.url);
}

function getVoteFunctionUrl() {
  const baseUrl = String(SUPABASE_CONFIG.url || "").replace(/\/$/, "");
  const functionName = String(SUPABASE_CONFIG.voteFunctionName || "ip-votes").trim() || "ip-votes";
  return `${baseUrl}/functions/v1/${functionName}`;
}

async function invokeVoteApi({ method = "GET", payload } = {}) {
  if (!remoteState.voteApiUrl) {
    throw new Error("Vote service URL is not configured.");
  }

  const headers = {
    "Content-Type": "application/json"
  };

  if (SUPABASE_CONFIG.anonKey) {
    headers.apikey = SUPABASE_CONFIG.anonKey;
  }

  const response = await fetch(remoteState.voteApiUrl, {
    method,
    headers,
    body: payload === undefined ? undefined : JSON.stringify(payload)
  });

  let data = null;

  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok || data?.error) {
    throw new Error(data?.error || `Vote service returned ${response.status}.`);
  }

  return data || {};
}

function applyRemoteVoteSnapshot(snapshot) {
  remoteState.voteTotalsByRunnerId = snapshot?.totals || {};
  remoteState.ownVotesByRunnerId = snapshot?.ownVotes || {};

  if (snapshot?.message) {
    remoteState.statusMessage = snapshot.message;
  }

  remoteState.authMessage =
    snapshot?.meta || "One vote per runner per IP address. No sign-in required.";
}

function getRemoteVoteAggregateRows() {
  return Object.entries(remoteState.voteTotalsByRunnerId).map(([runnerId, totals]) => ({
    runnerId,
    ...totals
  }));
}

async function loadRemoteVotes({ silent = false } = {}) {
  if (!remoteState.enabled) {
    return;
  }

  try {
    const snapshot = await invokeVoteApi();
    applyRemoteVoteSnapshot(snapshot);
  } catch (error) {
    remoteState.statusMessage = `Shared votes could not load: ${error.message}`;
    remoteState.authMessage = "Shared voting is enabled, but the vote service is not responding yet.";
    remoteState.voteTotalsByRunnerId = {};
    remoteState.ownVotesByRunnerId = {};

    if (!silent) {
      render();
    }
    return;
  }

  if (!silent) {
    render();
  }
}

async function loadRemoteData({ silent = false } = {}) {
  runnerData = cloneRunnerData(LOCAL_RUNNER_DATA);
  defaultOrder = buildCompleteDefaultOrder(loadDefaultOrder() || CURATED_DEFAULT_ORDER);
  remoteState.statusMessage = "Shared voting is live. Runner data comes from the bundled app list.";
  refreshComputedState();

  if (!silent) {
    render();
  }
}

function startRemotePolling() {
  if (remoteState.pollHandle) {
    clearInterval(remoteState.pollHandle);
  }

  if (!remoteState.enabled) {
    return;
  }

  remoteState.pollHandle = setInterval(() => {
    void loadRemoteVotes();
  }, REMOTE_POLL_INTERVAL_MS);
}

async function initializeSharedMode() {
  if (!isSharedModeConfigured()) {
    remoteState.enabled = false;
    remoteState.statusMessage = "Local-only mode. Votes are stored in this browser.";
    remoteState.authMessage = "Shared mode is not configured yet. When enabled, each IP gets one vote per runner.";
    return;
  }

  remoteState.enabled = true;
  remoteState.voteApiUrl = getVoteFunctionUrl();
  remoteState.statusMessage = "Connecting to shared vote service...";
  remoteState.authMessage = "One vote per runner per IP address. No sign-in required.";

  await loadRemoteData({ silent: true });
  await loadRemoteVotes({ silent: true });
  startRemotePolling();

  render();
}

function getLocalVoteTotals(runnerId) {
  const entry = voteStore[runnerId] || {};
  return {
    up: Number(entry.up) || 0,
    down: Number(entry.down) || 0,
    ownValue: 0
  };
}

function getVoteTotals(runnerId) {
  if (!remoteState.enabled) {
    return getLocalVoteTotals(runnerId);
  }

  const remoteTotals = remoteState.voteTotalsByRunnerId[runnerId] || { up: 0, down: 0 };
  return {
    up: remoteTotals.up || 0,
    down: remoteTotals.down || 0,
    ownValue: remoteState.ownVotesByRunnerId[runnerId] || 0
  };
}

function getCurrentBoardOrderNames() {
  return getVisibleRunners().map((runner) => runner.name);
}

async function setCurrentOrderAsDefault() {
  if (!canUseCuratorTools()) {
    window.alert(getCuratorToolBlockReason());
    return;
  }

  const shouldSet = window.confirm(
    "Save the current board order as the new default for this app? Shared vote totals will stay in place."
  );
  if (!shouldSet) {
    return;
  }

  applyDefaultOrder(getCurrentBoardOrderNames(), {
    clearVotes: false,
    persist: true
  });

  state.curatorMode = false;
  clearDragState();
  render();
}

async function toggleCuratorMode() {
  if (state.curatorMode) {
    state.curatorMode = false;
    clearDragState();
    render();
    return;
  }

  if (!canUseCuratorTools()) {
    window.alert(getCuratorToolBlockReason());
    return;
  }

  if (hasVoteChanges(voteStore) && !remoteState.enabled) {
    const shouldConvert = window.confirm(
      "Curator mode edits the saved default order directly. Use the current board order as the new default and clear device-local vote changes first?"
    );

    if (!shouldConvert) {
      return;
    }

    applyDefaultOrder(getCurrentBoardOrderNames(), { clearVotes: true, persist: true });
  }

  state.curatorMode = true;
  clearDragState();
  render();
}

function moveRunnerInDefaultOrder(draggedRunnerId, targetRunnerId, placeAfter) {
  const draggedRunnerName = getRunnerNameById(draggedRunnerId);
  const targetRunnerName = getRunnerNameById(targetRunnerId);

  if (!draggedRunnerName || !targetRunnerName || draggedRunnerName === targetRunnerName) {
    return;
  }

  const nextOrder = defaultOrder.filter((runnerName) => runnerName !== draggedRunnerName);
  const targetIndex = nextOrder.indexOf(targetRunnerName);

  if (targetIndex === -1) {
    nextOrder.push(draggedRunnerName);
  } else {
    nextOrder.splice(targetIndex + (placeAfter ? 1 : 0), 0, draggedRunnerName);
  }

  applyDefaultOrder(nextOrder, { persist: true });
}

function getEventOptions() {
  const seenEvents = new Set();
  const options = [];

  runnerData.forEach((runner) => {
    runner.stats.forEach((stat) => {
      const eventKey = normalizeEventKey(stat.event);

      if (seenEvents.has(eventKey)) {
        return;
      }

      seenEvents.add(eventKey);
      options.push(eventKey);
    });
  });

  options.sort((leftEvent, rightEvent) => {
    const leftInfo = getAppEventSortInfo(leftEvent);
    const rightInfo = getAppEventSortInfo(rightEvent);

    return (
      leftInfo.categoryRank - rightInfo.categoryRank ||
      leftInfo.distance - rightInfo.distance ||
      leftInfo.variantRank - rightInfo.variantRank ||
      collator.compare(formatMileDisplayText(leftEvent), formatMileDisplayText(rightEvent))
    );
  });

  return options;
}

function populateEventSortOptions() {
  const eventOptions = getEventOptions();

  eventSortSelect.innerHTML = [
    `<option value="">All runners</option>`,
    ...eventOptions.map(
      (eventLabel) =>
        `<option value="${escapeHtml(eventLabel)}">${escapeHtml(
          formatMileDisplayText(eventLabel)
        )}</option>`
    )
  ].join("");

  if (state.selectedEvent && !eventOptions.includes(state.selectedEvent)) {
    state.selectedEvent = "";
  }

  eventSortSelect.value = state.selectedEvent;
}

function enrichRunner(runner) {
  const votes = getVoteTotals(runner.id);
  const seedScore = STARTING_SCORE_BY_ID[runner.id] ?? 0;
  const voteDelta = votes.up - votes.down;
  const score = seedScore + voteDelta;
  const engagement = votes.up + votes.down;
  const bestMarksByEvent = getRunnerBestMarksByEvent(runner);
  const searchBlob = [
    runner.name,
    runner.season,
    ...runner.stats.map((stat) => `${stat.event} ${stat.note ? `${stat.note} ` : ""}${stat.mark}`),
    ...runner.achievements
  ]
    .join(" ")
    .toLowerCase();

  return {
    ...runner,
    votes,
    seedScore,
    voteDelta,
    score,
    engagement,
    bestMarksByEvent,
    baselineScore: getRunnerBaselineScore(runner, bestMarksByEvent),
    searchBlob
  };
}

function sortRunners(runners) {
  const sorted = [...runners];

  sorted.sort((left, right) => {
    let comparison = 0;

    if (state.selectedEvent) {
      const leftMark = left.bestMarksByEvent[state.selectedEvent]?.seconds ?? Number.POSITIVE_INFINITY;
      const rightMark =
        right.bestMarksByEvent[state.selectedEvent]?.seconds ?? Number.POSITIVE_INFINITY;

      comparison = leftMark - rightMark || collator.compare(left.name, right.name);
    } else if (state.sort === "name") {
      comparison = collator.compare(left.name, right.name);
    } else if (state.sort === "year") {
      comparison = left.year - right.year || collator.compare(left.name, right.name);
    } else {
      comparison =
        right.score - left.score ||
        right.votes.up - left.votes.up ||
        right.engagement - left.engagement ||
        getDefaultOrderRank(left.name) - getDefaultOrderRank(right.name) ||
        right.baselineScore - left.baselineScore ||
        left.seedRank - right.seedRank;
    }

    if (comparison === 0) {
      return 0;
    }

    return state.isReverseSort ? comparison * -1 : comparison;
  });

  return sorted;
}

function getVisibleRunners() {
  const enriched = runnerData.map(enrichRunner);
  const query = state.search.trim().toLowerCase();
  let filtered = query
    ? enriched.filter((runner) => runner.searchBlob.includes(query))
    : enriched;

  if (state.selectedEvent) {
    filtered = filtered.filter((runner) => Boolean(runner.bestMarksByEvent[state.selectedEvent]));
  }

  return sortRunners(filtered);
}

function ensureActiveRunner(runners) {
  if (!runners.length) {
    state.activeRunnerId = null;
    return;
  }

  const activeStillVisible = runners.some((runner) => runner.id === state.activeRunnerId);
  if (!activeStillVisible) {
    state.activeRunnerId = runners[0].id;
  }
}

function getRunnerById(runners, runnerId) {
  return runners.find((runner) => runner.id === runnerId) || null;
}

function getSortLabel() {
  if (state.selectedEvent) {
    return `${formatMileDisplayText(state.selectedEvent)} time`;
  }

  if (state.sort === "year") {
    return "year";
  }

  if (state.sort === "name") {
    return "name";
  }

  return "votes";
}

function getSortDirectionLabel() {
  if (state.selectedEvent) {
    return state.isReverseSort ? "slowest first" : "fastest first";
  }

  if (state.sort === "score") {
    return state.isReverseSort ? "ascending" : "descending";
  }

  return state.isReverseSort ? "descending" : "ascending";
}

function formatScore(score) {
  return String(score);
}

function getFillWidth(runner, index, runners, range) {
  const total = Math.max(runners.length - 1, 1);
  const rankBias = 1 - index / total;
  const engagementBoost = Math.min(runner.engagement * 2, 10);

  if (range.max === range.min) {
    return Math.round(34 + rankBias * 24 + engagementBoost);
  }

  const normalized = (runner.score - range.min) / (range.max - range.min);
  return Math.round(24 + normalized * 52 + engagementBoost);
}

function getFillColor(runner) {
  if (runner.voteDelta > 0) {
    return "rgba(31, 78, 140, 0.24)";
  }

  if (runner.voteDelta < 0) {
    return "rgba(201, 53, 66, 0.22)";
  }

  return "rgba(63, 109, 180, 0.14)";
}

function syncDragIndicators() {
  rankingList.querySelectorAll("[data-runner-card]").forEach((card) => {
    const runnerId = card.dataset.runnerCard;

    card.classList.toggle("is-dragging", runnerId === dragState.draggedRunnerId);
    card.classList.toggle(
      "is-drop-before",
      runnerId === dragState.dropTargetId && !dragState.placeAfter
    );
    card.classList.toggle(
      "is-drop-after",
      runnerId === dragState.dropTargetId && dragState.placeAfter
    );
  });
}

function clearDragIndicators() {
  clearDragState();
  syncDragIndicators();
}
function renderConnectionPanel() {
  if (!remoteState.enabled) {
    connectionBadge.textContent = "Local";
    connectionStatus.textContent = "Local-only mode. Votes are stored in this browser.";
    authStatus.textContent =
      "Shared mode is not configured yet. When enabled, each IP gets one vote per runner.";
    return;
  }

  connectionBadge.textContent = "Shared";
  connectionStatus.textContent = remoteState.statusMessage;
  authStatus.textContent =
    remoteState.authMessage || "One vote per runner per IP address. No sign-in required.";
}

function renderSummary(runners) {
  const totalVotes = remoteState.enabled
    ? getRemoteVoteAggregateRows().reduce((sum, row) => sum + row.up + row.down, 0)
    : runners.reduce((sum, runner) => sum + runner.engagement, 0);
  const leader = runners[0];
  const mostActive = [...runners].sort(
    (left, right) =>
      right.engagement - left.engagement ||
      right.score - left.score ||
      left.seedRank - right.seedRank
  )[0];
  const yearSpan =
    runners.length > 0
      ? `${Math.min(...runners.map((runner) => runner.year))} - ${Math.max(
          ...runners.map((runner) => runner.year)
        )}`
      : "No results";

  const cards = [
    {
      label: "Runners",
      value: String(runners.length),
      meta: remoteState.enabled
        ? "The shared board uses the bundled runner list and syncs vote totals online."
        : "All supplied athletes are loaded into the board."
    },
    {
      label: "Votes Cast",
      value: String(totalVotes),
      meta: remoteState.enabled
        ? "Shared vote totals from all visitors, limited to one vote per runner per IP."
        : "Device-local tallies that reorder the ranking live."
    },
    {
      label: "Current Leader",
      value: leader ? leader.name : "None",
      meta: leader ? `${formatScore(leader.score)} score in ${leader.season}` : "Vote to start the board."
    },
    {
      label: "Most Active",
      value: mostActive ? mostActive.name : "None",
      meta: mostActive
        ? `${mostActive.engagement} total votes across the board.`
        : `Season range ${yearSpan}.`
    }
  ];

  summaryCards.innerHTML = cards
    .map(
      (card) => `
        <article class="summary-card">
          <p class="summary-card__label">${escapeHtml(card.label)}</p>
          <p class="summary-card__value">${escapeHtml(card.value)}</p>
          <p class="summary-card__meta">${escapeHtml(card.meta)}</p>
        </article>
      `
    )
    .join("");
}

function renderRunnerCards(runners) {
  if (!runners.length) {
    rankingList.innerHTML = `
      <div class="empty-state">
        <h3>No runners match that search.</h3>
        <p>Try a different year, name, event, or meet name to pull athletes back into view.</p>
      </div>
    `;
    return;
  }

  const range = runners.reduce(
    (accumulator, runner) => ({
      min: Math.min(accumulator.min, runner.score),
      max: Math.max(accumulator.max, runner.score)
    }),
    { min: 0, max: 0 }
  );
  const isCuratorDragEnabled = state.curatorMode && canUseCuratorTools();

  rankingList.innerHTML = runners
    .map((runner, index) => {
      const scoreToneClass =
        runner.score > 0 ? "is-positive" : runner.score < 0 ? "is-negative" : "";
      const dropClass =
        dragState.dropTargetId === runner.id
          ? dragState.placeAfter
            ? " is-drop-after"
            : " is-drop-before"
          : "";
      const upSelected = runner.votes.ownValue === 1 ? " is-selected" : "";
      const downSelected = runner.votes.ownValue === -1 ? " is-selected" : "";

      return `
        <article
          class="runner-card ${runner.id === state.activeRunnerId ? "is-active" : ""}${
            isCuratorDragEnabled ? " is-draggable" : ""
          }${dragState.draggedRunnerId === runner.id ? " is-dragging" : ""}${dropClass}"
          data-runner-card="${escapeHtml(runner.id)}"
          draggable="${isCuratorDragEnabled ? "true" : "false"}"
          style="--fill-width: ${getFillWidth(runner, index, runners, range)}%; --fill-color: ${getFillColor(
            runner
          )};"
        >
          <div class="runner-card__content">
            <div class="runner-card__rank">${index + 1}</div>

            <button class="runner-card__open" type="button" data-open-id="${escapeHtml(runner.id)}">
              <div class="runner-card__title">
                <h3>${escapeHtml(runner.name)}</h3>
                <span class="runner-card__season">${escapeHtml(runner.season)}</span>
              </div>
              <p class="runner-card__meta">${
                state.curatorMode
                  ? "Drag to reorder or select to view stats and achievements."
                  : "Select to view stats and achievements."
              }</p>
            </button>

            <div class="runner-card__votes">
              <div class="score-block ${scoreToneClass}">
                <span class="score-block__label">Score</span>
                <strong>${escapeHtml(formatScore(runner.score))}</strong>
                <span class="score-block__counts">
                  ${escapeHtml(`${runner.votes.up} up / ${runner.votes.down} down`)}
                </span>
              </div>

              <div class="vote-stack">
                <button
                  class="vote-button vote-button--up${upSelected}"
                  type="button"
                  data-runner-id="${escapeHtml(runner.id)}"
                  data-vote-type="up"
                >
                  Upvote
                </button>
                <button
                  class="vote-button vote-button--down${downSelected}"
                  type="button"
                  data-runner-id="${escapeHtml(runner.id)}"
                  data-vote-type="down"
                >
                  Downvote
                </button>
              </div>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderAdminPanel() {
  return "";
}

function renderDetailPanel(activeRunner) {
  if (!activeRunner) {
    detailPanel.innerHTML = `
      <div class="detail-panel__inner">
        <div class="detail-placeholder">
          <p class="eyebrow">Runner profile</p>
          <h2>Pick a runner from the board.</h2>
          <p class="detail-copy">
            The right-hand panel will show event marks, achievements, and live voting controls.
          </p>
        </div>
        ${renderAdminPanel(null)}
      </div>
    `;
    return;
  }

  const statMarkup = activeRunner.stats.length
    ? activeRunner.stats
        .map(
          (stat) => `
            <li class="stat-item">
              <span class="stat-item__event">
                ${escapeHtml(`${formatMileDisplayText(stat.event)}${stat.isIndoor ? " (indoors)" : ""}`)}
                ${stat.note ? `<span class="stat-item__note">${escapeHtml(stat.note)}</span>` : ""}
              </span>
              <span class="stat-item__mark">${escapeHtml(stat.displayMark || stat.mark)}</span>
            </li>
          `
        )
        .join("")
    : `
      <li class="stat-item">
        <span class="stat-item__event">No timed marks</span>
        <span class="stat-item__mark">-</span>
      </li>
    `;

  const achievementMarkup = activeRunner.achievements.length
    ? activeRunner.achievements
        .map(
          (achievement) => `
            <li class="achievement-item">${escapeHtml(formatMileDisplayText(achievement))}</li>
          `
        )
        .join("")
    : `
      <li class="achievement-item">No extra notes were included for this runner.</li>
    `;

  const upSelected = activeRunner.votes.ownValue === 1 ? " is-selected" : "";
  const downSelected = activeRunner.votes.ownValue === -1 ? " is-selected" : "";
  const voteMeta = remoteState.enabled
    ? `${activeRunner.votes.up} shared upvotes and ${activeRunner.votes.down} shared downvotes.${
        activeRunner.votes.ownValue === 1
          ? " This IP's vote: upvote."
          : activeRunner.votes.ownValue === -1
            ? " This IP's vote: downvote."
            : " This IP has not voted on this runner yet."
      }`
    : `${activeRunner.votes.up} upvotes and ${activeRunner.votes.down} downvotes on this device.`;

  detailPanel.innerHTML = `
    <div class="detail-panel__inner">
      <div class="detail-panel__hero">
        <p class="eyebrow">Runner profile</p>
        <h2>${escapeHtml(activeRunner.name)}</h2>
        <div class="detail-panel__tags">
          <span class="detail-badge">${escapeHtml(activeRunner.season)}</span>
          <span class="detail-badge">${escapeHtml(`${activeRunner.stats.length} event marks`)}</span>
          <span class="detail-badge">${escapeHtml(
            `${activeRunner.achievements.length} achievements`
          )}</span>
        </div>
      </div>

      <div class="detail-score">
        <div class="detail-score__top">
          <div>
            <div class="detail-score__value">${escapeHtml(formatScore(activeRunner.score))}</div>
            <div class="detail-score__meta">${escapeHtml(voteMeta)}</div>
          </div>

          <div class="vote-stack">
            <button
              class="detail-vote-button detail-vote-button--up${upSelected}"
              type="button"
              data-runner-id="${escapeHtml(activeRunner.id)}"
              data-vote-type="up"
            >
              Upvote
            </button>
            <button
              class="detail-vote-button detail-vote-button--down${downSelected}"
              type="button"
              data-runner-id="${escapeHtml(activeRunner.id)}"
              data-vote-type="down"
            >
              Downvote
            </button>
          </div>
        </div>
      </div>

      <section class="detail-section">
        <h3>Event Marks</h3>
        <ul class="stat-list">${statMarkup}</ul>
      </section>

      <section class="detail-section">
        <h3>Achievements</h3>
        <ul class="achievement-list">${achievementMarkup}</ul>
      </section>

      ${renderAdminPanel(activeRunner)}
    </div>
  `;
}

function render() {
  if (state.curatorMode && !canUseCuratorTools()) {
    state.curatorMode = false;
    clearDragState();
  }

  syncSortButtons();
  renderConnectionPanel();

  const visibleRunners = getVisibleRunners();
  ensureActiveRunner(visibleRunners);
  const activeRunner = getRunnerById(visibleRunners, state.activeRunnerId);

  const baseMeta = `${visibleRunners.length} runners shown, sorted by ${getSortLabel()} ${getSortDirectionLabel()}.`;
  boardMeta.textContent = state.curatorMode
    ? `Curator mode is on. Drag cards to reorder the saved default board. ${baseMeta}`
    : baseMeta;
  renderSummary(visibleRunners);
  renderRunnerCards(visibleRunners);
  renderDetailPanel(activeRunner);
}

async function castRemoteVote(runnerId, voteType) {
  if (!remoteState.enabled) {
    return;
  }

  const nextValue = voteType === "up" ? 1 : -1;
  const currentValue = remoteState.ownVotesByRunnerId[runnerId] || 0;
  const desiredValue = currentValue === nextValue ? 0 : nextValue;

  try {
    const snapshot = await invokeVoteApi({
      method: "POST",
      payload: {
        runnerId,
        value: desiredValue
      }
    });

    applyRemoteVoteSnapshot(snapshot);
  } catch (error) {
    window.alert(`Shared vote failed: ${error.message}`);
    return;
  }

  state.activeRunnerId = runnerId;
  render();
}

async function castVote(runnerId, voteType) {
  if (remoteState.enabled) {
    await castRemoteVote(runnerId, voteType);
    return;
  }

  const currentTotals = getLocalVoteTotals(runnerId);
  currentTotals[voteType] += 1;
  voteStore[runnerId] = currentTotals;
  state.activeRunnerId = runnerId;
  saveVoteStore();
  render();
}

async function resetVotes() {
  if (remoteState.enabled) {
    const shouldReset = window.confirm("Clear this IP's shared votes across all runners?");
    if (!shouldReset) {
      return;
    }

    try {
      const snapshot = await invokeVoteApi({ method: "DELETE" });
      applyRemoteVoteSnapshot(snapshot);
    } catch (error) {
      window.alert(`Shared vote reset failed: ${error.message}`);
      return;
    }

    render();
    return;
  }

  const shouldReset = window.confirm(
    "Reset all device-local vote changes and return to the starting rank scores?"
  );
  if (!shouldReset) {
    return;
  }

  voteStore = {};
  localStorage.removeItem(STORAGE_KEY);
  render();
}

function syncSortButtons() {
  sortButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.sort === state.sort);
  });

  const curatorToolsReady = canUseCuratorTools();
  reverseSortButton.classList.toggle("is-active", state.isReverseSort);
  reverseSortButton.textContent = state.isReverseSort ? "Normal Order" : "Reverse Order";
  reverseSortButton.setAttribute("aria-pressed", String(state.isReverseSort));

  curatorModeButton.classList.toggle("is-active", state.curatorMode);
  curatorModeButton.textContent = state.curatorMode ? "Exit Curator Mode" : "Curator Mode";
  curatorModeButton.setAttribute("aria-pressed", String(state.curatorMode));
  curatorModeButton.disabled = !curatorToolsReady && !state.curatorMode;
  curatorModeButton.title = state.curatorMode ? "" : getCuratorToolBlockReason();

  setDefaultOrderButton.textContent = "Set Current Order As Default";
  setDefaultOrderButton.disabled = !curatorToolsReady;
  setDefaultOrderButton.title = curatorToolsReady ? "" : getCuratorToolBlockReason();

  resetVotesButton.textContent = remoteState.enabled ? "Clear Shared Votes" : "Reset device votes";
}

function bindEvents() {
  searchInput.addEventListener("input", (event) => {
    state.search = event.target.value;
    render();
  });

  eventSortSelect.addEventListener("change", (event) => {
    state.selectedEvent = event.target.value;
    render();
  });

  sortButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.sort = button.dataset.sort;
      render();
    });
  });

  reverseSortButton.addEventListener("click", () => {
    state.isReverseSort = !state.isReverseSort;
    render();
  });

  curatorModeButton.addEventListener("click", () => {
    void toggleCuratorMode();
  });

  setDefaultOrderButton.addEventListener("click", () => {
    void setCurrentOrderAsDefault();
  });

  resetVotesButton.addEventListener("click", () => {
    void resetVotes();
  });

  window.addEventListener("focus", () => {
    if (remoteState.enabled) {
      void loadRemoteVotes({ silent: false });
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (remoteState.enabled && document.visibilityState === "visible") {
      void loadRemoteVotes({ silent: false });
    }
  });

  rankingList.addEventListener("dragstart", (event) => {
    if (!state.curatorMode || !canUseCuratorTools()) {
      return;
    }

    const card = event.target.closest("[data-runner-card]");
    if (!card) {
      return;
    }

    dragState.draggedRunnerId = card.dataset.runnerCard;
    dragState.dropTargetId = null;
    dragState.placeAfter = false;

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", dragState.draggedRunnerId);
    }

    syncDragIndicators();
  });

  rankingList.addEventListener("dragover", (event) => {
    if (!state.curatorMode || !canUseCuratorTools() || !dragState.draggedRunnerId) {
      return;
    }

    const card = event.target.closest("[data-runner-card]");
    if (!card || card.dataset.runnerCard === dragState.draggedRunnerId) {
      return;
    }

    event.preventDefault();

    const cardBounds = card.getBoundingClientRect();
    dragState.dropTargetId = card.dataset.runnerCard;
    dragState.placeAfter = event.clientY > cardBounds.top + cardBounds.height / 2;
    syncDragIndicators();
  });

  rankingList.addEventListener("drop", (event) => {
    if (!state.curatorMode || !canUseCuratorTools() || !dragState.draggedRunnerId) {
      return;
    }

    event.preventDefault();

    if (dragState.dropTargetId) {
      moveRunnerInDefaultOrder(
        dragState.draggedRunnerId,
        dragState.dropTargetId,
        dragState.placeAfter
      );
    }

    clearDragIndicators();
    render();
  });

  rankingList.addEventListener("dragend", () => {
    clearDragIndicators();
  });

  document.addEventListener("click", (event) => {
    const voteButton = event.target.closest("[data-vote-type][data-runner-id]");
    if (voteButton) {
      void castVote(voteButton.dataset.runnerId, voteButton.dataset.voteType);
      return;
    }

    const openButton = event.target.closest("[data-open-id]");
    if (openButton) {
      state.activeRunnerId = openButton.dataset.openId;
      render();
    }
  });
}

async function boot() {
  initializeLocalDefaults();
  bindEvents();
  state.activeRunnerId = runnerData[0]?.id || null;
  render();
  await initializeSharedMode();
}

void boot();
