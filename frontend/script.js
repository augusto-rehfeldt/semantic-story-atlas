const API_BASE = `${window.location.origin}/api`;

// Cover generation utilities
const coverEmojis = ['📚', '📖', '📕', '📗', '📘', '📙', '🏰', '🐉', '⚔️', '🌟',
    '🔮', '🗡️', '🌙', '☀️', '🌊', '🔥', '❄️', '🌸', '🦋', '🎭',
    '👑', '💎', '🗝️', '🧙', '🧚', '🦄', '🐺', '🦅', '🌲', '🏔️'];

const colorPairs = [
    ['#6366f1', '#8b5cf6'], ['#ec4899', '#f43f5e'], ['#14b8a6', '#06b6d4'],
    ['#f59e0b', '#ef4444'], ['#10b981', '#059669'], ['#8b5cf6', '#d946ef'],
    ['#3b82f6', '#6366f1'], ['#f97316', '#fbbf24'], ['#06b6d4', '#22d3ee'],
    ['#84cc16', '#22c55e'], ['#a855f7', '#ec4899'], ['#0ea5e9', '#38bdf8']
];

function generateCover(title) {
    const hash = title.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const emoji = coverEmojis[hash % coverEmojis.length];
    const colors = colorPairs[hash % colorPairs.length];
    return { emoji, colors };
}

function normalizeSeriesKey(series, author = '') {
    return `${(series || '').trim().toLowerCase()}::${(author || '').trim().toLowerCase()}`;
}

function getStoryAuthor(story) {
  return (story?.author || story?.authors || '').trim();
}

function formatAuthors(authorStr, max = 2) {
  if (!authorStr) return '';
  const separators = /[,;&]|\band\b/i;
  const authors = authorStr.split(separators).map(a => a.trim()).filter(Boolean);
  if (authors.length <= max) return authors.join(', ');
  return authors.slice(0, max).join(', ') + ', \u2026';
}

function parseSeriesIndex(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function getStorySimilarity(storyId) {
    const result = currentResults.get(storyId);
    return result ? result.similarity : null;
}

function getStoryRank(storyId) {
    const result = currentResults.get(storyId);
    return result ? result.rank : null;
}

function getStoryDisplayGroupId(storyId) {
    return storyToGroupId.get(storyId) || storyId;
}

const KEEP_IN_VIEW_MARGIN = 12;
const SCROLL_ANIMATION_DURATION = 240;

function getScrollableAncestor(element) {
    let parent = element.parentElement;
    while (parent) {
        const style = window.getComputedStyle(parent);
        const overflowY = style.overflowY;
        const canScroll = /(auto|scroll|overlay)/.test(overflowY) && parent.scrollHeight > parent.clientHeight;
        if (canScroll) {
            return parent;
        }
        parent = parent.parentElement;
    }
    return document.scrollingElement || document.documentElement;
}

function isElementFullyVisibleInContainer(element, container) {
    const elementRect = element.getBoundingClientRect();
    const containerRect = container === document.scrollingElement || container === document.documentElement
        ? {
            top: 0,
            bottom: window.innerHeight,
        }
        : container.getBoundingClientRect();

    return elementRect.top >= containerRect.top && elementRect.bottom <= containerRect.bottom;
}

function animateScrollTo(container, targetTop) {
    const isWindowScroll = container === document.scrollingElement || container === document.documentElement;
    const startTop = isWindowScroll ? window.scrollY : container.scrollTop;
    const distance = targetTop - startTop;
    const startTime = performance.now();

    function step(now) {
        const progress = Math.min((now - startTime) / SCROLL_ANIMATION_DURATION, 1);
        const eased = easeOutCubic(progress);
        const nextTop = startTop + distance * eased;

        if (isWindowScroll) {
            window.scrollTo(0, nextTop);
        } else {
            container.scrollTop = nextTop;
        }

        if (progress < 1) {
            requestAnimationFrame(step);
        }
    }

    requestAnimationFrame(step);
}

function scrollElementIntoViewIfNeeded(element) {
    const container = getScrollableAncestor(element);
    if (isElementFullyVisibleInContainer(element, container)) {
        return;
    }

    const elementRect = element.getBoundingClientRect();
    const containerRect = container === document.scrollingElement || container === document.documentElement
        ? {
            top: 0,
            bottom: window.innerHeight,
        }
        : container.getBoundingClientRect();

    const topDelta = elementRect.top - containerRect.top - KEEP_IN_VIEW_MARGIN;
    const bottomDelta = elementRect.bottom - containerRect.bottom + KEEP_IN_VIEW_MARGIN;

    let delta = 0;
    if (topDelta < 0) {
        delta = topDelta;
    } else if (bottomDelta > 0) {
        delta = bottomDelta;
    }

    if (!delta) return;

    const targetTop = (container === document.scrollingElement || container === document.documentElement)
        ? window.scrollY + delta
        : container.scrollTop + delta;

    animateScrollTo(container, targetTop);
}

function updateZoomIndicator() {
    if (!zoomIndicator || !zoomIndicatorText) return;

    const isZoomed = zoomLevel !== 1 || panOffsetX !== 0 || panOffsetY !== 0;
    zoomIndicatorText.textContent = `${Math.round(zoomLevel * 100)}%`;
    zoomIndicator.classList.toggle('visible', isZoomed);
}

function getScreenPoint(worldX, worldY) {
    return {
        x: worldX * zoomLevel + panOffsetX,
        y: worldY * zoomLevel + panOffsetY,
    };
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function getDotVisualScale() {
    return 1 / (1 + (zoomLevel - 1) * 0.45);
}

function fitScreenText(text, maxWidth, baseSize, minSize, fontFamily = 'Inter, sans-serif', fontWeight = 'bold') {
    let size = baseSize;
    graphCtx.textAlign = 'center';
    graphCtx.textBaseline = 'middle';

    while (size > minSize) {
        graphCtx.font = `${fontWeight} ${size}px ${fontFamily}`;
        if (graphCtx.measureText(text).width <= maxWidth) {
            return { text, size };
        }
        size -= 0.5;
    }

    graphCtx.font = `${fontWeight} ${minSize}px ${fontFamily}`;
    if (graphCtx.measureText(text).width <= maxWidth) {
        return { text, size: minSize };
    }

    let truncated = text;
    while (truncated.length > 1 && graphCtx.measureText(`${truncated}…`).width > maxWidth) {
        truncated = truncated.slice(0, -1);
    }

    return { text: `${truncated}…`, size: minSize };
}

function drawOverlayLabelBox(x, y, text, options = {}) {
    const {
        widthLimit = 240,
        height = 22,
        paddingX = 8,
        paddingY = 6,
        maxFontSize = 13,
        minFontSize = 8,
        fill = '#1e293b',
        textFill = '#fff',
        stroke = '#f472b6',
        align = 'center',
        above = true,
    } = options;

    const fitted = fitScreenText(text, widthLimit - (paddingX * 2), maxFontSize, minFontSize);
    graphCtx.font = `bold ${fitted.size}px Inter, sans-serif`;
    const measured = graphCtx.measureText(fitted.text).width;
    const boxWidth = Math.min(widthLimit, measured + (paddingX * 2));
    const boxHeight = height;
    let boxX = x - boxWidth / 2;
    let boxY = above ? y - boxHeight - 12 : y + 12;

    if (align === 'left') {
        boxX = x;
    } else if (align === 'right') {
        boxX = x - boxWidth;
    }

    boxX = clamp(boxX, 12, graphCanvas.clientWidth - 12 - boxWidth);
    boxY = clamp(boxY, 12, graphCanvas.clientHeight - 12 - boxHeight);

    graphCtx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    graphCtx.fillRect(boxX + 2, boxY + 2, boxWidth, boxHeight);

    graphCtx.fillStyle = fill;
    graphCtx.fillRect(boxX, boxY, boxWidth, boxHeight);

    graphCtx.strokeStyle = stroke;
    graphCtx.lineWidth = 2;
    graphCtx.strokeRect(boxX, boxY, boxWidth, boxHeight);

    graphCtx.fillStyle = textFill;
    graphCtx.textAlign = 'center';
    graphCtx.textBaseline = 'middle';
    graphCtx.fillText(fitted.text, boxX + boxWidth / 2, boxY + boxHeight / 2);
}

function buildDisplayGroups(stories) {
    const groups = new Map();

    stories.forEach((story, index) => {
        const hasSeries = Boolean((story.series || '').trim());
        const groupId = hasSeries
            ? `series:${normalizeSeriesKey(story.series, getStoryAuthor(story))}`
            : `story:${story.id}`;

        let group = groups.get(groupId);
        if (!group) {
            group = {
                id: groupId,
                type: hasSeries ? 'series' : 'single',
                title: hasSeries ? story.series : story.title,
                author: getStoryAuthor(story),
                members: [],
                firstIndex: index,
            };
            groups.set(groupId, group);
        }

        group.members.push(story);
        group.firstIndex = Math.min(group.firstIndex, index);
        storyToGroupId.set(story.id, groupId);
    });

    return Array.from(groups.values());
}

function getSeriesMembers(story) {
    if (!story || !(story.series || '').trim()) return [];
    return allStories
        .filter(item =>
            item.id !== story.id &&
            (item.series || '').trim() === (story.series || '').trim() &&
            getStoryAuthor(item) === getStoryAuthor(story)
        )
        .map(item => ({
            story: item,
            result: currentResults.get(item.id),
        }))
        .sort((a, b) => {
            const aSimilarity = a.result ? a.result.similarity : -1;
            const bSimilarity = b.result ? b.result.similarity : -1;
            if (aSimilarity !== bSimilarity) return bSimilarity - aSimilarity;

            const aIndex = parseSeriesIndex(a.story.series_index);
            const bIndex = parseSeriesIndex(b.story.series_index);
            if (aIndex !== bIndex) return aIndex - bIndex;

            return a.story.title.localeCompare(b.story.title);
        });
}

function sortGroupMembers(group) {
    const members = [...group.members];

    members.sort((a, b) => {
        const aResult = currentResults.get(a.id);
        const bResult = currentResults.get(b.id);
        const aSimilarity = aResult ? aResult.similarity : null;
        const bSimilarity = bResult ? bResult.similarity : null;

        if (aSimilarity !== null || bSimilarity !== null) {
            if (aSimilarity === null) return 1;
            if (bSimilarity === null) return -1;
            if (aSimilarity !== bSimilarity) return bSimilarity - aSimilarity;
        }

        const aSeriesIndex = parseSeriesIndex(a.series_index);
        const bSeriesIndex = parseSeriesIndex(b.series_index);
        if (aSeriesIndex !== bSeriesIndex) return aSeriesIndex - bSeriesIndex;

        return a.title.localeCompare(b.title);
    });

    return members;
}

function getGroupPrimaryStory(group) {
    const members = sortGroupMembers(group);
    return members[0] || null;
}

function getGroupBestResult(group) {
    let best = null;
    for (const member of group.members) {
        const result = currentResults.get(member.id);
        if (!result) continue;
        if (!best || result.similarity > best.similarity) {
            best = { ...result, storyId: member.id };
        }
    }
    return best;
}

function getGroupSortValue(group) {
    const best = getGroupBestResult(group);
    if (best) {
        return best.similarity;
    }
    return -group.firstIndex;
}

// State
let allStories = [];
let storyPositions = new Map(); // id -> {x, y} - current animated positions
let originalPositions = new Map(); // id -> {x, y} - original fixed positions  
let radialPositions = new Map(); // id -> {x, y} - radial positions around query center
let storyMotionStates = new Map(); // id -> {from, to, startTime, duration}
let displayGroups = [];
let groupElements = new Map(); // group id -> DOM element
let storyToGroupId = new Map(); // story id -> group id
let storyElements = new Map(); // id -> DOM element
let currentResults = new Map(); // id -> result data
let selectedStoryId = null;
let queryPosition = null;
let graphCanvas, graphCtx;
let animationFrameId = null;
let graphVisualScale = 1;
let activeEventSource = null;
let searchGeneration = 0;

// Animation state
let animationDuration = 180;

// Pan and zoom state
let panOffsetX = 0;
let panOffsetY = 0;
let zoomLevel = 1;
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let panStartOffsetX = 0;
let panStartOffsetY = 0;

// DOM Elements
let searchInput, searchBtn, storiesGrid, progressContainer;
let progressFill, progressText, hintButtons, graphInfo, graphTooltip, statusMessage;
let librarySubtitle;
let zoomIndicator, zoomIndicatorText;
let seriesModalBackdrop, seriesModalClose, seriesModalTitle, seriesModalSubtitle, seriesModalBody;
let activeSeriesStoryId = null;
let settingsToggleBtn, settingsModalBackdrop, settingsModalClose, settingsSaveBtn, settingsResetBtn;
let settingMaxCards;
let cardObserver = null;
const CARD_RENDER_MARGIN = '600px';

const SETTINGS_DEFAULTS = { maxCards: 100 };
let appSettings = { ...SETTINGS_DEFAULTS };

function loadSettings() {
  try {
    const saved = localStorage.getItem('storyAtlasSettings');
    if (saved) appSettings = { ...SETTINGS_DEFAULTS, ...JSON.parse(saved) };
  } catch (_) {}
}

function saveSettings() {
  try {
    localStorage.setItem('storyAtlasSettings', JSON.stringify(appSettings));
  } catch (_) {}
}

function getVisibleGraphStories() {
  return allStories;
}

function getVisibleCardStories() {
  if (currentResults.size > 0) {
    const sorted = Array.from(currentResults.values()).sort((a, b) => b.similarity - a.similarity);
    const topIds = new Set(sorted.slice(0, appSettings.maxCards).map(r => r.id));
    return allStories.filter(s => topIds.has(s.id));
  }
  return allStories.length <= appSettings.maxCards
    ? allStories
    : allStories.slice(0, appSettings.maxCards);
}

// Initialize
document.addEventListener('DOMContentLoaded', init);

async function init() {
    searchInput = document.getElementById('searchInput');
  searchBtn = document.getElementById('searchBtn');
  storiesGrid = document.getElementById('storiesGrid');
    progressContainer = document.getElementById('progressContainer');
    progressFill = document.getElementById('progressFill');
    progressText = document.getElementById('progressText');
    hintButtons = document.querySelectorAll('.hint-btn');
    graphInfo = document.getElementById('graphInfo');
    graphTooltip = document.getElementById('graphTooltip');
 statusMessage = document.getElementById('statusMessage');
 zoomIndicator = document.getElementById('zoomIndicator');
    zoomIndicatorText = document.getElementById('zoomIndicatorText');
    librarySubtitle = document.getElementById('librarySubtitle');
    seriesModalBackdrop = document.getElementById('seriesModalBackdrop');
    seriesModalClose = document.getElementById('seriesModalClose');
    seriesModalTitle = document.getElementById('seriesModalTitle');
    seriesModalSubtitle = document.getElementById('seriesModalSubtitle');
  seriesModalBody = document.getElementById('seriesModalBody');

  loadSettings();
  settingsToggleBtn = document.getElementById('settingsToggleBtn');
  settingsModalBackdrop = document.getElementById('settingsModalBackdrop');
  settingsModalClose = document.getElementById('settingsModalClose');
  settingsSaveBtn = document.getElementById('settingsSaveBtn');
  settingsResetBtn = document.getElementById('settingsResetBtn');
  settingMaxCards = document.getElementById('settingMaxCards');

  initGraph();
    await loadStories();
    setupEventListeners();
    setupModalListeners();
    startGraphAnimation();
}

// ==================== STATUS MESSAGES ====================

function showStatus(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString([], { hour12: false });
    console.log(`[${timestamp}][${type.toUpperCase()}] ${message}`);
    if (statusMessage) {
        statusMessage.textContent = message;
        statusMessage.className = `status-message ${type}`;
        statusMessage.classList.add('visible');
    }
}

function hideStatus() {
    if (statusMessage) {
        statusMessage.classList.remove('visible');
    }
}

// ==================== GRAPH VISUALIZATION ====================

function initGraph() {
    graphCanvas = document.getElementById('embeddingGraph');
    graphCtx = graphCanvas.getContext('2d');

    resizeGraph();
    window.addEventListener('resize', resizeGraph);

    graphCanvas.addEventListener('mousemove', handleGraphMouseMove);
    graphCanvas.addEventListener('click', handleGraphClick);
    graphCanvas.addEventListener('mouseleave', () => {
        graphTooltip.classList.remove('visible');
        isPanning = false;
    });

    // Pan: mouse drag
    graphCanvas.addEventListener('mousedown', (e) => {
        if (e.button === 0) { // left click
            isPanning = true;
            panStartX = e.clientX;
            panStartY = e.clientY;
            panStartOffsetX = panOffsetX;
            panStartOffsetY = panOffsetY;
            graphCanvas.style.cursor = 'grabbing';
        }
    });
    window.addEventListener('mouseup', () => {
        isPanning = false;
        graphCanvas.style.cursor = 'crosshair';
    });
  window.addEventListener('mousemove', (e) => {
    if (isPanning) {
      panOffsetX = panStartOffsetX + (e.clientX - panStartX);
      panOffsetY = panStartOffsetY + (e.clientY - panStartY);
      markGraphDirty();
    }
  });

    // Zoom: scroll wheel
    graphCanvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
        const newZoom = Math.max(0.5, Math.min(5, zoomLevel * zoomFactor));

        // Zoom toward mouse position
        const rect = graphCanvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        panOffsetX = mouseX - (mouseX - panOffsetX) * (newZoom / zoomLevel);
        panOffsetY = mouseY - (mouseY - panOffsetY) * (newZoom / zoomLevel);

    zoomLevel = newZoom;
    markGraphDirty();
  }, { passive: false });

  graphCanvas.addEventListener('dblclick', () => {
    panOffsetX = 0;
    panOffsetY = 0;
    zoomLevel = 1;
    markGraphDirty();
  });
}

function resizeGraph() {
  const container = graphCanvas.parentElement;
  const rect = container.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  graphCanvas.style.width = `${rect.width}px`;
  graphCanvas.style.height = `${rect.height}px`;
  graphCanvas.width = Math.round(rect.width * dpr);
  graphCanvas.height = Math.round(rect.height * dpr);
  graphCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  markGraphDirty();
}

let graphDirty = true;

function markGraphDirty() {
  graphDirty = true;
}

function startGraphAnimation() {
  let lastTime = 0;

  function animate(currentTime) {
    lastTime = currentTime;

    updateStoryAnimations(currentTime);

    if (storyMotionStates.size > 0) graphDirty = true;
    if (queryPosition) graphDirty = true;

    if (graphDirty) {
      drawGraph();
      graphDirty = storyMotionStates.size > 0 || queryPosition;
    }

    animationFrameId = requestAnimationFrame(animate);
  }
  animate(0);
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

function updateStoryAnimations(currentTime) {
    const completed = [];

    storyMotionStates.forEach((motion, storyId) => {
        if (currentTime < motion.startTime) {
            return;
        }

        const elapsed = currentTime - motion.startTime;
        const progress = Math.min(1, elapsed / motion.duration);
        const eased = easeOutCubic(progress);
        const nextPosition = {
            x: lerp(motion.from.x, motion.to.x, eased),
            y: lerp(motion.from.y, motion.to.y, eased)
        };

        storyPositions.set(storyId, nextPosition);

        if (progress >= 1) {
            completed.push(storyId);
        }
    });

    completed.forEach(storyId => {
        const motion = storyMotionStates.get(storyId);
        if (motion) {
            storyPositions.set(storyId, { ...motion.to });
        }
        storyMotionStates.delete(storyId);
    });
}

function queueStoryPositionAnimation(storyId, targetPosition, delayMs = 0, durationMs = animationDuration) {
    const current = storyPositions.get(storyId) || targetPosition;
    storyMotionStates.set(storyId, {
        from: { ...current },
        to: { ...targetPosition },
        startTime: performance.now() + delayMs,
        duration: durationMs
    });
}

function drawGraph() {
    const width = graphCanvas.clientWidth;
    const height = graphCanvas.clientHeight;
    const padding = 40;
    const overlayAnnotations = [];

    // Clear canvas
    graphCtx.fillStyle = '#0f172a';
    graphCtx.fillRect(0, 0, width, height);

    // Apply pan and zoom transform
    graphCtx.save();
    graphCtx.translate(panOffsetX, panOffsetY);
    graphCtx.scale(zoomLevel, zoomLevel);
    graphVisualScale = getDotVisualScale();

    // Get radial scale for consistent circle
    const scale = getRadialScale(width, height, padding);

 // Draw radial grid
 if (queryPosition) {
 drawRadialGrid(width, height, padding);
 } else {
 drawCartesianGrid(width, height, padding);
 }

 // Draw connection lines from query/center to top stories
 if (queryPosition && currentResults.size > 0) {
 const centerX = scale.centerX;
 const centerY = scale.centerY;

 const sortedResults = Array.from(currentResults.values())
 .sort((a, b) => b.similarity - a.similarity)
 .slice(0, 10);

 sortedResults.forEach((result) => {
 const pos = storyPositions.get(result.id);
 if (!pos) return;

 const sx = scale.centerX + pos.x * scale.radius;
 const sy = scale.centerY + pos.y * scale.radius;

            const alpha = 0.1 + (result.similarity * 0.4);
            graphCtx.strokeStyle = `rgba(245, 158, 11, ${alpha})`;
            graphCtx.lineWidth = 1 + (result.similarity * 2);

            graphCtx.beginPath();
            graphCtx.moveTo(centerX, centerY);
            graphCtx.lineTo(sx, sy);
            graphCtx.stroke();
        });
    }

  let selectedStory = null;
  const resultStories = [];

  const defaultRadius = 4.5 * graphVisualScale;
  const defaultColor = 'rgba(100, 116, 139, 0.95)';
  const defaultStroke = 'rgba(148, 163, 184, 0.65)';
  const defaultLineWidth = 1.2 * graphVisualScale;

  // Batch-draw non-result dots (one path, one fill, one stroke)
  graphCtx.fillStyle = defaultColor;
  graphCtx.strokeStyle = defaultStroke;
  graphCtx.lineWidth = defaultLineWidth;
  graphCtx.beginPath();

 allStories.forEach(story => {
 if (story.id === selectedStoryId) { selectedStory = story; return; }
 if (currentResults.has(story.id)) { resultStories.push(story); return; }
 const pos = storyPositions.get(story.id);
 if (!pos) return;
 const x = scale.centerX + pos.x * scale.radius;
 const y = scale.centerY + pos.y * scale.radius;
 graphCtx.moveTo(x + defaultRadius, y); graphCtx.arc(x, y, defaultRadius, 0, Math.PI * 2);
 });

  graphCtx.fill();
  graphCtx.stroke();

  // Draw result dots with full styling (colored, sized by similarity)
  resultStories.forEach(story => {
    if (story.id === selectedStoryId) { selectedStory = story; return; }
    drawStoryPoint(story, width, height, padding, false, overlayAnnotations);
  });

 // Draw query point / center
 if (queryPosition) {
 const qx = scale.centerX;
 const qy = scale.centerY;

        // Animated glow
        const time = Date.now() / 1000;
        const pulseRadius = (15 + Math.sin(time * 3) * 5) * graphVisualScale;

        const gradient = graphCtx.createRadialGradient(qx, qy, 0, qx, qy, pulseRadius + 10);
        gradient.addColorStop(0, 'rgba(245, 158, 11, 0.6)');
        gradient.addColorStop(1, 'rgba(245, 158, 11, 0)');

        graphCtx.beginPath();
        graphCtx.arc(qx, qy, pulseRadius + 10, 0, Math.PI * 2);
        graphCtx.fillStyle = gradient;
        graphCtx.fill();

        graphCtx.beginPath();
        graphCtx.arc(qx, qy, 12 * graphVisualScale, 0, Math.PI * 2);
        graphCtx.fillStyle = '#f59e0b';
        graphCtx.fill();

        graphCtx.strokeStyle = '#fff';
        graphCtx.lineWidth = 2 * graphVisualScale;
        graphCtx.stroke();

        graphCtx.fillStyle = '#000';
        graphCtx.font = 'bold 12px Arial';
        graphCtx.textAlign = 'center';
        graphCtx.textBaseline = 'middle';
        graphCtx.fillText('Q', qx, qy);

        const qScreen = getScreenPoint(qx, qy);
        overlayAnnotations.push({
            type: 'query',
            x: qScreen.x,
            y: qScreen.y,
            text: 'QUERY CENTER',
        });
    }

    // Draw SELECTED story point LAST (on top of everything)
    if (selectedStory) {
        drawStoryPoint(selectedStory, width, height, padding, true, overlayAnnotations);
    }

    // Restore transform before drawing fixed UI elements
    graphCtx.restore();

    drawOverlayAnnotations(overlayAnnotations);
    updateZoomIndicator();
}


function drawCartesianGrid(width, height, padding) {
    graphCtx.strokeStyle = 'rgba(51, 65, 85, 0.3)';
    graphCtx.lineWidth = 1;

    for (let i = 0; i <= 4; i++) {
        const x = padding + (width - 2 * padding) * (i / 4);
        const y = padding + (height - 2 * padding) * (i / 4);

        graphCtx.beginPath();
        graphCtx.moveTo(x, padding);
        graphCtx.lineTo(x, height - padding);
        graphCtx.stroke();

        graphCtx.beginPath();
        graphCtx.moveTo(padding, y);
        graphCtx.lineTo(width - padding, y);
        graphCtx.stroke();
    }
}


function getRadialScale(width, height, padding) {
    // Use the smaller dimension to ensure a perfect circle
    const availableWidth = width - 2 * padding;
    const availableHeight = height - 2 * padding;
    const diameter = Math.min(availableWidth, availableHeight);
    return {
        centerX: width / 2,
        centerY: height / 2,
        radius: diameter / 2
    };
}

function drawRadialGrid(width, height, padding) {
    const scale = getRadialScale(width, height, padding);
    const { centerX, centerY, radius: maxRadius } = scale;

    // Draw concentric circles matching the backend bands (10% increments)
    const rings = [
        { radius: 0.08, label: '90%+', color: '#059669' },
        { radius: 0.18, label: '80%', color: '#10b981' },
        { radius: 0.28, label: '70%', color: '#22c55e' },
        { radius: 0.38, label: '60%', color: '#84cc16' },
        { radius: 0.48, label: '50%', color: '#eab308' },
        { radius: 0.58, label: '40%', color: '#f59e0b' },
        { radius: 0.68, label: '30%', color: '#f97316' },
        { radius: 0.78, label: '20%', color: '#ef4444' },
        { radius: 0.88, label: '10%', color: '#dc2626' },
        { radius: 0.96, label: '<10%', color: '#991b1b' },
    ];

    // Draw filled bands (from outside in to layer correctly)
    for (let i = rings.length - 1; i >= 0; i--) {
        const ring = rings[i];
        const r = ring.radius * maxRadius;

        graphCtx.beginPath();
        graphCtx.arc(centerX, centerY, r, 0, Math.PI * 2);
        graphCtx.fillStyle = ring.color + '15';
        graphCtx.fill();
    }

    // Draw ring borders and labels
    rings.forEach((ring, index) => {
        const r = ring.radius * maxRadius;

        graphCtx.beginPath();
        graphCtx.arc(centerX, centerY, r, 0, Math.PI * 2);
        graphCtx.strokeStyle = ring.color + '50';
        graphCtx.lineWidth = 1.5 * graphVisualScale;
        graphCtx.stroke();

        // Only show labels on every other ring to avoid clutter
        if (index % 2 === 0 || index === rings.length - 1) {
            const labelX = centerX + r + 8;
            const labelY = centerY;

            graphCtx.font = `bold ${Math.max(7, 10 * graphVisualScale)}px Inter, sans-serif`;
            const labelWidth = graphCtx.measureText(ring.label).width;
            graphCtx.fillStyle = 'rgba(15, 23, 42, 0.8)';
            graphCtx.fillRect(
                labelX - (4 * graphVisualScale),
                labelY - (10 * graphVisualScale),
                labelWidth + (8 * graphVisualScale),
                20 * graphVisualScale
            );

            graphCtx.fillStyle = ring.color;
            graphCtx.textAlign = 'left';
            graphCtx.textBaseline = 'middle';
            graphCtx.fillText(ring.label, labelX, labelY);
        }
    });

    // Draw subtle radial lines
    for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        graphCtx.beginPath();
        graphCtx.moveTo(centerX, centerY);
        graphCtx.lineTo(
            centerX + Math.cos(angle) * maxRadius,
            centerY + Math.sin(angle) * maxRadius
        );
        graphCtx.strokeStyle = 'rgba(51, 65, 85, 0.3)';
        graphCtx.lineWidth = 1;
        graphCtx.stroke();
    }

    // Center point indicator
    graphCtx.beginPath();
    graphCtx.arc(centerX, centerY, 3 * graphVisualScale, 0, Math.PI * 2);
    graphCtx.fillStyle = 'rgba(251, 191, 36, 0.5)';
    graphCtx.fill();
}

function drawOverlayAnnotations(annotations) {
    if (!annotations || !annotations.length) return;

    annotations.forEach(annotation => {
        if (annotation.type === 'query') {
            drawOverlayLabelBox(annotation.x, annotation.y, annotation.text, {
                widthLimit: 210,
                height: 18,
                paddingX: 8,
                maxFontSize: 10,
                minFontSize: 8,
                fill: 'rgba(15, 23, 42, 0.9)',
                textFill: '#f59e0b',
                stroke: 'rgba(245, 158, 11, 0.35)',
                above: true,
            });
            return;
        }

        if (annotation.type === 'story') {
            const title = annotation.title || '';
            drawOverlayLabelBox(annotation.x, annotation.y, title, {
                widthLimit: Math.min(260, graphCanvas.clientWidth - 24),
                height: 22,
                paddingX: 8,
                maxFontSize: 13,
                minFontSize: 8,
                fill: '#1e293b',
                textFill: '#fff',
                stroke: '#f472b6',
                above: annotation.above,
            });

            if (annotation.similarityText) {
                drawOverlayLabelBox(annotation.x, annotation.similarityY, annotation.similarityText, {
                    widthLimit: 120,
                    height: 16,
                    paddingX: 6,
                    maxFontSize: 10,
                    minFontSize: 7,
                    fill: '#10b981',
                    textFill: '#fff',
                    stroke: '#10b981',
                    above: true,
                });
            }
        }
    });
}

function drawStoryPoint(story, width, height, padding, isSelected = false, overlayAnnotations = null) {
 const pos = storyPositions.get(story.id);
 if (!pos) return;

 const scale = getRadialScale(width, height, padding);
 const x = scale.centerX + pos.x * scale.radius;
 const y = scale.centerY + pos.y * scale.radius;

    const result = currentResults.get(story.id);
    const selected = isSelected || story.id === selectedStoryId;

    const dotScale = getDotVisualScale();
    let radius = 4.5 * dotScale;
    let color = 'rgba(100, 116, 139, 0.95)';
    let strokeColor = 'rgba(148, 163, 184, 0.65)';
    let glowColor = null;

    if (result) {
        const similarity = result.similarity;
        const hue = 120 * similarity;
        color = `hsla(${hue}, 72%, 48%, 0.96)`;
        strokeColor = `hsla(${hue}, 72%, 30%, 0.9)`;
        radius = (4.5 + similarity * 4.5) * dotScale;
    }

    if (selected) {
        color = '#f472b6';
        strokeColor = '#ffffff';
        glowColor = 'rgba(244, 114, 182, 0.22)';
        radius = 10 * dotScale;
    }

    // Subtle glow only for the selected item so regular dots stay crisp.
    if (glowColor) {
        graphCtx.beginPath();
        graphCtx.arc(x, y, radius + (6 * dotScale), 0, Math.PI * 2);
        graphCtx.fillStyle = glowColor;
        graphCtx.fill();
    }

    // Draw point
    graphCtx.beginPath();
    graphCtx.arc(x, y, radius, 0, Math.PI * 2);
    graphCtx.fillStyle = color;
    graphCtx.fill();
    graphCtx.strokeStyle = strokeColor;
    graphCtx.lineWidth = (selected ? 2.5 : 1.2) * dotScale;
    graphCtx.stroke();

    if (selected) {
        const screenPos = getScreenPoint(x, y);
        const screenRadius = radius * zoomLevel;
        const labelAbove = screenPos.y - screenRadius - 34 > 24;
        overlayAnnotations?.push({
            type: 'story',
            x: screenPos.x,
            y: screenPos.y,
            title: story.title,
            similarityText: result ? `${(result.similarity * 100).toFixed(1)}%` : '',
            similarityY: screenPos.y - screenRadius - 34,
            above: labelAbove,
        });
    }
}


function handleGraphMouseMove(e) {
    if (isPanning) return; // Don't show tooltips while panning

    const rect = graphCanvas.getBoundingClientRect();
    // Inverse transform: screen coords -> canvas coords accounting for pan/zoom
    const mouseX = (e.clientX - rect.left - panOffsetX) / zoomLevel;
    const mouseY = (e.clientY - rect.top - panOffsetY) / zoomLevel;

    const padding = 40;
    const width = graphCanvas.clientWidth;
    const height = graphCanvas.clientHeight;
    const scale = getRadialScale(width, height, padding);

 // Check if hovering over query
 if (queryPosition) {
 const qx = scale.centerX;
 const qy = scale.centerY;
        const distToQuery = Math.sqrt((mouseX - qx) ** 2 + (mouseY - qy) ** 2);

        if (distToQuery < 15) {
            graphTooltip.innerHTML = `<strong>Query Center</strong>`;
            graphTooltip.style.left = `${e.clientX + 15}px`;
            graphTooltip.style.top = `${e.clientY + 15}px`;
            graphTooltip.classList.add('visible');
            graphCanvas.style.cursor = 'pointer';
            return;
        }
    }

 let closestStory = null;
 let closestDist = Infinity;

 allStories.forEach(story => {
 const pos = storyPositions.get(story.id);
 if (!pos) return;

 const x = scale.centerX + pos.x * scale.radius;
 const y = scale.centerY + pos.y * scale.radius;

 const dist = Math.sqrt((mouseX - x) ** 2 + (mouseY - y) ** 2);
 if (dist < closestDist && dist < 25) {
 closestDist = dist;
 closestStory = story;
 }
 });

 if (closestStory) {
 const result = currentResults.get(closestStory.id);
 const origPos = originalPositions.get(closestStory.id);
 graphTooltip.innerHTML = `
 <strong>${closestStory.title}</strong>
 ${result ? `<br><span style="color: #10b981;">Match: ${(result.similarity * 100).toFixed(1)}%</span>` : ''}
 ${origPos ? `<br><span style="color: #94a3b8; font-size: 0.8em;">x ${origPos.x.toFixed(3)}, y ${origPos.y.toFixed(3)}</span>` : ''}
 `;
        graphTooltip.style.left = `${e.clientX + 15}px`;
        graphTooltip.style.top = `${e.clientY + 15}px`;
        graphTooltip.classList.add('visible');
        graphCanvas.style.cursor = 'pointer';
    } else {
        graphTooltip.classList.remove('visible');
        graphCanvas.style.cursor = 'crosshair';
    }
}

function handleGraphClick(e) {
    // Ignore clicks that were part of a pan gesture
    if (Math.abs(panOffsetX - panStartOffsetX) > 3 || Math.abs(panOffsetY - panStartOffsetY) > 3) return;

    const rect = graphCanvas.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left - panOffsetX) / zoomLevel;
    const mouseY = (e.clientY - rect.top - panOffsetY) / zoomLevel;

    const padding = 40;
    const width = graphCanvas.clientWidth;
    const height = graphCanvas.clientHeight;
    const scale = getRadialScale(width, height, padding);

  let clickedStory = null;
  let closestDist = Infinity;

 allStories.forEach(story => {
 const pos = storyPositions.get(story.id);
 if (!pos) return;

 const x = scale.centerX + pos.x * scale.radius;
 const y = scale.centerY + pos.y * scale.radius;

        const dist = Math.sqrt((mouseX - x) ** 2 + (mouseY - y) ** 2);
        if (dist < closestDist && dist < 25) {
            closestDist = dist;
            clickedStory = story;
        }
    });

    if (clickedStory) {
        selectStory(clickedStory.id, { source: 'graph' });
    } else {
        deselectStory();
    }
}

function selectStory(storyId, options = {}) {
    const { force = false, source = 'ui' } = options;

    if (selectedStoryId) {
        const prevCard = storyElements.get(selectedStoryId);
        if (prevCard) {
            prevCard.classList.remove('selected');
        }
    }

    selectedStoryId = storyId;
    const card = storyElements.get(storyId);
    if (card) {
        card.classList.add('selected');
        scrollElementIntoViewIfNeeded(card);
    }

    const story = allStories.find(s => s.id === storyId);
    const result = currentResults.get(storyId);

    console.info('[SELECT] Showing story:', {
        source,
        force,
        storyId,
        title: story ? story.title : null,
        series: story ? story.series : null,
    });
    renderGraphSummary(story, result);
  markGraphDirty();
}

function deselectStory() {
  if (selectedStoryId) {
    const prevCard = storyElements.get(selectedStoryId);
    if (prevCard) {
      prevCard.classList.remove('selected');
    }
    selectedStoryId = null;
    renderGraphSummary(null, null);
    markGraphDirty();
  }
}

function renderGraphSummary(story, result) {
    if (!graphInfo) return;

    if (!story) {
        graphInfo.innerHTML = `
            <div class="summary-empty">
                <div class="summary-kicker">Selected Story</div>
                <p>Click a point to inspect its title, author, series, and summary.</p>
            </div>
        `;
        graphInfo.scrollTop = 0;
        return;
    }

    const metaParts = [];
    const author = getStoryAuthor(story);
    if (story.series) {
        const seriesLabel = story.series_index ? `${story.series} #${story.series_index}` : story.series;
        metaParts.push(`<span class="meta-tag">${seriesLabel}</span>`);
    }
    if (story.genre) metaParts.push(`<span class="meta-tag">${story.genre}</span>`);
    if (story.year) metaParts.push(`<span class="meta-tag">${story.year}</span>`);

    const seriesMembers = getSeriesMembers(story);

 const previewText = story.summary || story.content || 'No summary available.';
 const coverHTML = story.cover_url
 ? `<img class="summary-cover" src="${story.cover_url}" alt="${story.title}" loading="lazy">`
 : '';

 const origPos = originalPositions.get(story.id);
 const coordsHTML = origPos
 ? `<span class="meta-tag" title="Embedding space coordinates">x ${origPos.x.toFixed(3)}, y ${origPos.y.toFixed(3)}</span>`
 : '';

    graphInfo.innerHTML = `
        <div class="summary-viewer">
            <div class="summary-top">
                <div class="summary-header">
                    ${coverHTML}
                    <div class="summary-title-block">
                        <div class="summary-kicker">Selected Story</div>
                        <div class="summary-title">${story.title}</div>
 ${author ? `<div class="summary-author">by ${formatAuthors(author)}</div>` : ''}
 <div class="summary-meta">${metaParts.join(' ')} ${coordsHTML}</div>
                    </div>
                </div>
                ${result ? `
                    <div class="summary-stats">
                        <div class="summary-similarity">${(result.similarity * 100).toFixed(1)}% match</div>
                        <div class="summary-rank">Rank #${result.rank}</div>
                    </div>
                ` : ''}
            </div>
            <div class="summary-body">
                <div class="summary-excerpt">${previewText}</div>
                ${seriesMembers.length ? `
                    <div class="summary-series-list">
                        <div class="summary-series-label">Other books in this series</div>
                        ${seriesMembers.map(entry => `
                            <button type="button" class="summary-series-item" data-story-id="${entry.story.id}">
                                <span class="summary-series-item-title">${entry.story.title}</span>
                                <span class="summary-series-item-meta">${entry.story.series_index ? `Book ${entry.story.series_index}` : 'Book'}${entry.result ? ` · ${(entry.result.similarity * 100).toFixed(1)}%` : ''}</span>
                            </button>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
            <div class="summary-footer">
                ${story.series ? `<div class="summary-series">${story.series_index ? `Book ${story.series_index} in ${story.series}` : story.series}</div>` : '<div></div>'}
                <div></div>
            </div>
        </div>
    `;

    graphInfo.querySelectorAll('.summary-series-item').forEach(button => {
        button.addEventListener('click', () => {
            selectStory(button.dataset.storyId, { force: true, source: 'summary-series-item' });
        });
    });

    graphInfo.scrollTop = 0;
    const summaryBody = graphInfo.querySelector('.summary-body');
    if (summaryBody) {
        summaryBody.scrollTop = 0;
    }
}

// ==================== STORIES LOADING ====================

async function loadStories() {
    console.info('[LOAD] Connecting to server...');
    showStatus('🔄 Connecting to server...', 'info');

    try {
        const healthResponse = await fetch(`${API_BASE}/health`);
        const health = await healthResponse.json();
        console.info('[LOAD] Health check:', health);

        if (librarySubtitle && health.loading) {
            const loadedCount = (health.stories_loaded || 0).toLocaleString();
            librarySubtitle.textContent = `Loading library • ${loadedCount} stories indexed`;
        }

        if (health.loading) {
            const loadedCount = (health.stories_loaded || 0).toLocaleString();
            showStatus(`⏳ Loading library • ${loadedCount} stories indexed so far`, 'info');
            console.info(`[LOAD] Backend is still loading (${loadedCount} indexed so far). Retrying in 2s.`);
            setTimeout(loadStories, 2000);
            return;
        }

        const response = await fetch(`${API_BASE}/stories`);
        const data = await response.json();
        console.info('[LOAD] Stories payload:', {
            count: data.count,
            loaded: data.stories_loaded,
            ready: data.ready,
        });

        if (data.status) {
            showStatus(`📊 ${data.status}`, 'info');
        }

        if (data.count === 0) {
            if (librarySubtitle) {
                librarySubtitle.textContent = 'No books loaded yet';
            }
            showStatus('📚 No stories found. Add files to the stories folder, then restart the backend.', 'info');
            storiesGrid.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; padding: 2rem; color: var(--text-secondary);">
                    <p>📭 No stories loaded yet.</p>
                    <p style="margin-top: 0.5rem; font-size: 0.9rem;">Put .txt or .csv files in the stories folder and restart the backend.</p>
                </div>
            `;
            return;
        }

  allStories = data.stories;
  if (librarySubtitle) {
    const total = (data.count || 0).toLocaleString();
    const showing = getVisibleCardStories().length.toLocaleString();
    librarySubtitle.textContent = allStories.length > appSettings.maxCards
      ? `Showing top ${showing} of ${total} books`
      : `Browse ${total} books by semantic similarity`;
  }
        document.title = `Semantic Story Atlas • ${(data.count || 0).toLocaleString()} books`;

        // Store positions
        allStories.forEach(story => {
            if (story.position) {
                const pos = { x: story.position.x, y: story.position.y };
                storyPositions.set(story.id, { ...pos });
                originalPositions.set(story.id, { ...pos });
                radialPositions.set(story.id, { ...pos }); // Initially same as original
            }
        });

        showStatus(`✅ Loaded ${allStories.length.toLocaleString()} stories with embeddings`, 'success');
        console.info(`[LOAD] Completed successfully with ${allStories.length} stories.`);
        setTimeout(hideStatus, 3000);

        renderGraphSummary(null, null);
        renderStories(getVisibleCardStories());
    } catch (error) {
        console.error('[LOAD] Failed to load stories:', error);
        showStatus('❌ Failed to connect to server. Make sure backend is running.', 'error');
        storiesGrid.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 2rem; color: var(--text-secondary);">
                <p>⚠️ Failed to connect to the server.</p>
                <p style="margin-top: 0.5rem; font-size: 0.9rem;">Run: cd backend && python app.py</p>
            </div>
        `;
    }
}

function setupCardObserver() {
  if (cardObserver) cardObserver.disconnect();
  cardObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const card = entry.target;
        const groupId = card.dataset.groupId;
        const group = displayGroups.find(g => g.id === groupId);
        if (!group) return;
        if (group.type === 'series') {
          renderSeriesGroupCard(card, group, group.firstIndex);
        } else {
          renderSingleStoryCard(card, group.members[0], group.firstIndex);
        }
        card.classList.add('rendered');
        cardObserver.unobserve(card);
      }
    });
  }, { rootMargin: CARD_RENDER_MARGIN });
}

function renderStories(stories, withAnimation = true) {
  storiesGrid.innerHTML = '';
  storyElements.clear();
  groupElements.clear();
  storyToGroupId.clear();
  displayGroups = buildDisplayGroups(stories);
  setupCardObserver();

  displayGroups.forEach((group, index) => {
    const card = group.type === 'series'
      ? createSeriesGroupCard(group, index)
      : createStoryCard(group.members[0], index);
    card.dataset.groupId = group.id;
    storiesGrid.appendChild(card);
    groupElements.set(group.id, card);
    group.members.forEach(story => {
      storyElements.set(story.id, card);
    });

    cardObserver.observe(card);

    if (withAnimation) {
      setTimeout(() => {
        card.classList.add('visible');
      }, Math.min(index, 60) * 30);
    } else {
      card.classList.add('visible');
    }
  });
}

function refreshGroupCardForStory(storyId) {
  const groupId = getStoryDisplayGroupId(storyId);
  const group = displayGroups.find(item => item.id === groupId);
  const card = groupElements.get(groupId);
  if (!group || !card) return;

  if (group.type === 'series') {
    renderSeriesGroupCard(card, group, group.firstIndex);
  } else {
    renderSingleStoryCard(card, group.members[0], group.firstIndex);
  }
  card.classList.add('rendered');
}

function renderSingleStoryCard(card, story, index) {
    const wasVisible = card.classList.contains('visible');
    const cover = generateCover(story.title);
    const result = currentResults.get(story.id);

    const excerptText = (story.summary || story.content || '').trim();
    const coverStyle = story.cover
        ? `background-image:
                linear-gradient(180deg, rgba(15, 23, 42, 0.05) 0%, rgba(15, 23, 42, 0.18) 48%, rgba(15, 23, 42, 0.88) 100%),
                url('${story.cover_url || `${API_BASE}/covers/${encodeURIComponent(story.cover)}`}');`
        : `background-image:
                linear-gradient(180deg, rgba(15, 23, 42, 0.08) 0%, rgba(15, 23, 42, 0.2) 48%, rgba(15, 23, 42, 0.92) 100%),
                linear-gradient(135deg, ${cover.colors[0]}, ${cover.colors[1]});`;

    card.className = 'story-card';
    card.dataset.id = story.id;
    card.innerHTML = `
        <div class="rank-badge">${result ? result.rank : index + 1}</div>
        <div class="story-card-visual ${story.cover ? 'has-image' : 'has-gradient'}" style="${coverStyle}">
            <div class="story-card-overlay">
                <div class="story-card-overlay-header">
                    <h3 class="story-title">${story.title}</h3>
                    ${getStoryAuthor(story) ? `<div class="story-author">by ${formatAuthors(getStoryAuthor(story))}</div>` : ''}
                </div>
                <p class="story-excerpt">${excerptText || 'No summary available.'}</p>
                <div class="story-meta">
                    ${story.genre ? `<span class="meta-tag">${story.genre}</span>` : ''}
                    ${story.year ? `<span class="meta-tag">${story.year}</span>` : ''}
                </div>
                <div class="similarity-badge">
                    <span class="similarity-value">${result ? (result.similarity * 100).toFixed(1) + '%' : ''}</span>
                    <div class="similarity-bar">
                        <div class="similarity-bar-fill" style="width: ${result ? result.similarity * 100 : 0}%"></div>
                    </div>
                </div>
            </div>
        </div>
    `;

    if (result) {
        card.classList.add('has-similarity', 'has-rank');
        if (result.rank <= 3) {
            card.querySelector('.rank-badge').classList.add('top-3');
            if (result.rank === 1) {
                card.querySelector('.rank-badge').classList.add('top-1');
            }
        }
    }

  if (story.id === selectedStoryId) {
    card.classList.add('selected');
  }
  if (wasVisible) {
    card.classList.add('visible');
  }
  card.classList.add('rendered');
}

function createStoryCard(story, index) {
  const card = document.createElement('div');
  card.className = 'story-card';
  card.dataset.id = story.id;
  card.innerHTML = '<div class="story-card-visual"><div class="story-card-overlay"><div class="story-card-overlay-header"><h3 class="story-title story-title-placeholder"></h3></div></div></div>';

  card.onclick = () => {
    selectStory(story.id, { force: true, source: 'story-card' });
  };

  return card;
}

function renderSeriesGroupCard(card, group, index) {
    const wasVisible = card.classList.contains('visible');
    const wasSelected = card.classList.contains('selected');
    const members = sortGroupMembers(group);
    const primaryStory = members[0] || group.members[0];
    const bestResult = getGroupBestResult(group);
    const coverSeed = generateCover(group.title);
    const coverSource = primaryStory && primaryStory.cover
        ? (primaryStory.cover_url || `${API_BASE}/covers/${encodeURIComponent(primaryStory.cover)}`)
        : null;
    const coverStyle = coverSource
        ? `background-image:
                linear-gradient(180deg, rgba(15, 23, 42, 0.12) 0%, rgba(15, 23, 42, 0.28) 40%, rgba(15, 23, 42, 0.9) 100%),
                url('${coverSource}');`
        : `background-image:
                linear-gradient(180deg, rgba(15, 23, 42, 0.12) 0%, rgba(15, 23, 42, 0.28) 40%, rgba(15, 23, 42, 0.9) 100%),
                linear-gradient(135deg, ${coverSeed.colors[0]}, ${coverSeed.colors[1]});`;
    const topMember = bestResult
        ? group.members.find(member => member.id === bestResult.storyId) || primaryStory
        : primaryStory;

    card.className = 'story-card story-group-card';
    card.dataset.id = group.id;
    card.innerHTML = `
        <div class="rank-badge">${bestResult ? bestResult.rank : index + 1}</div>
        <div class="story-card-visual story-group-visual ${coverSource ? 'has-image' : 'has-gradient'}" style="${coverStyle}">
            <div class="story-card-overlay story-group-overlay">
                <div class="story-group-top">
                    <div class="story-group-title-block">
                        <div class="story-kicker">Series</div>
                        <h3 class="story-title">${group.title}</h3>
                        ${group.author ? `<div class="story-author">by ${formatAuthors(group.author)}</div>` : ''}
                    </div>
                    ${bestResult ? `
                        <div class="summary-stats">
                            <div class="summary-similarity">${(bestResult.similarity * 100).toFixed(1)}% match</div>
                            <div class="summary-rank">Rank #${bestResult.rank}</div>
                        </div>
                    ` : ''}
                </div>
                <div class="story-group-primary">
                    ${topMember ? `<span class="story-group-primary-label">Leading book</span><strong>${topMember.title}</strong>` : ''}
                </div>
                <div class="story-group-footer">
                    <span class="story-group-count">${group.members.length} books in series</span>
                    <button type="button" class="story-group-hint" data-action="details">Details</button>
                </div>
            </div>
        </div>
    `;

    if (bestResult) {
        card.classList.add('has-similarity', 'has-rank');
        if (bestResult.rank <= 3) {
            card.querySelector('.rank-badge').classList.add('top-3');
            if (bestResult.rank === 1) {
                card.querySelector('.rank-badge').classList.add('top-1');
            }
        }
    }

    if (wasSelected) {
        card.classList.add('selected');
    }
    if (wasVisible) {
        card.classList.add('visible');
    }

    card.onclick = (event) => {
        const detailsButton = event.target.closest('[data-action="details"]');
        if (detailsButton) {
            event.stopPropagation();
            openSeriesModal(topMember || primaryStory);
            return;
        }

        const targetStoryId = topMember ? topMember.id : group.members[0]?.id;
        if (!targetStoryId) return;

  selectStory(targetStoryId, { force: true, source: 'series-card' });
  };
  card.classList.add('rendered');
}

function createSeriesGroupCard(group, index) {
  const card = document.createElement('div');
  card.className = 'story-card story-group-card';
  card.dataset.id = group.id;
  card.innerHTML = '<div class="story-card-visual story-group-visual"><div class="story-card-overlay story-group-overlay"><div class="story-group-top"><div class="story-group-title-block"><h3 class="story-title story-title-placeholder"></h3></div></div></div></div>';
  return card;
}

// ==================== SEARCH ====================

function setupEventListeners() {
    searchBtn.addEventListener('click', performSearch);
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') performSearch();
    });

    hintButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            searchInput.value = btn.dataset.query;
            performSearch();
        });
    });

 document.addEventListener('keydown', (e) => {
 if (e.key === 'Escape') {
 closeSettingsModal();
 closeSeriesModal();
 deselectStory();
 }
 });
}

function setupModalListeners() {
  if (seriesModalClose) {
    seriesModalClose.addEventListener('click', closeSeriesModal);
  }

  if (seriesModalBackdrop) {
    seriesModalBackdrop.addEventListener('click', (event) => {
      if (event.target === seriesModalBackdrop) {
        closeSeriesModal();
      }
    });
  }

  if (settingsToggleBtn) {
    settingsToggleBtn.addEventListener('click', openSettingsModal);
  }
  if (settingsModalClose) {
    settingsModalClose.addEventListener('click', closeSettingsModal);
  }
  if (settingsModalBackdrop) {
    settingsModalBackdrop.addEventListener('click', (event) => {
      if (event.target === settingsModalBackdrop) closeSettingsModal();
    });
  }
  if (settingsSaveBtn) {
    settingsSaveBtn.addEventListener('click', applySettings);
  }
  if (settingsResetBtn) {
    settingsResetBtn.addEventListener('click', resetSettings);
  }
}

function refreshSeriesModalIfOpen() {
    if (!activeSeriesStoryId) return;
    const story = allStories.find(item => item.id === activeSeriesStoryId);
    if (story) {
        renderSeriesModal(story);
    }
}

function openSeriesModal(story) {
    if (!seriesModalBackdrop || !seriesModalTitle || !seriesModalSubtitle || !seriesModalBody || !story) return;
    activeSeriesStoryId = story.id;
    renderSeriesModal(story);
    seriesModalBackdrop.classList.add('visible');
    seriesModalBackdrop.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
}

function renderSeriesModal(story) {
    if (!seriesModalBackdrop || !seriesModalTitle || !seriesModalSubtitle || !seriesModalBody || !story) return;

    const members = getSeriesMembers(story);
    const allSeriesStories = [story, ...members.map(entry => entry.story)]
        .sort((a, b) => {
            const aResult = currentResults.get(a.id);
            const bResult = currentResults.get(b.id);
            const aSimilarity = aResult ? aResult.similarity : -1;
            const bSimilarity = bResult ? bResult.similarity : -1;
            if (aSimilarity !== bSimilarity) return bSimilarity - aSimilarity;

            const aIndex = parseSeriesIndex(a.series_index);
            const bIndex = parseSeriesIndex(b.series_index);
            if (aIndex !== bIndex) return aIndex - bIndex;

            return a.title.localeCompare(b.title);
        });

    seriesModalTitle.textContent = story.series || 'Series';
    const seriesAuthor = getStoryAuthor(story);
  seriesModalSubtitle.textContent = seriesAuthor
    ? `by ${formatAuthors(seriesAuthor)} · ${allSeriesStories.length} books`
    : `${allSeriesStories.length} books in this series`;

    const leadResult = currentResults.get(story.id);
    const leadScore = leadResult ? `${(leadResult.similarity * 100).toFixed(1)}%` : '—';

    seriesModalBody.innerHTML = `
        <div class="series-modal-lead">
            <div class="series-modal-lead-label">Leading book</div>
            <div class="series-modal-lead-title">${story.title}</div>
            <div class="series-modal-lead-meta">${story.series_index ? `Book ${story.series_index}` : 'Book'} · ${leadScore}</div>
        </div>
        <div class="series-modal-list">
            ${allSeriesStories.map(seriesStory => {
                const result = currentResults.get(seriesStory.id);
                const resultText = result ? `${(result.similarity * 100).toFixed(1)}% match` : '—';
                return `
                    <button type="button" class="series-modal-item ${seriesStory.id === story.id ? 'lead' : ''}" data-story-id="${seriesStory.id}">
                        <div class="series-modal-item-main">
                            <div class="series-modal-item-title">${seriesStory.title}</div>
                            <div class="series-modal-item-meta">${seriesStory.series_index ? `Book ${seriesStory.series_index}` : 'Book'}</div>
                        </div>
                        <div class="series-modal-item-score">${resultText}</div>
                    </button>
                `;
            }).join('')}
        </div>
    `;

    seriesModalBody.querySelectorAll('.series-modal-item').forEach(button => {
        button.addEventListener('click', () => {
            const targetId = button.dataset.storyId;
            closeSeriesModal();
            if (targetId) {
                selectStory(targetId, { force: true, source: 'series-modal' });
            }
        });
    });
}

function closeSeriesModal() {
  if (!seriesModalBackdrop) return;
  seriesModalBackdrop.classList.remove('visible');
  seriesModalBackdrop.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
  activeSeriesStoryId = null;
}

function openSettingsModal() {
  if (!settingsModalBackdrop) return;
  if (settingMaxCards) settingMaxCards.value = appSettings.maxCards;
  settingsModalBackdrop.classList.add('visible');
  settingsModalBackdrop.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
}

function closeSettingsModal() {
  if (!settingsModalBackdrop) return;
  settingsModalBackdrop.classList.remove('visible');
  settingsModalBackdrop.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
}

function applySettings() {
  const newMaxCards = parseInt(settingMaxCards?.value, 10);
  if (Number.isFinite(newMaxCards) && newMaxCards >= 10) appSettings.maxCards = newMaxCards;
  saveSettings();
  closeSettingsModal();
 storyMotionStates.clear();
 renderStories(getVisibleCardStories());
 markGraphDirty();
  if (librarySubtitle && allStories.length) {
    const total = allStories.length.toLocaleString();
    const showing = getVisibleCardStories().length.toLocaleString();
    librarySubtitle.textContent = allStories.length > appSettings.maxCards
      ? `Showing top ${showing} of ${total} books`
      : `Browse ${total} books by semantic similarity`;
  }
  showStatus(`Settings applied — showing up to ${appSettings.maxCards} cards`, 'success');
  setTimeout(hideStatus, 2500);
}

function resetSettings() {
  appSettings = { ...SETTINGS_DEFAULTS };
  if (settingMaxCards) settingMaxCards.value = SETTINGS_DEFAULTS.maxCards;
}

async function performSearch() {
 const query = searchInput.value.trim();
 if (!query) {
 showStatus('⚠️ Please enter a search query', 'error');
 setTimeout(hideStatus, 2000);
 return;
 }

 const speed = 'fast';
 const generation = ++searchGeneration;

 if (activeEventSource) {
 activeEventSource.close();
 activeEventSource = null;
 console.log('[SEARCH] Aborted previous search');
 }

 console.log(`[SEARCH] Starting search for: "${query}"`);

 progressContainer.classList.add('active');
 progressFill.style.width = '0%';
 progressText.textContent = 'Encoding query...';
 showStatus('🔍 Encoding your query into embedding space...', 'info');

 currentResults.clear();
 queryPosition = null;
 selectedStoryId = null;
 markGraphDirty();
 panOffsetX = 0;
 panOffsetY = 0;
 zoomLevel = 1;
 storyMotionStates.clear();
 originalPositions.forEach((pos, id) => storyPositions.set(id, { ...pos }));
 markGraphDirty();

 storyElements.forEach(card => {
 card.classList.remove('has-similarity', 'has-rank', 'selected', 'pulse');
 const rankBadge = card.querySelector('.rank-badge');
 if (rankBadge) {
 rankBadge.classList.remove('top-3', 'top-1');
 }
 const similarityValue = card.querySelector('.similarity-value');
 if (similarityValue) {
 similarityValue.textContent = '';
 }
 const similarityFill = card.querySelector('.similarity-bar-fill');
 if (similarityFill) {
 similarityFill.style.width = '0%';
 }
 });
 displayGroups.forEach(group => refreshGroupCardForStory(group.members[0].id));

 try {
 const url = `${API_BASE}/search/stream?query=${encodeURIComponent(query)}&speed=${speed}`;
 console.log(`[SEARCH] Connecting to: ${url}`);

 const es = new EventSource(url);
 activeEventSource = es;

 es.onopen = () => {
 if (generation !== searchGeneration) return;
 console.log('[SEARCH] EventSource connection opened');
 };

 es.onmessage = (event) => {
 if (generation !== searchGeneration) { es.close(); return; }
 try {
 const data = JSON.parse(event.data);

 if (data.type === 'query_position') {
 queryPosition = data.position;
 markGraphDirty();
 showStatus('📍 Query projected to embedding space', 'info');
 } else if (data.type === 'update') {
 handleStreamUpdate(data);
 } else if (data.type === 'complete') {
 handleStreamComplete(data);
 es.close();
 if (activeEventSource === es) activeEventSource = null;
 }
 } catch (parseError) {
 console.error('[SEARCH] Failed to parse event data:', parseError);
 }
 };

 es.onerror = () => {
 if (generation !== searchGeneration) return;
 console.error('[SEARCH] EventSource error');
 es.close();
 if (activeEventSource === es) activeEventSource = null;
 progressContainer.classList.remove('active');
 showStatus('❌ Search failed. Please try again.', 'error');
 };

 } catch (error) {
 console.error('[SEARCH] Search error:', error);
 progressContainer.classList.remove('active');
 showStatus('❌ Search failed. Please try again.', 'error');
 }
}

function handleStreamUpdate(data) {
    const { story, progress, processed, total } = data;

    progressFill.style.width = `${progress * 100}%`;
    progressText.textContent = `Comparing: ${processed} of ${total} stories`;

    if (!story) return;

    // Store result
    currentResults.set(story.id, story);

    // Update positions
    if (story.originalPosition) {
        originalPositions.set(story.id, {
            x: story.originalPosition.x,
            y: story.originalPosition.y
        });
    }
    if (story.radialPosition) {
        radialPositions.set(story.id, {
            x: story.radialPosition.x,
            y: story.radialPosition.y
        });
    }

 const targetPosition = radialPositions.get(story.id);
 if (targetPosition) {
 queueStoryPositionAnimation(story.id, targetPosition);
 }

    refreshGroupCardForStory(story.id);
    refreshSeriesModalIfOpen();

    const card = storyElements.get(story.id);
    if (card) {
        card.classList.add('pulse');
        setTimeout(() => card.classList.remove('pulse'), 1000);
    }

  reorderCards();
  markGraphDirty();
}

function reorderCards() {
  const sortedGroups = [...displayGroups].sort((a, b) => {
        const aValue = getGroupSortValue(a);
        const bValue = getGroupSortValue(b);
        if (aValue !== bValue) {
            return bValue - aValue;
        }
        return a.firstIndex - b.firstIndex;
    });

    sortedGroups.forEach((group, index) => {
        const card = groupElements.get(group.id);
        if (card) {
            card.style.order = index;
        }
    });
}

function handleStreamComplete(data) {
    console.log('[SEARCH] Search complete:', data);

    progressFill.style.width = '100%';
    progressText.textContent = '✓ Search complete!';
    showStatus('✅ Search complete!', 'success');

    setTimeout(() => {
        progressContainer.classList.remove('active');
        hideStatus();
    }, 2500);

    const sortedResults = data.results.sort((a, b) => b.similarity - a.similarity);

    sortedResults.forEach((story, index) => {
        currentResults.set(story.id, { ...story, rank: index + 1 });

        // Update positions from final data
        if (story.originalPosition) {
            originalPositions.set(story.id, {
                x: story.originalPosition.x,
                y: story.originalPosition.y
            });
        }
        if (story.radialPosition) {
            radialPositions.set(story.id, {
                x: story.radialPosition.x,
                y: story.radialPosition.y
            });
        }

    });

  displayGroups.forEach(group => refreshGroupCardForStory(group.members[0].id));
 reorderCards();
 refreshSeriesModalIfOpen();
  if (librarySubtitle && allStories.length) {
    const total = allStories.length.toLocaleString();
    const showing = getVisibleCardStories().length.toLocaleString();
    librarySubtitle.textContent = allStories.length > appSettings.maxCards
      ? `Showing top ${showing} of ${total} books`
      : `Browse ${total} books by semantic similarity`;
  }

  // Set query position
  if (data.query_position) {
    console.log('[SEARCH] Final query position:', data.query_position);
 queryPosition = data.query_position;
 markGraphDirty();
 }

 }
