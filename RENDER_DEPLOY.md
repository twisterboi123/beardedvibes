# BeardedVibes - Render Deployment Guide

## Prerequisites
1. Render account (free tier works)
2. Cloudinary account (free tier - for file uploads)
3. PostgreSQL database (Render provides free managed Postgres)

## Setup Steps

### 1. Create Cloudinary Account
- Sign up at https://cloudinary.com (free tier)
- Get your: Cloud Name, API Key, API Secret from dashboard

### 2. Deploy to Render

#### Create PostgreSQL Database
1. Go to Render dashboard → New → PostgreSQL
2. Name: `beardedvibes-db` (free tier)
3. Copy the **Internal Database URL** once created

#### Deploy Web Service
1. Go to Render dashboard → New → Web Service
2. Connect your GitHub repo (push this code to GitHub first)
3. Settings:
   - **Name**: `beardedvibes`
   - **Region**: Choose closest to you
   - **Branch**: `main`
   - **Root Directory**: `server`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. Environment Variables (add in Render dashboard):
   ```
   DATABASE_URL=<paste your Postgres Internal Database URL>
   CLOUDINARY_CLOUD_NAME=<your cloudinary cloud name>
   CLOUDINARY_API_KEY=<your cloudinary api key>
   CLOUDINARY_API_SECRET=<your cloudinary api secret>
   SERVER_PORT=3000
   MAX_UPLOAD_MB=15
   ```
5. Deploy!

### 3. Update Bot Configuration (on your PC)
Edit your local `.env`:
```
BOT_TOKEN=your_discord_bot_token
TARGET_CHANNEL_ID=your_channel_id
BACKEND_UPLOAD_URL=https://beardedvibes.onrender.com/api/upload
FRONTEND_BASE_URL=https://beardedvibes.onrender.com
```

Restart your bot: `cd bot && npm start`

## How It Works on Render
- **Database**: PostgreSQL stores posts/comments (persists across deploys)
- **File Storage**: Cloudinary hosts all uploads (persists, CDN-backed)
- **Web Service**: Serves API + frontend at your-app.onrender.com
- **Bot**: Runs on your PC, uploads to Render backend

## Free Tier Limits
- Render: 750 hours/month (enough for 1 service 24/7)
- PostgreSQL: 1GB storage, 97 connection hours/month
- Cloudinary: 25GB storage, 25GB bandwidth/month

## Troubleshooting
- If uploads fail: check Cloudinary credentials in Render env vars
- If database errors: verify DATABASE_URL is set correctly
- Bot can't connect: update BACKEND_UPLOAD_URL with your Render URL
