from flask import Flask, jsonify, request, send_from_directory, session
import yfinance as yf
import json
import os
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
import secrets

app = Flask(__name__, static_folder='.')
app.secret_key = os.environ.get('SECRET_KEY', secrets.token_hex(32))

# Admin password - set via environment variable or defaults to 'cheesestick'
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'cheesestick')

# MongoDB setup (optional - falls back to JSON file if not configured)
MONGODB_URI = os.environ.get('MONGODB_URI')
db = None

if MONGODB_URI:
    try:
        from pymongo import MongoClient
        client = MongoClient(MONGODB_URI)
        db = client.cheesestick
        print("Connected to MongoDB")
    except Exception as e:
        print(f"MongoDB connection failed: {e}")
        db = None

COMPETITION_FILE = 'competition.json'
CACHE_FILE = 'price_cache.json'

def load_competition():
    # Try MongoDB first
    if db is not None:
        try:
            doc = db.competition.find_one({'_id': 'main'})
            if doc:
                doc.pop('_id', None)
                return doc
        except Exception as e:
            print(f"MongoDB load error: {e}")

    # Fall back to JSON file
    if os.path.exists(COMPETITION_FILE):
        with open(COMPETITION_FILE, 'r') as f:
            return json.load(f)
    return None

def save_competition(data):
    # Try MongoDB first
    if db is not None:
        try:
            db.competition.replace_one(
                {'_id': 'main'},
                {**data, '_id': 'main'},
                upsert=True
            )
            print("Saved to MongoDB")
            return
        except Exception as e:
            print(f"MongoDB save error: {e}")

    # Fall back to JSON file
    with open(COMPETITION_FILE, 'w') as f:
        json.dump(data, f, indent=2)

def load_cache():
    if os.path.exists(CACHE_FILE):
        with open(CACHE_FILE, 'r') as f:
            return json.load(f)
    return {}

def save_cache(cache):
    with open(CACHE_FILE, 'w') as f:
        json.dump(cache, f)

def get_stock_data(symbols, start_date, end_date=None):
    """Fetch adjusted close prices for symbols from start_date to end_date."""
    if end_date is None:
        end_date = datetime.now().strftime('%Y-%m-%d')

    cache = load_cache()
    cache_key = f"{','.join(sorted(symbols))}_{start_date}_{end_date}"
    today = datetime.now().strftime('%Y-%m-%d')

    # Use cache if not today's data
    if cache_key in cache and end_date != today:
        return cache[cache_key]

    try:
        # Download data for all symbols
        data = yf.download(symbols, start=start_date, end=end_date, auto_adjust=True, progress=False)

        if data.empty:
            return None

        # Handle single vs multiple symbols
        if len(symbols) == 1:
            prices = {symbols[0]: {}}
            for date, row in data.iterrows():
                date_str = date.strftime('%Y-%m-%d')
                prices[symbols[0]][date_str] = float(row['Close'])
        else:
            prices = {symbol: {} for symbol in symbols}
            for date, row in data.iterrows():
                date_str = date.strftime('%Y-%m-%d')
                for symbol in symbols:
                    if symbol in row['Close'].index:
                        price = row['Close'][symbol]
                        if not (price != price):  # Check for NaN
                            prices[symbol][date_str] = float(price)

        # Cache the result
        cache[cache_key] = prices
        save_cache(cache)

        return prices
    except Exception as e:
        print(f"Error fetching stock data: {e}")
        return None

def validate_symbol(symbol):
    """Check if a stock symbol is valid."""
    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info
        return info.get('regularMarketPrice') is not None or info.get('previousClose') is not None
    except:
        return False

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:path>')
def static_files(path):
    return send_from_directory('.', path)

@app.route('/api/competition', methods=['GET'])
def get_competition():
    data = load_competition()
    if data:
        return jsonify(data)
    return jsonify(None)

# Admin routes
@app.route('/admin')
def admin_page():
    return send_from_directory('.', 'admin.html')

@app.route('/api/admin/login', methods=['POST'])
def admin_login():
    data = request.json
    password = data.get('password', '')

    if password == ADMIN_PASSWORD:
        session['admin'] = True
        return jsonify({'success': True})
    return jsonify({'success': False}), 401

@app.route('/api/admin/check', methods=['GET'])
def admin_check():
    return jsonify({'authenticated': session.get('admin', False)})

@app.route('/api/admin/logout', methods=['POST'])
def admin_logout():
    session.pop('admin', None)
    return jsonify({'success': True})

@app.route('/api/admin/save', methods=['POST'])
def admin_save():
    if not session.get('admin'):
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.json
    save_competition(data)
    return jsonify({'success': True})

@app.route('/api/validate-symbol/<symbol>', methods=['GET'])
def validate_symbol_endpoint(symbol):
    is_valid = validate_symbol(symbol.upper())
    return jsonify({'valid': is_valid, 'symbol': symbol.upper()})

@app.route('/api/performance', methods=['GET'])
def get_performance():
    competition = load_competition()
    if not competition:
        return jsonify({'error': 'No competition configured'}), 400

    start_date = competition['start_date']
    players = competition['players']
    allocation = competition['stock_allocation']

    # Collect all unique symbols
    all_symbols = set()
    for player in players:
        all_symbols.update(player['longs'])
        all_symbols.add(player['short'])

    # Fetch all stock data
    prices = get_stock_data(list(all_symbols), start_date)
    if not prices:
        return jsonify({'error': 'Failed to fetch stock data'}), 500

    # Find common trading days
    all_dates = set()
    for symbol_prices in prices.values():
        all_dates.update(symbol_prices.keys())
    trading_days = sorted(all_dates)

    if not trading_days:
        return jsonify({'error': 'No trading data available'}), 500

    # Calculate performance for each player
    performance = []
    for player in players:
        player_data = {
            'name': player['name'],
            'color': player['color'],
            'history': []
        }

        # Get start prices (first available day)
        first_day = trading_days[0]
        start_prices = {}
        for symbol in player['longs'] + [player['short']]:
            if symbol in prices and first_day in prices[symbol]:
                start_prices[symbol] = prices[symbol][first_day]

        # Calculate shares bought at start
        shares = {}
        for symbol in player['longs']:
            if symbol in start_prices:
                shares[symbol] = allocation / start_prices[symbol]

        short_symbol = player['short']
        short_start_price = start_prices.get(short_symbol, 0)

        # Calculate value for each trading day
        for day in trading_days:
            total_value = 0

            # Long positions
            for symbol in player['longs']:
                if symbol in prices and day in prices[symbol] and symbol in shares:
                    current_price = prices[symbol][day]
                    total_value += shares[symbol] * current_price

            # Short position - P&L only (no principal added)
            # You "bet" $20K that the stock goes down
            # If stock drops 50%, you gain $10K. If stock doubles, you lose $20K.
            short_pnl = 0
            if short_symbol in prices and day in prices[short_symbol] and short_start_price > 0:
                current_price = prices[short_symbol][day]
                price_change_pct = (current_price - short_start_price) / short_start_price
                short_pnl = -price_change_pct * allocation  # Negative because short profits when price drops

            player_data['history'].append({
                'date': day,
                'value': round(total_value, 2),
                'value_with_short': round(total_value + short_pnl, 2),
                'short_pnl': round(short_pnl, 2)
            })

        performance.append(player_data)

    return jsonify({
        'start_date': start_date,
        'trading_days': trading_days,
        'players': performance,
        'initial_investment': competition['initial_investment']
    })

@app.route('/api/stock-details', methods=['GET'])
def get_stock_details():
    """Get detailed breakdown of each player's positions."""
    competition = load_competition()
    if not competition:
        return jsonify({'error': 'No competition configured'}), 400

    start_date = competition['start_date']
    players = competition['players']
    allocation = competition['stock_allocation']

    # Collect all unique symbols
    all_symbols = set()
    for player in players:
        all_symbols.update(player['longs'])
        all_symbols.add(player['short'])

    prices = get_stock_data(list(all_symbols), start_date)
    if not prices:
        return jsonify({'error': 'Failed to fetch stock data'}), 500

    trading_days = sorted(set().union(*[set(p.keys()) for p in prices.values()]))
    if not trading_days:
        return jsonify({'error': 'No trading data'}), 500

    first_day = trading_days[0]
    last_day = trading_days[-1]

    details = []
    for player in players:
        player_detail = {
            'name': player['name'],
            'positions': []
        }

        for symbol in player['longs']:
            if symbol in prices and first_day in prices[symbol] and last_day in prices[symbol]:
                start_price = prices[symbol][first_day]
                current_price = prices[symbol][last_day]
                shares = allocation / start_price
                current_value = shares * current_price
                gain_pct = ((current_price - start_price) / start_price) * 100

                player_detail['positions'].append({
                    'symbol': symbol,
                    'type': 'long',
                    'shares': round(shares, 4),
                    'start_price': round(start_price, 2),
                    'current_price': round(current_price, 2),
                    'current_value': round(current_value, 2),
                    'gain_pct': round(gain_pct, 2)
                })

        # Short position - P&L only
        short_symbol = player['short']
        if short_symbol in prices and first_day in prices[short_symbol] and last_day in prices[short_symbol]:
            start_price = prices[short_symbol][first_day]
            current_price = prices[short_symbol][last_day]
            price_change_pct = (current_price - start_price) / start_price
            short_pnl = -price_change_pct * allocation

            player_detail['positions'].append({
                'symbol': short_symbol,
                'type': 'short',
                'start_price': round(start_price, 2),
                'current_price': round(current_price, 2),
                'current_value': round(short_pnl, 2),
                'gain_pct': round(-price_change_pct * 100, 2)
            })

        details.append(player_detail)

    return jsonify({'players': details, 'as_of': last_day})

def fetch_yahoo_rss_news(symbol):
    """Fetch news from Yahoo Finance RSS feed."""
    news_items = []
    try:
        url = f"https://feeds.finance.yahoo.com/rss/2.0/headline?s={symbol}&region=US&lang=en-US"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=5) as response:
            xml_data = response.read()
            root = ET.fromstring(xml_data)

            for item in root.findall('.//item')[:5]:
                title = item.find('title')
                link = item.find('link')
                pub_date = item.find('pubDate')

                if title is not None and title.text:
                    # Parse date
                    published = 0
                    if pub_date is not None and pub_date.text:
                        try:
                            dt = datetime.strptime(pub_date.text, '%a, %d %b %Y %H:%M:%S %z')
                            published = int(dt.timestamp())
                        except:
                            published = int(datetime.now().timestamp())

                    news_items.append({
                        'symbol': symbol,
                        'title': title.text,
                        'publisher': 'Yahoo Finance',
                        'link': link.text if link is not None else '',
                        'published': published
                    })
    except Exception as e:
        print(f"RSS error for {symbol}: {e}")

    return news_items

@app.route('/api/news/<symbols>', methods=['GET'])
def get_news(symbols):
    """Get news for multiple stock symbols using multiple sources."""
    symbol_list = symbols.upper().split(',')
    all_news = []

    for symbol in symbol_list[:6]:
        # Try Yahoo RSS first
        rss_news = fetch_yahoo_rss_news(symbol)
        all_news.extend(rss_news)

        # Also try yfinance as backup
        if len(rss_news) < 2:
            try:
                ticker = yf.Ticker(symbol)
                news = ticker.news
                if news:
                    for item in news[:3]:
                        title = item.get('title', '')
                        # Avoid duplicates
                        if title and not any(n['title'] == title for n in all_news):
                            all_news.append({
                                'symbol': symbol,
                                'title': title,
                                'publisher': item.get('publisher', 'Unknown'),
                                'link': item.get('link', ''),
                                'published': item.get('providerPublishTime', 0)
                            })
            except Exception as e:
                print(f"yfinance news error for {symbol}: {e}")

    # Sort by publish time, newest first
    all_news.sort(key=lambda x: x['published'], reverse=True)

    return jsonify({'news': all_news[:12]})

def calculate_portfolio_value(prices, player, allocation, ref_day, current_day):
    """Calculate portfolio value between two dates."""
    total = 0

    # Long positions
    for symbol in player['longs']:
        if symbol in prices and ref_day in prices[symbol] and current_day in prices[symbol]:
            start_price = prices[symbol][ref_day]
            current_price = prices[symbol][current_day]
            shares = allocation / prices[symbol][ref_day] if ref_day == list(prices[symbol].keys())[0] else allocation / start_price
            # Actually we need shares from competition start
            first_day = sorted(prices[symbol].keys())[0]
            if first_day in prices[symbol]:
                shares = allocation / prices[symbol][first_day]
                total += shares * prices[symbol][current_day]

    return total

def get_period_reference_day(trading_days, period):
    """Get the reference day for a given period."""
    if not trading_days:
        return None

    last_day = trading_days[-1]
    last_date = datetime.strptime(last_day, '%Y-%m-%d')

    if period == 'all':
        return trading_days[0]
    elif period == 'month':
        target = last_date - timedelta(days=30)
    elif period == 'week':
        target = last_date - timedelta(days=7)
    elif period == 'day':
        target = last_date - timedelta(days=1)
    else:
        return trading_days[0]

    target_str = target.strftime('%Y-%m-%d')

    # Find closest trading day on or before target
    for day in reversed(trading_days):
        if day <= target_str:
            return day

    return trading_days[0]

@app.route('/api/player-details/<int:player_index>', methods=['GET'])
def get_player_details(player_index):
    """Get detailed info for a specific player with period-based performance."""
    competition = load_competition()
    if not competition:
        return jsonify({'error': 'No competition configured'}), 400

    if player_index < 0 or player_index >= len(competition['players']):
        return jsonify({'error': 'Invalid player index'}), 400

    player = competition['players'][player_index]
    start_date = competition['start_date']
    allocation = competition['stock_allocation']
    initial_investment = competition['initial_investment']

    # Get all symbols for this player
    all_symbols = player['longs'] + [player['short']]

    # Fetch price data
    prices = get_stock_data(all_symbols, start_date)
    if not prices:
        return jsonify({'error': 'Failed to fetch stock data'}), 500

    trading_days = sorted(set().union(*[set(p.keys()) for p in prices.values()]))
    if not trading_days:
        return jsonify({'error': 'No trading data'}), 500

    first_day = trading_days[0]
    last_day = trading_days[-1]

    # Calculate current total portfolio value
    def calc_total_value(ref_day):
        total = 0
        # Longs
        for symbol in player['longs']:
            if symbol in prices and first_day in prices[symbol] and ref_day in prices[symbol]:
                shares = allocation / prices[symbol][first_day]
                total += shares * prices[symbol][ref_day]
        # Short P&L
        short_symbol = player['short']
        if short_symbol in prices and first_day in prices[short_symbol] and ref_day in prices[short_symbol]:
            short_start = prices[short_symbol][first_day]
            short_current = prices[short_symbol][ref_day]
            price_change_pct = (short_current - short_start) / short_start
            total += -price_change_pct * allocation
        return total

    # Calculate period-based performance
    period_performance = {}
    for period in ['all', 'month', 'week', 'day']:
        ref_day = get_period_reference_day(trading_days, period)
        if ref_day:
            start_value = calc_total_value(ref_day) if period != 'all' else initial_investment
            end_value = calc_total_value(last_day)

            if period == 'all':
                change = end_value - initial_investment
                change_pct = ((end_value - initial_investment) / initial_investment) * 100
            else:
                change = end_value - start_value
                change_pct = ((end_value - start_value) / start_value) * 100 if start_value > 0 else 0

            period_performance[period] = {
                'value': round(end_value, 2),
                'change': round(change, 2),
                'change_pct': round(change_pct, 2)
            }

    positions = []

    # Long positions with period data
    for symbol in player['longs']:
        if symbol in prices and first_day in prices[symbol] and last_day in prices[symbol]:
            start_price = prices[symbol][first_day]
            current_price = prices[symbol][last_day]
            shares = allocation / start_price
            current_value = shares * current_price
            gain_pct = ((current_price - start_price) / start_price) * 100

            # Calculate period changes for this position
            pos_periods = {}
            for period in ['all', 'month', 'week', 'day']:
                ref_day = get_period_reference_day(trading_days, period)
                if ref_day and ref_day in prices[symbol]:
                    ref_price = prices[symbol][ref_day]
                    period_change = ((current_price - ref_price) / ref_price) * 100
                    pos_periods[period] = round(period_change, 2)

            positions.append({
                'symbol': symbol,
                'type': 'long',
                'shares': round(shares, 4),
                'start_price': round(start_price, 2),
                'current_price': round(current_price, 2),
                'current_value': round(current_value, 2),
                'gain_pct': round(gain_pct, 2),
                'periods': pos_periods
            })

    # Short position
    short_symbol = player['short']
    if short_symbol in prices and first_day in prices[short_symbol] and last_day in prices[short_symbol]:
        start_price = prices[short_symbol][first_day]
        current_price = prices[short_symbol][last_day]
        price_change_pct = (current_price - start_price) / start_price
        short_pnl = -price_change_pct * allocation

        # Period changes for short
        pos_periods = {}
        for period in ['all', 'month', 'week', 'day']:
            ref_day = get_period_reference_day(trading_days, period)
            if ref_day and ref_day in prices[short_symbol]:
                ref_price = prices[short_symbol][ref_day]
                # For short, negative stock movement = positive return
                period_stock_change = ((current_price - ref_price) / ref_price) * 100
                pos_periods[period] = round(-period_stock_change, 2)

        positions.append({
            'symbol': short_symbol,
            'type': 'short',
            'start_price': round(start_price, 2),
            'current_price': round(current_price, 2),
            'current_value': round(short_pnl, 2),
            'gain_pct': round(-price_change_pct * 100, 2),
            'periods': pos_periods
        })

    return jsonify({
        'name': player['name'],
        'color': player['color'],
        'positions': positions,
        'symbols': all_symbols,
        'performance': period_performance,
        'as_of': last_day
    })

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5050))
    debug = os.environ.get('FLASK_DEBUG', 'true').lower() == 'true'
    print(f"Starting Cheese Stick server at http://localhost:{port}")
    app.run(debug=debug, host='0.0.0.0', port=port)
