const PLAYER_COLORS = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF'];
const DEFAULT_ICONS = ['🏎️', '🐎', '🚀', '🏍️', '🛸'];
const INITIAL_INVESTMENT = 100000;
const NUM_PLAYERS = 5;

let competition = null;
let isAuthenticated = false;

// DOM Elements
const loginView = document.getElementById('login-view');
const adminView = document.getElementById('admin-view');
const playersContainer = document.getElementById('players-container');

// Store uploaded icons temporarily
const pendingIcons = {};

// Check if already authenticated (session)
async function checkAuth() {
    try {
        const response = await fetch('/api/admin/check');
        const data = await response.json();
        if (data.authenticated) {
            isAuthenticated = true;
            showAdminPanel();
        }
    } catch (e) {
        console.log('Not authenticated');
    }
}

// Login
document.getElementById('login-btn').addEventListener('click', async () => {
    const password = document.getElementById('admin-password').value;

    try {
        const response = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });

        const data = await response.json();

        if (data.success) {
            isAuthenticated = true;
            document.getElementById('login-error').classList.add('hidden');
            showAdminPanel();
        } else {
            document.getElementById('login-error').classList.remove('hidden');
        }
    } catch (e) {
        alert('Login failed');
    }
});

// Enter key to login
document.getElementById('admin-password').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        document.getElementById('login-btn').click();
    }
});

async function showAdminPanel() {
    loginView.classList.add('hidden');
    adminView.classList.remove('hidden');

    // Load competition data
    const response = await fetch('/api/competition');
    competition = await response.json();

    generatePlayerForms();
    loadExistingData();
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

    setupIconUploadHandlers();
}

function loadExistingData() {
    if (!competition) return;

    document.getElementById('comp-name').value = competition.name || '';
    document.getElementById('start-date').value = competition.start_date || '';

    if (competition.players) {
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

// Process uploaded image to circular
function processUploadedImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            const imageData = e.target.result;
            const canvas = document.getElementById('icon-canvas');
            const ctx = canvas.getContext('2d');
            const img = new Image();

            img.onload = () => {
                ctx.clearRect(0, 0, 100, 100);
                ctx.beginPath();
                ctx.arc(50, 50, 50, 0, Math.PI * 2);
                ctx.closePath();
                ctx.clip();

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

                    const preview = document.querySelector(`.icon-preview[data-player="${playerIdx}"]`);
                    preview.innerHTML = `<img src="${circularImage}" alt="Icon">`;
                    preview.classList.add('has-image');

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

            const preview = document.querySelector(`.icon-preview[data-player="${playerIdx}"]`);
            preview.innerHTML = DEFAULT_ICONS[playerIdx];
            preview.classList.remove('has-image');

            btn.classList.add('hidden');
            document.querySelector(`.icon-upload-input[data-player="${playerIdx}"]`).value = '';
        });
    });
}

// Save competition
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

        if (pendingIcons[i]) {
            playerData.icon = pendingIcons[i];
        }

        players.push(playerData);
    }

    const competitionData = {
        name,
        start_date: startDate,
        initial_investment: INITIAL_INVESTMENT,
        stock_allocation: 20000,
        players
    };

    try {
        const response = await fetch('/api/admin/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(competitionData)
        });

        if (response.ok) {
            const statusEl = document.getElementById('save-status');
            statusEl.textContent = 'Changes saved successfully!';
            statusEl.classList.remove('hidden');
            statusEl.style.color = '#00ff88';
            setTimeout(() => statusEl.classList.add('hidden'), 3000);
        } else {
            alert('Failed to save. Are you logged in?');
        }
    } catch (error) {
        console.error('Error saving competition:', error);
        alert('Failed to save competition');
    }
});

// Back to site
document.getElementById('back-to-site').addEventListener('click', () => {
    window.location.href = '/';
});

// Initialize
checkAuth();
