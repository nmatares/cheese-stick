const PLAYER_COLORS = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF'];
const DEFAULT_ICONS = ['🏎️', '🐎', '🚀', '🏍️', '🛸'];
const INITIAL_INVESTMENT = 100000;
const NUM_PLAYERS = 5;

// Player icons - can be emoji or custom uploaded images
let playerIcons = [];  // Will hold Image objects for race mode

// Create emoji image for race mode marker
function createEmojiImage(emoji, size = 28) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.font = `${size - 4}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, size / 2, size / 2);

    const img = new Image();
    img.src = canvas.toDataURL();
    return img;
}

// Create circular cropped image from uploaded file
function createCircularImage(imageData, size = 40) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');

            // Create circular clip
            ctx.beginPath();
            ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
            ctx.closePath();
            ctx.clip();

            // Draw image centered and scaled to cover
            const minDim = Math.min(img.width, img.height);
            const sx = (img.width - minDim) / 2;
            const sy = (img.height - minDim) / 2;
            ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);

            const resultImg = new Image();
            resultImg.src = canvas.toDataURL('image/png');
            resultImg.onload = () => resolve(resultImg);
        };
        img.src = imageData;
    });
}

// Process uploaded image file to circular base64
function processUploadedImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            const imageData = e.target.result;

            // Create a circular cropped version for storage
            const canvas = document.getElementById('icon-canvas');
            const ctx = canvas.getContext('2d');
            const img = new Image();

            img.onload = () => {
                // Clear canvas
                ctx.clearRect(0, 0, 100, 100);

                // Create circular clip
                ctx.beginPath();
                ctx.arc(50, 50, 50, 0, Math.PI * 2);
                ctx.closePath();
                ctx.clip();

                // Draw image centered and scaled to cover
                const minDim = Math.min(img.width, img.height);
                const sx = (img.width - minDim) / 2;
                const sy = (img.height - minDim) / 2;
                ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, 100, 100);

                resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = reject;
            img.src = imageData;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// Initialize player icons (emoji defaults or custom)
async function initializePlayerIcons() {
    playerIcons = [];

    for (let i = 0; i < NUM_PLAYERS; i++) {
        const player = competition?.players?.[i];
        if (player?.icon) {
            // Custom uploaded icon
            const img = await createCircularImage(player.icon, 40);
            playerIcons.push(img);
        } else {
            // Default emoji
            playerIcons.push(createEmojiImage(DEFAULT_ICONS[i], 28));
        }
    }
}

let competition = null;
let performanceData = null;
let mainChart = null;
let currentView = 'bar';
let activePlayers = new Set([0, 1, 2, 3, 4]);
let includeShort = true;
let lightMode = false;

// Race mode state
let raceIndex = 0;
let racePlaying = false;
let raceSpeed = 5;
let raceAnimationId = null;
let raceYMin = null;
let raceYMax = null;

// GIF export state
let gifRecording = false;
let gifCancelled = false;
let gifFrames = [];
let gifTimeoutId = null;
const MAX_GIF_FRAMES = 60;  // Limit frames for file size
const GIF_WIDTH = 600;
const GIF_HEIGHT = 300;
const GIF_TIMEOUT_MS = 30000;  // 30 second timeout

// DOM Elements
const setupView = document.getElementById('setup-view');
const dashboardView = document.getElementById('dashboard-view');
const playersContainer = document.getElementById('players-container');
const loadingEl = document.getElementById('loading');

// Initialize
async function init() {
    const response = await fetch('/api/competition');
    competition = await response.json();

    if (competition && competition.players && competition.players.length > 0) {
        await showDashboard();
    } else {
        // No competition configured - show message
        showNoCompetition();
    }
}

function showNoCompetition() {
    setupView.classList.add('hidden');
    dashboardView.classList.add('hidden');

    // Create a simple message
    const msgDiv = document.createElement('div');
    msgDiv.className = 'view';
    msgDiv.innerHTML = `
        <div class="setup-container" style="text-align: center; padding-top: 100px;">
            <h1 style="color: var(--accent-color); font-size: 3rem; letter-spacing: 0.3em;">CHEESE STICK</h1>
            <p class="subtitle" style="margin-top: 20px;">Competition not yet configured</p>
            <p style="color: var(--text-muted); margin-top: 10px;">Check back soon!</p>
        </div>
    `;
    document.body.appendChild(msgDiv);
}

function showSetup() {
    setupView.classList.remove('hidden');
    dashboardView.classList.add('hidden');
    generatePlayerForms();

    // Clear pending icons
    Object.keys(pendingIcons).forEach(k => delete pendingIcons[k]);

    if (competition) {
        document.getElementById('comp-name').value = competition.name || '';
        document.getElementById('start-date').value = competition.start_date || '';

        competition.players.forEach((player, i) => {
            const form = document.querySelector(`.player-form[data-player="${i}"]`);
            if (form) {
                form.querySelector('.player-name').value = player.name || '';
                player.longs.forEach((symbol, j) => {
                    const input = form.querySelectorAll('.stock-input')[j];
                    if (input) input.value = symbol;
                });
                form.querySelector('.short-input').value = player.short || '';

                // Load existing icon
                if (player.icon) {
                    pendingIcons[i] = player.icon;
                    const preview = document.querySelector(`.icon-preview[data-player="${i}"]`);
                    preview.innerHTML = `<img src="${player.icon}" alt="Icon">`;
                    preview.classList.add('has-image');
                    document.querySelector(`.icon-remove-btn[data-player="${i}"]`).classList.remove('hidden');
                }
            }
        });
    }
}

async function showDashboard() {
    setupView.classList.add('hidden');
    dashboardView.classList.remove('hidden');
    document.getElementById('comp-title').textContent = competition.name || 'CHEESE STICK';
    generatePlayerToggles();
    await initializePlayerIcons();
    loadPerformanceData();
}

function generatePlayerForms() {
    playersContainer.innerHTML = '';

    for (let i = 0; i < NUM_PLAYERS; i++) {
        const color = PLAYER_COLORS[i];
        const defaultEmoji = DEFAULT_ICONS[i];
        const html = `
            <div class="player-form" data-player="${i}">
                <h3>
                    <span class="player-color" style="background: ${color}"></span>
                    Player ${i + 1}
                </h3>
                <div class="icon-upload-section">
                    <div class="icon-preview" data-player="${i}">${defaultEmoji}</div>
                    <input type="file" class="icon-upload-input" data-player="${i}" accept="image/*">
                    <button type="button" class="icon-upload-btn" data-player="${i}">Upload Icon</button>
                    <button type="button" class="icon-remove-btn hidden" data-player="${i}">Remove</button>
                </div>
                <div class="form-group">
                    <input type="text" class="player-name" placeholder="Name">
                </div>
                <div class="form-group">
                    <label>Long Positions (5 stocks, $20K each)</label>
                    <div class="stocks-row">
                        <input type="text" class="stock-input" placeholder="AAPL">
                        <input type="text" class="stock-input" placeholder="GOOGL">
                        <input type="text" class="stock-input" placeholder="MSFT">
                        <input type="text" class="stock-input" placeholder="AMZN">
                        <input type="text" class="stock-input" placeholder="NVDA">
                    </div>
                </div>
                <div class="short-section">
                    <label>Short Position</label>
                    <input type="text" class="short-input" placeholder="TSLA">
                </div>
            </div>
        `;
        playersContainer.insertAdjacentHTML('beforeend', html);
    }

    // Setup icon upload handlers
    setupIconUploadHandlers();
}

// Store uploaded icons temporarily before saving
const pendingIcons = {};

function setupIconUploadHandlers() {
    document.querySelectorAll('.icon-upload-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const playerIdx = btn.dataset.player;
            document.querySelector(`.icon-upload-input[data-player="${playerIdx}"]`).click();
        });
    });

    document.querySelectorAll('.icon-upload-input').forEach(input => {
        input.addEventListener('change', async (e) => {
            const playerIdx = input.dataset.player;
            const file = e.target.files[0];

            if (file) {
                try {
                    const circularImage = await processUploadedImage(file);
                    pendingIcons[playerIdx] = circularImage;

                    // Update preview
                    const preview = document.querySelector(`.icon-preview[data-player="${playerIdx}"]`);
                    preview.innerHTML = `<img src="${circularImage}" alt="Icon">`;
                    preview.classList.add('has-image');

                    // Show remove button
                    document.querySelector(`.icon-remove-btn[data-player="${playerIdx}"]`).classList.remove('hidden');
                } catch (err) {
                    console.error('Error processing image:', err);
                    alert('Failed to process image');
                }
            }
        });
    });

    document.querySelectorAll('.icon-remove-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const playerIdx = btn.dataset.player;
            delete pendingIcons[playerIdx];

            // Reset preview to default emoji
            const preview = document.querySelector(`.icon-preview[data-player="${playerIdx}"]`);
            preview.innerHTML = DEFAULT_ICONS[playerIdx];
            preview.classList.remove('has-image');

            // Hide remove button
            btn.classList.add('hidden');

            // Clear file input
            document.querySelector(`.icon-upload-input[data-player="${playerIdx}"]`).value = '';
        });
    });
}

function generatePlayerToggles() {
    const container = document.getElementById('player-toggles');
    container.innerHTML = '';

    competition.players.forEach((player, i) => {
        const btn = document.createElement('button');
        btn.className = 'player-toggle';
        btn.style.borderColor = player.color;
        btn.style.color = player.color;
        btn.textContent = player.name;
        btn.dataset.player = i;

        btn.addEventListener('click', () => {
            if (activePlayers.has(i)) {
                activePlayers.delete(i);
                btn.classList.add('inactive');
            } else {
                activePlayers.add(i);
                btn.classList.remove('inactive');
            }
            if (currentView === 'race') {
                calculateRaceBounds();
            }
            updateChart();
            updateStandings();
        });

        container.appendChild(btn);
    });
}

async function loadPerformanceData() {
    showLoading(true, 'Loading stock data...');

    try {
        const response = await fetch('/api/performance');
        performanceData = await response.json();

        if (performanceData.error) {
            alert(performanceData.error);
            return;
        }

        updateChart();
        updateStandings();
    } catch (error) {
        console.error('Error loading performance data:', error);
        alert('Failed to load performance data');
    } finally {
        showLoading(false);
    }
}

function getValue(historyItem) {
    return includeShort ? historyItem.value_with_short : historyItem.value;
}

function calculateRaceBounds() {
    let min = Infinity;
    let max = -Infinity;

    performanceData.players.forEach((player, i) => {
        if (!activePlayers.has(i)) return;
        player.history.forEach(h => {
            const val = getValue(h);
            if (val < min) min = val;
            if (val > max) max = val;
        });
    });

    const padding = (max - min) * 0.05;
    raceYMin = min - padding;
    raceYMax = max + padding;
}

function updateChart() {
    if (!performanceData) return;

    if (mainChart) {
        mainChart.destroy();
    }

    const ctx = document.getElementById('main-chart').getContext('2d');

    if (currentView === 'bar') {
        createBarChart(ctx);
    } else if (currentView === 'line') {
        createLineChart(ctx);
    } else if (currentView === 'race') {
        createLineChart(ctx, raceIndex);
    }
}

function createBarChart(ctx) {
    // Filter to only active players for proper scaling
    const activePlayerData = performanceData.players.map((player, i) => {
        if (!activePlayers.has(i)) return null;
        const history = player.history;
        return {
            name: player.name,
            value: history.length > 0 ? getValue(history[history.length - 1]) : INITIAL_INVESTMENT,
            color: player.color,
            index: i
        };
    }).filter(p => p !== null);

    // Calculate y-axis range to always include $100K baseline
    const values = activePlayerData.map(p => p.value);
    const minVal = Math.min(...values, INITIAL_INVESTMENT);
    const maxVal = Math.max(...values, INITIAL_INVESTMENT);
    const padding = (maxVal - minVal) * 0.1;

    mainChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: activePlayerData.map(p => p.name),
            datasets: [{
                data: activePlayerData.map(p => p.value),
                backgroundColor: activePlayerData.map(p => p.color),
                borderColor: activePlayerData.map(p => p.color),
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            onClick: (event, elements) => {
                if (elements.length > 0) {
                    const idx = elements[0].index;
                    const playerIndex = activePlayerData[idx].index;
                    showPlayerModal(playerIndex);
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            const value = context.raw;
                            const change = ((value - INITIAL_INVESTMENT) / INITIAL_INVESTMENT * 100).toFixed(2);
                            const sign = change >= 0 ? '+' : '';
                            return `$${value.toLocaleString()} (${sign}${change}%)`;
                        }
                    }
                },
                annotation: {
                    annotations: {
                        baseline: {
                            type: 'line',
                            yMin: INITIAL_INVESTMENT,
                            yMax: INITIAL_INVESTMENT,
                            borderColor: lightMode ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.5)',
                            borderWidth: 2,
                            borderDash: [6, 6]
                        }
                    }
                }
            },
            scales: {
                y: {
                    min: minVal - padding,
                    max: maxVal + padding,
                    grid: { color: 'rgba(128,128,128,0.2)' },
                    ticks: {
                        color: lightMode ? '#666' : '#888',
                        callback: (value) => '$' + value.toLocaleString()
                    }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: lightMode ? '#666' : '#888' }
                }
            }
        }
    });
}

function createLineChart(ctx, maxIndex = null) {
    const isRaceMode = maxIndex !== null;

    // Only include active players
    // Track original player index for emoji mapping
    let activePlayerIndices = [];
    const datasets = performanceData.players.map((player, i) => {
        if (!activePlayers.has(i)) {
            return null;  // Exclude completely
        }

        activePlayerIndices.push(i);

        let history = player.history;
        if (isRaceMode) {
            history = history.slice(0, maxIndex + 1);
        }

        // In race mode, show icon at the last point
        let pointRadius = 0;
        let pointStyle = 'circle';

        if (isRaceMode && history.length > 0) {
            // Array of radii - only last point is visible
            pointRadius = history.map((_, idx) => idx === history.length - 1 ? 20 : 0);
            pointStyle = playerIcons[i] || 'circle';
        }

        return {
            label: player.name,
            data: history.map(h => ({ x: h.date, y: getValue(h) })),
            borderColor: player.color,
            backgroundColor: player.color + '20',
            fill: false,
            tension: 0.1,
            pointRadius: pointRadius,
            pointStyle: pointStyle,
            pointHitRadius: 10,
            borderWidth: 2
        };
    }).filter(d => d !== null);

    const labels = performanceData.trading_days;

    const yAxisConfig = {
        grid: { color: 'rgba(128,128,128,0.2)' },
        ticks: {
            color: lightMode ? '#666' : '#888',
            callback: (value) => '$' + value.toLocaleString()
        }
    };

    if (isRaceMode && raceYMin !== null && raceYMax !== null) {
        yAxisConfig.min = raceYMin;
        yAxisConfig.max = raceYMax;
    }

    mainChart = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: isRaceMode ? { duration: 0 } : { duration: 400 },
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: { color: lightMode ? '#666' : '#888' }
                },
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            const value = context.raw.y;
                            const change = ((value - INITIAL_INVESTMENT) / INITIAL_INVESTMENT * 100).toFixed(2);
                            const sign = change >= 0 ? '+' : '';
                            return `${context.dataset.label}: $${value.toLocaleString()} (${sign}${change}%)`;
                        }
                    }
                }
            },
            scales: {
                y: yAxisConfig,
                x: {
                    grid: { color: 'rgba(128,128,128,0.1)' },
                    ticks: {
                        color: lightMode ? '#666' : '#888',
                        maxTicksLimit: 10
                    }
                }
            }
        }
    });
}

function updateStandings() {
    if (!performanceData) return;

    const standings = performanceData.players.map((player, i) => {
        const history = player.history;
        const currentValue = history.length > 0 ? getValue(history[history.length - 1]) : INITIAL_INVESTMENT;
        const change = ((currentValue - INITIAL_INVESTMENT) / INITIAL_INVESTMENT * 100);

        return {
            name: player.name,
            color: player.color,
            value: currentValue,
            change,
            index: i
        };
    }).sort((a, b) => b.value - a.value);

    const container = document.getElementById('standings-list');
    container.innerHTML = standings.map((s, i) => {
        const changeClass = s.change >= 0 ? 'positive' : 'negative';
        const sign = s.change >= 0 ? '+' : '';
        return `
            <div class="standing-item" data-player-index="${s.index}">
                <span class="standing-rank">${i + 1}</span>
                <span class="standing-name" style="color: ${s.color}">${s.name}</span>
                <span class="standing-value">$${s.value.toLocaleString()}</span>
                <span class="standing-change ${changeClass}">${sign}${s.change.toFixed(2)}%</span>
            </div>
        `;
    }).join('');

    // Add click handlers
    container.querySelectorAll('.standing-item').forEach(item => {
        item.addEventListener('click', () => {
            const playerIndex = parseInt(item.dataset.playerIndex);
            showPlayerModal(playerIndex);
        });
    });
}

function updateStandingsAtIndex(index) {
    if (!performanceData) return;

    const standings = performanceData.players.map((player, i) => {
        const history = player.history;
        const currentValue = index < history.length ? getValue(history[index]) : INITIAL_INVESTMENT;
        const change = ((currentValue - INITIAL_INVESTMENT) / INITIAL_INVESTMENT * 100);

        return {
            name: player.name,
            color: player.color,
            value: currentValue,
            change,
            index: i
        };
    }).sort((a, b) => b.value - a.value);

    const container = document.getElementById('standings-list');
    container.innerHTML = standings.map((s, i) => {
        const changeClass = s.change >= 0 ? 'positive' : 'negative';
        const sign = s.change >= 0 ? '+' : '';
        return `
            <div class="standing-item" data-player-index="${s.index}">
                <span class="standing-rank">${i + 1}</span>
                <span class="standing-name" style="color: ${s.color}">${s.name}</span>
                <span class="standing-value">$${s.value.toLocaleString()}</span>
                <span class="standing-change ${changeClass}">${sign}${s.change.toFixed(2)}%</span>
            </div>
        `;
    }).join('');

    container.querySelectorAll('.standing-item').forEach(item => {
        item.addEventListener('click', () => {
            const playerIndex = parseInt(item.dataset.playerIndex);
            showPlayerModal(playerIndex);
        });
    });
}

// Player Modal Functions
let currentPlayerData = null;
let currentPeriod = 'all';

async function showPlayerModal(playerIndex) {
    const modal = document.getElementById('player-modal');
    const titleEl = document.getElementById('player-modal-title');

    showLoading(true, 'Loading player details...');

    try {
        const response = await fetch(`/api/player-details/${playerIndex}`);
        const data = await response.json();

        if (data.error) {
            alert(data.error);
            return;
        }

        currentPlayerData = data;
        currentPeriod = 'all';

        titleEl.textContent = data.name;
        titleEl.style.color = data.color;

        // Reset period tabs
        document.querySelectorAll('.period-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.period === 'all');
        });

        // Render with default period
        renderPlayerDetails(data, 'all');

        modal.classList.remove('hidden');

        // Load news
        loadPlayerNews(data.symbols);

    } catch (error) {
        console.error('Error loading player details:', error);
        alert('Failed to load player details');
    } finally {
        showLoading(false);
    }
}

function renderPlayerDetails(data, period) {
    const summaryEl = document.getElementById('player-summary');
    const positionsEl = document.getElementById('player-positions');

    // Render summary
    const perf = data.performance[period];
    if (perf) {
        const changeClass = perf.change_pct >= 0 ? 'positive' : 'negative';
        const sign = perf.change_pct >= 0 ? '+' : '';
        summaryEl.innerHTML = `
            <div class="summary-card">
                <div class="label">Portfolio Value</div>
                <div class="value">$${perf.value.toLocaleString()}</div>
            </div>
            <div class="summary-card">
                <div class="label">${period === 'all' ? 'Total' : period.charAt(0).toUpperCase() + period.slice(1)} Change</div>
                <div class="value ${changeClass}">${sign}${perf.change_pct.toFixed(2)}%</div>
            </div>
        `;
    }

    // Render positions with period-specific changes
    positionsEl.innerHTML = data.positions.map(pos => {
        const periodChange = pos.periods && pos.periods[period] !== undefined ? pos.periods[period] : pos.gain_pct;
        const changeClass = periodChange >= 0 ? 'positive' : 'negative';
        const sign = periodChange >= 0 ? '+' : '';
        const valueLabel = pos.type === 'short' ? 'P&L' : 'Value';

        return `
            <div class="position-card">
                <div class="position-info">
                    <span class="position-symbol">${pos.symbol}</span>
                    <span class="position-type-badge ${pos.type}">${pos.type}</span>
                </div>
                <div class="position-value">
                    <div class="value">${valueLabel}: $${pos.current_value.toLocaleString()}</div>
                    <div class="change ${changeClass}">${sign}${periodChange.toFixed(2)}%</div>
                </div>
            </div>
        `;
    }).join('');
}

async function loadPlayerNews(symbols) {
    const newsEl = document.getElementById('news-list');
    newsEl.innerHTML = '<p style="color: var(--text-muted)">Loading news...</p>';

    try {
        const newsResponse = await fetch(`/api/news/${symbols.join(',')}`);
        const newsData = await newsResponse.json();

        if (newsData.news && newsData.news.length > 0) {
            newsEl.innerHTML = newsData.news.map(item => {
                const date = new Date(item.published * 1000);
                const dateStr = date.toLocaleDateString();
                return `
                    <div class="news-item">
                        <a href="${item.link}" target="_blank">${item.title}</a>
                        <div class="news-meta">
                            <span class="news-symbol">${item.symbol}</span>
                            ${item.publisher} - ${dateStr}
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            newsEl.innerHTML = '<p style="color: var(--text-muted)">No recent news available</p>';
        }
    } catch (error) {
        console.error('Error loading news:', error);
        newsEl.innerHTML = '<p style="color: var(--text-muted)">Failed to load news</p>';
    }
}

// Period tab click handlers
document.querySelectorAll('.period-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        if (!currentPlayerData) return;

        document.querySelectorAll('.period-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        currentPeriod = tab.dataset.period;
        renderPlayerDetails(currentPlayerData, currentPeriod);
    });
});

// Race Mode Functions
function startRace() {
    if (!performanceData) return;

    racePlaying = true;
    document.getElementById('play-pause').textContent = 'PAUSE';

    function animate() {
        if (!racePlaying) return;

        const maxIndex = performanceData.trading_days.length - 1;

        if (raceIndex < maxIndex) {
            raceIndex++;
            updateRaceDisplay();

            // Capture frame for GIF if recording
            if (gifRecording) {
                captureGifFrame();
            }

            const delay = 200 / raceSpeed;
            raceAnimationId = setTimeout(animate, delay);
        } else {
            stopRace();
            if (gifRecording) {
                finishGifRecording();
            }
        }
    }

    animate();
}

function stopRace() {
    racePlaying = false;
    document.getElementById('play-pause').textContent = 'PLAY';
    if (raceAnimationId) {
        clearTimeout(raceAnimationId);
        raceAnimationId = null;
    }
}

function resetRace() {
    stopRace();
    raceIndex = 0;
    calculateRaceBounds();
    updateRaceDisplay();
}

function updateRaceDisplay() {
    if (!performanceData) return;

    const date = performanceData.trading_days[raceIndex];
    document.getElementById('race-date').textContent = date;

    updateChart();
    updateStandingsAtIndex(raceIndex);
}

// GIF Export Functions
function startGifRecording() {
    const totalDays = performanceData.trading_days.length;

    // Calculate frame skip to stay under MAX_GIF_FRAMES
    const frameSkip = Math.max(1, Math.ceil(totalDays / MAX_GIF_FRAMES));

    gifRecording = true;
    gifCancelled = false;
    gifFrames = [];
    raceIndex = 0;
    calculateRaceBounds();

    document.getElementById('export-gif').classList.add('hidden');
    document.getElementById('cancel-gif').classList.remove('hidden');
    document.getElementById('gif-progress').textContent = 'Recording: 0%';

    // Set timeout
    gifTimeoutId = setTimeout(() => {
        if (gifRecording) {
            console.log('GIF recording timed out');
            cancelGifRecording('Timeout - took too long');
        }
    }, GIF_TIMEOUT_MS);

    // Record frames
    recordGifFrames(frameSkip, totalDays);
}

function recordGifFrames(frameSkip, totalDays) {
    if (gifCancelled) {
        resetGifUI();
        return;
    }

    if (raceIndex >= totalDays) {
        finishGifRecording();
        return;
    }

    // Update display
    updateRaceDisplay();

    // Capture frame
    captureGifFrame();

    // Update progress
    const progress = Math.round((raceIndex / totalDays) * 100);
    document.getElementById('gif-progress').textContent = `Recording: ${progress}%`;

    // Move to next frame
    raceIndex += frameSkip;
    if (raceIndex >= totalDays) {
        raceIndex = totalDays - 1;
        updateRaceDisplay();
        captureGifFrame();
        finishGifRecording();
    } else {
        // Use setTimeout to prevent blocking
        setTimeout(() => recordGifFrames(frameSkip, totalDays), 50);
    }
}

function captureGifFrame() {
    const canvas = document.getElementById('main-chart');

    // Create a scaled-down canvas for smaller GIF
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = GIF_WIDTH;
    tempCanvas.height = GIF_HEIGHT;
    const ctx = tempCanvas.getContext('2d');

    // Fill background (for transparency issues)
    ctx.fillStyle = lightMode ? '#f5f5f5' : '#0a0a0a';
    ctx.fillRect(0, 0, GIF_WIDTH, GIF_HEIGHT);

    // Draw scaled chart
    ctx.drawImage(canvas, 0, 0, GIF_WIDTH, GIF_HEIGHT);

    // Add date overlay
    const date = performanceData.trading_days[raceIndex];
    ctx.fillStyle = lightMode ? '#000' : '#00ff88';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(date, 10, 25);

    gifFrames.push(tempCanvas.toDataURL('image/png'));
}

function finishGifRecording() {
    if (gifCancelled) {
        resetGifUI();
        return;
    }

    clearTimeout(gifTimeoutId);
    document.getElementById('gif-progress').textContent = 'Creating GIF...';

    // Use gifshot to create GIF
    gifshot.createGIF({
        images: gifFrames,
        gifWidth: GIF_WIDTH,
        gifHeight: GIF_HEIGHT,
        interval: 0.15,  // 150ms per frame
        numFrames: gifFrames.length,
        frameDuration: 1,
        sampleInterval: 10,
        numWorkers: 2
    }, function(obj) {
        if (gifCancelled) {
            resetGifUI();
            return;
        }

        if (!obj.error) {
            // Download the GIF
            const a = document.createElement('a');
            a.href = obj.image;
            a.download = 'cheese-stick-race.gif';
            a.click();

            document.getElementById('gif-progress').textContent = 'Done!';
            setTimeout(resetGifUI, 1500);
        } else {
            console.error('GIF creation error:', obj.error);
            alert('Failed to create GIF: ' + obj.errorMsg);
            resetGifUI();
        }
    });
}

function cancelGifRecording(reason = 'Cancelled') {
    gifCancelled = true;
    gifRecording = false;
    clearTimeout(gifTimeoutId);
    document.getElementById('gif-progress').textContent = reason;
    setTimeout(resetGifUI, 1000);
}

function resetGifUI() {
    gifRecording = false;
    gifCancelled = false;
    gifFrames = [];
    clearTimeout(gifTimeoutId);

    document.getElementById('export-gif').classList.remove('hidden');
    document.getElementById('cancel-gif').classList.add('hidden');
    document.getElementById('gif-progress').textContent = '';
}

// Event Listeners
document.getElementById('save-competition').addEventListener('click', async () => {
    const name = document.getElementById('comp-name').value || 'Cheese Stick';
    const startDate = document.getElementById('start-date').value;

    if (!startDate) {
        alert('Please select a start date');
        return;
    }

    const players = [];
    const playerForms = document.querySelectorAll('.player-form');

    for (let i = 0; i < playerForms.length; i++) {
        const form = playerForms[i];
        const playerName = form.querySelector('.player-name').value || `Player ${i + 1}`;
        const stockInputs = form.querySelectorAll('.stock-input');
        const shortInput = form.querySelector('.short-input');

        const longs = Array.from(stockInputs).map(input => input.value.toUpperCase().trim()).filter(v => v);
        const short = shortInput.value.toUpperCase().trim();

        if (longs.length !== 5) {
            alert(`Player ${i + 1} must have exactly 5 long positions`);
            return;
        }

        if (!short) {
            alert(`Player ${i + 1} must have a short position`);
            return;
        }

        const playerData = {
            name: playerName,
            color: PLAYER_COLORS[i],
            longs,
            short
        };

        // Include custom icon if uploaded
        if (pendingIcons[i]) {
            playerData.icon = pendingIcons[i];
        }

        players.push(playerData);
    }

    competition = {
        name,
        start_date: startDate,
        initial_investment: INITIAL_INVESTMENT,
        stock_allocation: 20000,
        players
    };

    showLoading(true, 'Saving competition...');

    try {
        const response = await fetch('/api/competition', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(competition)
        });

        if (response.ok) {
            showDashboard();
        } else {
            alert('Failed to save competition');
        }
    } catch (error) {
        console.error('Error saving competition:', error);
        alert('Failed to save competition');
    } finally {
        showLoading(false);
    }
});

// Settings Modal
document.getElementById('settings-btn').addEventListener('click', () => {
    document.getElementById('settings-modal').classList.remove('hidden');
});

document.getElementById('short-toggle-btn').addEventListener('click', () => {
    includeShort = !includeShort;
    const btn = document.getElementById('short-toggle-btn');
    btn.textContent = includeShort ? 'ON' : 'OFF';
    btn.classList.toggle('active', includeShort);

    if (currentView === 'race') {
        calculateRaceBounds();
    }
    updateChart();
    updateStandings();
});

document.getElementById('theme-toggle-btn').addEventListener('click', () => {
    lightMode = !lightMode;
    const btn = document.getElementById('theme-toggle-btn');
    btn.textContent = lightMode ? 'DARK' : 'LIGHT';
    document.body.classList.toggle('light-mode', lightMode);
    updateChart();
});

// Close modals
document.querySelectorAll('.close-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const modalId = btn.dataset.close;
        document.getElementById(modalId).classList.add('hidden');
    });
});

// Close modal on background click
document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.add('hidden');
        }
    });
});

document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        currentView = btn.dataset.view;

        const raceControls = document.getElementById('race-controls');
        if (currentView === 'race') {
            raceControls.classList.remove('hidden');
            resetRace();
        } else {
            raceControls.classList.add('hidden');
            stopRace();
            updateChart();
            updateStandings();
        }
    });
});

document.getElementById('play-pause').addEventListener('click', () => {
    if (racePlaying) {
        stopRace();
    } else {
        if (raceIndex >= performanceData.trading_days.length - 1) {
            raceIndex = 0;
        }
        startRace();
    }
});

document.getElementById('speed-slider').addEventListener('input', (e) => {
    raceSpeed = parseInt(e.target.value);
    document.getElementById('speed-label').textContent = `Speed: ${raceSpeed}x`;
});

document.getElementById('export-gif').addEventListener('click', () => {
    if (!gifRecording) {
        startGifRecording();
    }
});

document.getElementById('cancel-gif').addEventListener('click', () => {
    cancelGifRecording('Cancelled');
});

function showLoading(show, text = 'Loading...') {
    if (show) {
        document.getElementById('loading-text').textContent = text;
        loadingEl.classList.remove('hidden');
    } else {
        loadingEl.classList.add('hidden');
    }
}

// Start app
init();
