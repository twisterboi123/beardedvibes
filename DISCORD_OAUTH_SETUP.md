# Discord OAuth Setup Guide

To enable user login on BeardedVibes, you need to configure Discord OAuth.

## Quick Setup Steps

### 1. Create Discord Application
1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application" 
3. Give it a name (e.g., "BeardedVibes")
4. Click "Create"

### 2. Configure OAuth2
1. In your application, go to **OAuth2** → **General**
2. Copy your **Client ID**
3. Click "Reset Secret" and copy your **Client Secret** (keep this private!)
4. Under **Redirects**, add:
   ```
   http://localhost:3000/api/auth/callback
   ```
   (For production, add your actual domain: `https://yourdomain.com/api/auth/callback`)
5. Click "Save Changes"

### 3. Update .env File
Open your `.env` file and add:

```env
DISCORD_CLIENT_ID=your_client_id_here
DISCORD_CLIENT_SECRET=your_client_secret_here
DISCORD_REDIRECT_URI=http://localhost:3000/api/auth/callback
JWT_SECRET=your-random-secret-here
```

**Generate a secure JWT_SECRET:**
- Use a random string generator
- Or run in terminal: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

### 4. Restart the Server
Stop your server (Ctrl+C) and start it again:
```bash
npm start
```

## Testing
1. Go to http://localhost:3000
2. Click "Sign in" 
3. You should be redirected to Discord authorization
4. After authorizing, you'll be redirected back and logged in!

## For Render Deployment
When deploying to Render:
1. Add your production URL to Discord OAuth redirects
2. Set all environment variables in Render dashboard
3. Use your Render app URL for `DISCORD_REDIRECT_URI` and `FRONTEND_BASE_URL`

## Troubleshooting
- **"Cannot GET /api/auth/login"**: Make sure the server is running
- **"Discord OAuth not configured"**: Check that CLIENT_ID and CLIENT_SECRET are in .env
- **Redirect URI mismatch**: Ensure the redirect URI in Discord matches exactly what's in your .env
