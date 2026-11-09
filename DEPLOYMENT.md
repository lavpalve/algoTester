# Deployment Guide: Paper Trading Automation

## Current Setup Analysis

### Database Usage

Your project uses **MongoDB** for:

1. **Stock daily candles** (`stocks` collection)
   - 495 NIFTY 500 stocks
   - Historical daily OHLC data (2021-2026)
   - **Size: ~1-2 GB**

2. **Index candles** (`index_candles_daily` collection)
   - NIFTY 50 daily data
   - **Size: ~10-50 MB**

3. **Fundamentals snapshots** (`fundamentals_snapshots` collection)
   - ROE, profit growth, revenue data for 495 stocks
   - Yearly income statement and balance sheet
   - **Size: ~5-10 MB**

4. **Intraday 5-minute candles** (file cache in `data/swing/intraday/`)
   - Only for backtest validation
   - **Size: ~2.9 GB total**
   - Not needed for daily paper trading

**Total MongoDB data: ~1-2 GB** (excluding intraday cache)

### Current Database Connection

```javascript
// Default: Local MongoDB
SWING_MONGO_URI = mongodb://localhost:27017
SWING_MONGO_DB = msvStorage
```

---

## Option 1: Vercel Deployment ❌ NOT RECOMMENDED

### Why Vercel Won't Work

**Vercel is for serverless functions, NOT for:**
- ❌ Long-running cron jobs (your script takes 30+ seconds)
- ❌ File system writes (paper trading needs to write ledger.json, reports)
- ❌ Direct MongoDB connections (serverless = cold starts)
- ❌ Heavy data processing (backtesting, scanning 495 stocks)

**Vercel limitations:**
- Serverless functions timeout: 10 seconds (free), 60 seconds (pro)
- No persistent file system
- No background jobs
- Expensive for this use case

**Verdict: Don't use Vercel for this project.**

---

## Option 2: VPS Deployment ✅ RECOMMENDED

### Best Options for Paper Trading

#### A. **DigitalOcean Droplet** (Recommended)

**Cost:** $6/month (Basic Droplet)
- 1 GB RAM
- 25 GB SSD
- 1 CPU

**Perfect for:**
- Running MongoDB locally
- Daily cron job
- File storage for reports

**Setup:**
```bash
# On your VPS
sudo apt update
sudo apt install -y nodejs npm mongodb

# Clone your repo
git clone <your-repo>
cd algoTester

# Install dependencies
npm install

# Set up MongoDB
sudo systemctl start mongodb
sudo systemctl enable mongodb

# Import your current MongoDB data
mongodump --uri="mongodb://localhost:27017/msvStorage" --out=backup
# Then on VPS: mongorestore backup/

# Set up cron
crontab -e
# Add: 0 8 * * 1-5 cd /home/user/algoTester && npm run swing:daily >> /var/log/swing-daily.log 2>&1
```

**Pros:**
- ✅ Full control
- ✅ Local MongoDB (fast)
- ✅ Persistent file storage
- ✅ Simple cron setup
- ✅ Cheap ($6/month)

**Cons:**
- Need to manage server updates
- Need to back up data manually

#### B. **Railway.app** (Alternative)

**Cost:** $5-10/month
- Persistent volumes
- MongoDB addon available
- Easy deployment from GitHub

**Pros:**
- ✅ Easier than VPS
- ✅ Git push to deploy
- ✅ Built-in MongoDB

**Cons:**
- More expensive than VPS
- Less control

#### C. **Render.com** (Alternative)

**Cost:** $7/month (background worker)
- Persistent disk
- Cron jobs
- MongoDB addon

---

## Option 3: MongoDB Atlas ✅ FREE TIER SUFFICIENT

### Is Atlas Free Tier Enough?

**MongoDB Atlas Free Tier (M0):**
- ✅ **512 MB storage** - NOT enough for your full dataset (~1-2 GB)
- ✅ **Shared RAM** - will be slow for scanning 495 stocks
- ✅ **No backups** on free tier
- ✅ **Connection from anywhere**

**Verdict: Free tier is TOO SMALL for your data.**

### Atlas Paid Tiers

**M2 Shared Cluster: $9/month**
- 2 GB storage ✓ (enough)
- Shared RAM (will be slow)
- Manual backups

**M10 Dedicated: $57/month**
- 10 GB storage ✓✓
- 2 GB RAM ✓
- Automatic backups
- Better performance

**Recommendation:**
- If using Atlas, go with **M2 ($9/month)** minimum
- Better: Use **VPS with local MongoDB** ($6/month total)

---

## Recommended Setup: VPS + Local MongoDB

### Architecture

```
┌─────────────────────────────────────────┐
│  DigitalOcean Droplet ($6/month)        │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │  MongoDB (local)                │   │
│  │  - stocks collection (1-2 GB)   │   │
│  │  - index_candles_daily (50 MB)  │   │
│  │  - fundamentals_snapshots       │   │
│  └─────────────────────────────────┘   │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │  Node.js App                    │   │
│  │  - swing/paper-trade.js         │   │
│  │  - swing/fetch-swing-data.js    │   │
│  └─────────────────────────────────┘   │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │  Cron Job (daily 8 AM IST)      │   │
│  │  npm run swing:daily             │   │
│  └─────────────────────────────────┘   │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │  File Storage                   │   │
│  │  data/swing/paper/              │   │
│  │  - ledger.json                  │   │
│  │  - latest.md                    │   │
│  │  - reports/                     │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

---

## Step-by-Step Deployment (DigitalOcean)

### 1. Create Droplet

1. Go to https://digitalocean.com
2. Create account (get $200 credit for 60 days)
3. Create Droplet:
   - **Image:** Ubuntu 22.04 LTS
   - **Plan:** Basic ($6/month)
   - **Region:** Bangalore (closest to India)
   - **SSH Key:** Add your public key

### 2. Initial Server Setup

```bash
# SSH into your droplet
ssh root@YOUR_DROPLET_IP

# Update system
apt update && apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Install MongoDB
wget -qO - https://www.mongodb.org/static/pgp/server-7.0.asc | apt-key add -
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | tee /etc/apt/sources.list.d/mongodb-org-7.0.list
apt update
apt install -y mongodb-org

# Start MongoDB
systemctl start mongod
systemctl enable mongod

# Verify installations
node --version   # Should show v20.x
mongo --version  # Should show MongoDB 7.x
```

### 3. Deploy Your App

```bash
# Create app directory
mkdir -p /opt/algoTester
cd /opt/algoTester

# Clone your repo (or upload via SCP)
git clone https://github.com/YOUR_USERNAME/algoTester.git .

# Install dependencies
npm install

# Copy .env file
nano .env
# Paste your UPSTOX_ANALYTICS_TOKEN

# Set MongoDB connection
echo "SWING_MONGO_URI=mongodb://localhost:27017" >> .env
echo "SWING_MONGO_DB=msvStorage" >> .env
```

### 4. Import Your Current Data

On your local machine:
```bash
# Export MongoDB data
mongodump --uri="mongodb://localhost:27017/msvStorage" --out=./mongo-backup

# Upload to VPS
scp -r mongo-backup root@YOUR_DROPLET_IP:/opt/algoTester/
```

On VPS:
```bash
# Import data
cd /opt/algoTester
mongorestore --uri="mongodb://localhost:27017" mongo-backup/

# Verify
mongo msvStorage --eval "db.stocks.count()"  # Should show ~495
```

### 5. Test Paper Trading Manually

```bash
cd /opt/algoTester
npm run swing:daily
```

Check output for errors.

### 6. Set Up Cron Job

```bash
# Edit crontab
crontab -e

# Add this line (runs daily at 8:00 AM IST)
# Convert IST to UTC: 8 AM IST = 2:30 AM UTC
30 2 * * 1-5 cd /opt/algoTester && /usr/bin/npm run swing:daily >> /var/log/swing-daily.log 2>&1

# Save and exit

# Verify cron is set
crontab -l
```

**Cron schedule explained:**
```
30 2 * * 1-5
│  │ │ │ └─ Monday to Friday
│  │ │ └─── Every month
│  │ └───── Every day of month
│  └─────── 2 AM UTC
└────────── 30 minutes

= 2:30 AM UTC = 8:00 AM IST
```

### 7. Set Up Logging

```bash
# Create log rotation
nano /etc/logrotate.d/swing-daily

# Add:
/var/log/swing-daily.log {
    daily
    rotate 7
    compress
    missingok
    notifempty
}

# Save and exit
```

### 8. Monitor Your Cron Job

```bash
# View today's log
tail -f /var/log/swing-daily.log

# View paper trading report
cat /opt/algoTester/data/swing/paper/V1.7b-check-roe15-or-growth15/latest.md

# Check cron execution history
grep CRON /var/log/syslog
```

---

## Alternative: Run Locally on Your Mac

If you don't want to pay for VPS, run it on your Mac:

### Set Up Cron on Mac

```bash
# Edit crontab
crontab -e

# Add (runs at 8:00 AM IST every weekday)
0 8 * * 1-5 cd /Users/ankush/Projects/algoTester && /usr/local/bin/npm run swing:daily >> ~/swing-daily.log 2>&1

# Save and exit (press Esc, then :wq)

# Verify
crontab -l
```

**Pros:**
- ✅ Free
- ✅ No VPS setup

**Cons:**
- ❌ Mac must be on and awake at 8 AM
- ❌ Can't run if you're traveling
- ❌ Unreliable

---

## Data Backup Strategy

### Daily Automated Backup

Add to your cron:

```bash
# Backup MongoDB weekly (Sunday 3 AM)
0 3 * * 0 mongodump --uri="mongodb://localhost:27017/msvStorage" --out=/opt/backups/mongo-$(date +\%Y\%m\%d) && find /opt/backups -mtime +30 -delete

# Backup paper trading data daily (after swing:daily runs)
45 2 * * 1-5 cp -r /opt/algoTester/data/swing/paper /opt/backups/paper-$(date +\%Y\%m\%d) && find /opt/backups -type d -name "paper-*" -mtime +7 -exec rm -rf {} +
```

---

## Cost Comparison

| Solution | Monthly Cost | Storage | Setup Difficulty |
|---|---:|---:|---|
| **VPS (DigitalOcean)** | **$6** | 25 GB | Medium |
| **VPS + Atlas M2** | $15 | 2 GB + 25 GB | Medium |
| **Railway** | $10 | 10 GB | Easy |
| **Render** | $7 | 10 GB | Easy |
| **Local Mac** | $0 | Unlimited | Easy |
| ~~Vercel~~ | — | ❌ Won't work | — |

---

## Recommended Final Setup

### Best Option: DigitalOcean VPS ($6/month)

1. **Deploy to VPS** with local MongoDB
2. **Cron job** runs daily at 8 AM IST
3. **View reports** via SSH or set up simple web server
4. **Backup** MongoDB weekly, paper data daily

### Setup Commands Summary

```bash
# 1. Create $6/month droplet on DigitalOcean
# 2. SSH in
ssh root@YOUR_IP

# 3. One-line setup script
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
apt update && apt install -y nodejs mongodb-org git && \
systemctl start mongod && systemctl enable mongod && \
mkdir -p /opt/algoTester && cd /opt/algoTester && \
echo "Setup complete. Now clone your repo and import MongoDB data."

# 4. Clone repo, install, import data
git clone <your-repo> .
npm install
# Upload and restore MongoDB backup
mongorestore mongo-backup/

# 5. Set up cron
crontab -e
# Add: 30 2 * * 1-5 cd /opt/algoTester && /usr/bin/npm run swing:daily >> /var/log/swing-daily.log 2>&1
```

---

## Viewing Reports Remotely

### Option A: SSH and Read File

```bash
ssh root@YOUR_IP
cat /opt/algoTester/data/swing/paper/V1.7b-check-roe15-or-growth15/latest.md
```

### Option B: Simple Web Server

```bash
# On VPS, add to package.json scripts:
"serve-reports": "npx http-server data/swing/paper -p 8080"

# Run in background
nohup npm run serve-reports &

# Access at: http://YOUR_DROPLET_IP:8080/V1.7b-check-roe15-or-growth15/latest.md
```

### Option C: Email Reports Daily

Install nodemailer and add to swing/daily.sh:

```bash
# After paper trading runs, email the report
node -e "
const fs = require('fs');
const nodemailer = require('nodemailer');
const report = fs.readFileSync('data/swing/paper/V1.7b-check-roe15-or-growth15/latest.md', 'utf8');
// Configure and send email (Gmail SMTP)
"
```

---

## Next Steps

1. **Decide:** VPS or local Mac?
2. **If VPS:** Create DigitalOcean account, get $200 credit
3. **Deploy:** Follow step-by-step guide above
4. **Test:** Run manually first, then enable cron
5. **Monitor:** Check logs for first week
6. **Verify:** After 1 week, review paper trading results

---

## Questions?

Let me know which option you prefer and I'll help you set it up!
