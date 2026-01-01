# Google OAuth Setup Guide

This guide will walk you through setting up Google OAuth for your BeardedVibes website.

## Step 1: Access Google Cloud Console

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Sign in with your Google account

## Step 2: Create or Select a Project

1. Click on the project dropdown at the top of the page (next to "Google Cloud")
2. Click **"New Project"** in the top right
3. Enter a project name (e.g., "BeardedVibes")
4. Click **"Create"**
5. Wait for the project to be created and select it from the dropdown

## Step 3: Enable Google+ API (or People API)

1. In the left sidebar, click **"APIs & Services"** → **"Library"**
2. Search for **"Google+ API"** or **"People API"**
3. Click on it and press **"Enable"**
4. Wait for it to enable (this may take a few seconds)

## Step 4: Configure OAuth Consent Screen

1. In the left sidebar, go to **"APIs & Services"** → **"OAuth consent screen"**
2. Select **"External"** user type (unless you have a Google Workspace)
3. Click **"Create"**

### Fill in the required information:
- **App name**: BeardedVibes
- **User support email**: Your email address
- **App logo**: (optional) Upload your logo
- **Application home page**: `https://beardedvibes.com`
- **Application privacy policy link**: (optional) Add if you have one
- **Application terms of service**: (optional) Add if you have one
- **Authorized domains**: Add `beardedvibes.com`
- **Developer contact information**: Your email address

4. Click **"Save and Continue"**

### Scopes:
1. Click **"Add or Remove Scopes"**
2. Add these scopes:
   - `.../auth/userinfo.email`
   - `.../auth/userinfo.profile`
   - `openid`
3. Click **"Update"** then **"Save and Continue"**

### Test Users (if app is not published):
1. Add your email and any test users you want to allow
2. Click **"Save and Continue"**

### Summary:
1. Review your settings
2. Click **"Back to Dashboard"**

## Step 5: Create OAuth 2.0 Credentials

1. In the left sidebar, go to **"APIs & Services"** → **"Credentials"**
2. Click **"Create Credentials"** at the top
3. Select **"OAuth client ID"**

### Configure the OAuth Client:
1. **Application type**: Select **"Web application"**
2. **Name**: "BeardedVibes Web Client"

3. **Authorized JavaScript origins**:
   - Click **"Add URI"**
   - Add: `https://beardedvibes.com`
   - (For local testing, also add: `http://localhost:3000`)

4. **Authorized redirect URIs**:
   - Click **"Add URI"**
   - Add: `https://beardedvibes.com/api/auth/google/callback`
   - (For local testing, also add: `http://localhost:3000/api/auth/google/callback`)

5. Click **"Create"**

## Step 6: Copy Your Credentials

A popup will appear with your credentials:
- **Client ID**: Something like `123456789-abcdefg.apps.googleusercontent.com`
- **Client Secret**: Something like `GOCSPX-abcd1234efgh5678`

⚠️ **Important**: Copy both of these values immediately!

## Step 7: Add Credentials to Your .env File

1. Open your `.env` file in the project root
2. Add these lines at the end:

```env
# Google OAuth (for Google sign-in)
GOOGLE_CLIENT_ID=paste_your_client_id_here
GOOGLE_CLIENT_SECRET=paste_your_client_secret_here
GOOGLE_REDIRECT_URI=https://beardedvibes.com/api/auth/google/callback
```

3. Replace the placeholder values with your actual credentials from Step 6
4. Save the file

### Example:
```env
# Google OAuth (for Google sign-in)
GOOGLE_CLIENT_ID=123456789-abcdefghijklmnop.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-Abc123Def456Ghi789
GOOGLE_REDIRECT_URI=https://beardedvibes.com/api/auth/google/callback
```

## Step 8: Restart Your Server

For the changes to take effect, you need to restart your Node.js server:

1. Stop the server (press `Ctrl+C` in the terminal)
2. Start it again with your usual command (e.g., `npm start` or `node server.js`)

## Step 9: Test Google Login

1. Go to your website: `https://beardedvibes.com`
2. Click **"Sign in"**
3. Click **"Sign in with Google"**
4. You should be redirected to Google's login page
5. Sign in with your Google account
6. Authorize the app
7. You should be redirected back to your website, now logged in!

## Troubleshooting

### "Error 400: redirect_uri_mismatch"
- Make sure the redirect URI in your Google Console exactly matches the one in your `.env` file
- Check for trailing slashes - they must match exactly
- Make sure you're using HTTPS in production

### "Error 403: access_denied"
- If your app is not published, make sure the Google account you're testing with is added as a test user in the OAuth consent screen

### "Google OAuth not configured" error page
- Make sure you've added the credentials to your `.env` file
- Make sure you've restarted the server after adding credentials
- Check that there are no typos in the environment variable names

### Users can't sign in
- Make sure your app is published (or users are added as test users)
- Check that all required scopes are enabled
- Verify the authorized domains include your domain

## Publishing Your App (Optional)

If you want anyone to be able to sign in with Google (not just test users):

1. Go to **"OAuth consent screen"** in Google Cloud Console
2. Click **"Publish App"**
3. Confirm the publication
4. Google may require verification if you're requesting sensitive scopes

Note: Basic profile and email scopes usually don't require verification.

## For Local Development

If you want to test Google login on `localhost:3000`:

1. Add to **Authorized JavaScript origins**: `http://localhost:3000`
2. Add to **Authorized redirect URIs**: `http://localhost:3000/api/auth/google/callback`
3. In your `.env`, temporarily change:
   ```env
   GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
   FRONTEND_BASE_URL=http://localhost:3000
   ```

## Security Best Practices

1. **Never commit your `.env` file to Git** - it contains secrets
2. **Keep your Client Secret private** - treat it like a password
3. **Use different credentials for development and production**
4. **Regularly review authorized applications** in Google Cloud Console
5. **Enable 2FA on your Google Cloud account**

## Need Help?

- [Google OAuth 2.0 Documentation](https://developers.google.com/identity/protocols/oauth2)
- [Google Cloud Console Help](https://support.google.com/cloud/)

---

✅ Once completed, users will be able to sign in with either Discord or Google!
