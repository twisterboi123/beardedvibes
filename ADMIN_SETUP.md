# Admin System Setup Guide

## What's Been Added

Your website now has a complete admin system with the following features:

### Database Changes
- Added three new columns to the `users` table:
  - `isAdmin` - Boolean, identifies admin users
  - `isBanned` - Boolean, prevents banned users from logging in
  - `isVerified` - Boolean, marks verified creators

### Admin Dashboard
- **URL:** `/admin.html`
- **Features:** Delete posts, ban/unban users, verify creators
- **Access:** Only visible to users with `isAdmin=true`

### Admin Endpoints

#### 1. Delete a Post
```bash
DELETE /api/post/:id
# Requires: Admin authentication
# Response: { success: true, message: "Post deleted" }
```

#### 2. Ban/Unban a User
```bash
POST /api/admin/user/:discordId/ban
Content-Type: application/json

{ "banned": true }  # or false to unban
# Requires: Admin authentication
```

#### 3. Verify/Unverify a Creator
```bash
POST /api/admin/user/:discordId/verify
Content-Type: application/json

{ "verified": true }  # or false to unverify
# Requires: Admin authentication
```

#### 4. Promote/Demote Admin
```bash
POST /api/admin/user/:discordId/admin
Content-Type: application/json

{ "admin": true }  # or false to demote
# Requires: Admin authentication
```

### Setup: Making Yourself an Admin

**Simple Method (Recommended):**

1. **Get your Discord ID:**
   - In Discord, enable Developer Mode (Settings → Advanced → Developer Mode)
   - Right-click your avatar and select "Copy User ID"

2. **Add your Discord ID to `.env`:**
   ```env
   ADMIN_IDS=YOUR_DISCORD_ID,YOUR_FRIENDS_DISCORD_ID
   ```
   (Separate multiple IDs with commas)

3. **On Render:**
   - Go to your service → Environment
   - Add/update `ADMIN_IDS` with your Discord IDs
   - Save (auto-redeploys)

4. **Log out and back in** — you'll automatically be an admin!

**Alternative Method (Setup Endpoint):**

If you prefer using the setup endpoint, set `SETUP_SECRET` in your `.env` and call:
```javascript
fetch('/api/setup/promote-admin', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ 
    secret: 'your-setup-secret',
    discordId: 'YOUR_DISCORD_ID' 
  })
}).then(r => r.json()).then(console.log)
```

### Security Features

- **Ban Prevention**: Users marked as `isBanned` cannot log in via Discord OAuth
- **Admin-Only Endpoints**: All admin endpoints require the user to be authenticated and have `isAdmin=true`
- **Auto-Promotion**: Users in `ADMIN_IDS` are automatically promoted on login

### Using Admin Features

Once you're an admin, you'll see:
- **⚙️ Admin link** in the sidebar
- **Admin Dashboard** at `/admin.html` with:
  - Posts tab: View and delete all videos
  - Users tab: Ban/unban and verify/unverify users

The dashboard updates in real-time and shows success/error messages for all actions.

