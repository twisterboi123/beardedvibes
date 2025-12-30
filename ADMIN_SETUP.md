# Admin System Setup Guide

## What's Been Added

Your website now has a complete admin system with the following features:

### Database Changes
- Added three new columns to the `users` table:
  - `isAdmin` - Boolean, identifies admin users
  - `isBanned` - Boolean, prevents banned users from logging in
  - `isVerified` - Boolean, marks verified creators

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

1. **Set a SETUP_SECRET in your .env file:**
   ```env
   SETUP_SECRET=your-secure-secret-here
   ```

2. **Get your Discord ID:**
   - In Discord, enable Developer Mode (Settings → Advanced → Developer Mode)
   - Right-click your avatar and select "Copy User ID"

3. **Call the setup endpoint:**
   ```bash
   curl -X POST http://localhost:3000/api/setup/promote-admin \
     -H "Content-Type: application/json" \
     -d '{"secret":"your-secure-secret-here","discordId":"YOUR_DISCORD_ID"}'
   ```
   
   Or in your browser's developer console (F12):
   ```javascript
   fetch('/api/setup/promote-admin', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ 
       secret: 'your-secure-secret-here',
       discordId: 'YOUR_DISCORD_ID' 
     })
   }).then(r => r.json()).then(console.log)
   ```

4. **Log out and back in** for the admin status to take effect

### Security Features

- **Ban Prevention**: Users marked as `isBanned` cannot log in via Discord OAuth
- **Admin-Only Endpoints**: All admin endpoints require the user to be authenticated and have `isAdmin=true`
- **Setup Secret**: The admin promotion endpoint requires a setup secret from your `.env` file to prevent unauthorized admin creation

### Using Admin Features

Once you're an admin, you can:

1. **Delete posts** - Use the DELETE /api/post/:id endpoint
2. **Ban/unban users** - Prevents them from accessing the site
3. **Verify creators** - Marks users as official/verified creators
4. **Manage other admins** - Promote or demote other users to admin

### Next Steps: Frontend Admin Dashboard

The backend is ready! You can now:
- Create an admin dashboard page to manage users and posts
- Add delete/ban/verify buttons to the admin interface
- Display verified badges on creator profiles

Would you like me to create an admin dashboard page for you?
