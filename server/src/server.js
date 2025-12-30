import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import { fileURLToPath } from 'url';
import mime from 'mime-types';
import { createDatabase } from './database.js';
import { createStorage } from './storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from project root (then fallback to local .env)
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });
dotenv.config();

const app = express();
const port = Number(process.env.SERVER_PORT || 3000);
const maxUploadMb = Number(process.env.MAX_UPLOAD_MB || 15);
const uploadsDir = path.resolve(__dirname, '..', 'uploads');
const publicDir = path.resolve(__dirname, '..', '..', 'public');
const frontendBase = (process.env.FRONTEND_BASE_URL || `http://localhost:${port}`).replace(/\/$/, '');
const jwtSecret = process.env.JWT_SECRET || 'dev-secret-change-me';
const isProd = process.env.NODE_ENV === 'production';
const discordClientId = process.env.DISCORD_CLIENT_ID;
const discordClientSecret = process.env.DISCORD_CLIENT_SECRET;
const discordRedirectUri = (process.env.DISCORD_REDIRECT_URI || `${frontendBase}/api/auth/callback`).replace(/\/$/, '');
const sessionCookieOptions = {
	httpOnly: true,
	sameSite: 'lax',
	secure: isProd,
	maxAge: 1000 * 60 * 60 * 24 * 30,
	path: '/'
};

fs.mkdirSync(uploadsDir, { recursive: true });

// Database setup (Postgres on Render, SQLite locally)
const dbConfig = process.env.DATABASE_URL
	? { type: 'postgres', url: process.env.DATABASE_URL, ssl: true }
	: { type: 'sqlite', path: process.env.DATABASE_PATH || path.resolve(__dirname, '..', '..', 'data.sqlite') };
const db = createDatabase(dbConfig);
await db.init();

// Storage setup (Cloudinary on Render, local filesystem locally)
const storageConfig = process.env.CLOUDINARY_CLOUD_NAME
	? { type: 'cloudinary', cloudName: process.env.CLOUDINARY_CLOUD_NAME, apiKey: process.env.CLOUDINARY_API_KEY, apiSecret: process.env.CLOUDINARY_API_SECRET }
	: { type: 'local', uploadsDir };
const storage = createStorage(storageConfig);

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.mp4', '.webm']);
const ALLOWED_MIME = new Set([
	'image/jpeg',
	'image/png',
	'image/webp',
	'video/mp4',
	'video/webm'
]);

// Configure multer storage and validation
const multerStorage = multer.diskStorage({
	destination: uploadsDir,
	filename: (_req, file, cb) => {
		const ext = path.extname(file.originalname).toLowerCase();
		const safeExt = ALLOWED_EXTENSIONS.has(ext) ? ext : '';
		const unique = `${Date.now()}-${crypto.randomUUID()}`;
		cb(null, `${unique}${safeExt}`);
	}
});

const upload = multer({
	storage: multerStorage,
	limits: { fileSize: maxUploadMb * 1024 * 1024 },
	fileFilter: (_req, file, cb) => {
		const ext = path.extname(file.originalname).toLowerCase();
		if (!ALLOWED_EXTENSIONS.has(ext) || !ALLOWED_MIME.has(file.mimetype)) {
			return cb(new Error('Unsupported file type'));
		}
		cb(null, true);
	}
});

// Core middleware and static hosting
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(publicDir));

function signSession(user) {
	const discordId = user.discordId ?? user.discordid ?? user.discord_id;
	const username = user.username ?? user.name ?? 'Unknown';
	const avatar = user.avatar ?? user.avatarUrl ?? user.picture ?? null;
	const isAdmin = user.isAdmin ?? user.isadmin ?? false;
	return jwt.sign({ id: user.id, discordId, username, avatar, isAdmin }, jwtSecret, { expiresIn: '30d' });
}

function normalizeUser(user) {
	if (!user) return undefined;
	const discordId = user.discordId ?? user.discordid ?? user.discord_id;
	if (!discordId) return undefined;
	const username = user.username ?? user.name ?? 'Unknown';
	const avatar = user.avatar ?? user.avatarUrl ?? user.picture ?? null;
	const isAdmin = user.isAdmin ?? user.isadmin ?? false;
	return { id: user.id, discordId, username, avatar, isAdmin };
}

async function authOptional(req, res, next) {
	const token = req.cookies?.session;
	if (!token) return next();
	try {
		const decoded = jwt.verify(token, jwtSecret);
		let user = normalizeUser(decoded);

		if (!user && decoded?.id && typeof db.getUserById === 'function') {
			const dbUser = await db.getUserById(decoded.id);
			user = normalizeUser(dbUser);
			if (user) {
				const refreshed = signSession(user);
				res.cookie('session', refreshed, sessionCookieOptions);
			}
		}

		req.user = user;
	} catch (_err) {
		req.user = undefined;
	}
	return next();
}

function requireAuth(req, res, next) {
	if (!req.user) {
		return res.status(401).json({ error: 'Login required' });
	}
	return next();
}

function requireAdmin(req, res, next) {
	if (!req.user || !req.user.isAdmin) {
		return res.status(403).json({ error: 'Admin access required' });
	}
	return next();
}

app.use(authOptional);

function detectType(mimetype) {
	if (mimetype.startsWith('image/')) return 'image';
	if (mimetype.startsWith('video/')) return 'video';
	return 'unknown';
}

// Upload endpoint: accepts one validated file and records it as a draft (auth required)
app.post('/api/upload', requireAuth, (req, res) => {
	upload.single('file')(req, res, async (err) => {
		if (err) {
			console.error('Upload error:', err.message);
			return res.status(400).json({ error: err.message });
		}

		if (!req.file) {
			return res.status(400).json({ error: 'File is required' });
		}

		const uploaderDiscordId = req.user?.discordId;
		const uploaderName = (req.user?.username || 'Unknown').trim().slice(0, 80) || 'Unknown';
		if (!uploaderDiscordId) {
			res.clearCookie('session', sessionCookieOptions);
			return res.status(401).json({ error: 'Login expired. Please sign in again.' });
		}
		const format = req.body?.format === 'short' ? 'short' : 'long';
		const publishNow = req.body?.publish === 'true' || req.body?.publish === 'on';
		const title = String(req.body?.title || '').trim().slice(0, 200);
		const description = String(req.body?.description || '').trim().slice(0, 2000);

		try {
			await db.upsertUser({ discordId: uploaderDiscordId, username: uploaderName, avatar: req.user?.avatar || null });
		} catch (userErr) {
			console.warn('Could not upsert uploader user', userErr?.message);
		}

		const type = detectType(req.file.mimetype);
		if (type === 'unknown') {
			fs.unlink(req.file.path, () => {});
			return res.status(400).json({ error: 'Unsupported file type' });
		}

		try {
			const fileUrl = await storage.upload(req.file.path, req.file.filename);
			const editToken = crypto.randomBytes(24).toString('hex');
			const createdAt = new Date().toISOString();

			const data = {
				filename: fileUrl,
				type,
				title,
				description,
				uploaderDiscordId,
				uploaderName,
				status: publishNow ? 'published' : 'draft',
				editToken,
				createdAt,
				format
			};

			console.log('Attempting to insert post with data:', { ...data, filename: '[url]' });
			const info = await db.insertPost(data);
			console.log('Post inserted successfully with ID:', info.lastInsertRowid);
			return res.status(201).json({
				id: info.lastInsertRowid,
				editToken,
				fileUrl: storage.getUrl(fileUrl),
				type,
				format,
				status: data.status
			});
		} catch (uploadErr) {
			console.error('Storage/DB upload error:', uploadErr);
			console.error('Error stack:', uploadErr.stack);
			return res.status(500).json({ error: 'Failed to save file', details: uploadErr.message });
		}
	});
});

// List published posts for homepage/gallery
app.get('/api/posts', async (req, res) => {
	const rows = await db.listPublished();
	const likedSet = req.user ? new Set(await db.getUserLikes(req.user.id)) : null;
	return res.json({ posts: rows.map((row) => ({
		id: row.id,
		title: row.title,
		description: row.description,
		fileUrl: storage.getUrl(row.filename),
		type: row.type,
		format: row.format || 'long',
		likes: row.likes,
		createdAt: row.createdAt,
		uploaderName: row.uploaderName,
		uploaderAvatar: row.uploaderAvatar || null,
		liked: likedSet ? likedSet.has(Number(row.id)) : false
	})) });
});

// Trending feed: most liked, then newest
app.get('/api/posts/trending', async (req, res) => {
	const rows = await db.listTrending();
	const likedSet = req.user ? new Set(await db.getUserLikes(req.user.id)) : null;
	return res.json({ posts: rows.map((row) => ({
		id: row.id,
		title: row.title,
		description: row.description,
		fileUrl: storage.getUrl(row.filename),
		type: row.type,
		format: row.format || 'long',
		likes: row.likes,
		createdAt: row.createdAt,
		uploaderName: row.uploaderName,
		uploaderAvatar: row.uploaderAvatar || null,
		liked: likedSet ? likedSet.has(Number(row.id)) : false
	})) });
});

// Liked feed: user’s liked posts
app.get('/api/posts/liked', async (req, res) => {
	if (!req.user) return res.status(401).json({ error: 'Login required' });
	const rows = await db.listLiked(req.user.id);
	const likedSet = new Set(await db.getUserLikes(req.user.id));
	return res.json({ posts: rows.map((row) => ({
		id: row.id,
		title: row.title,
		description: row.description,
		fileUrl: storage.getUrl(row.filename),
		type: row.type,
		format: row.format || 'long',
		likes: row.likes,
		createdAt: row.createdAt,
		uploaderName: row.uploaderName,
		uploaderAvatar: row.uploaderAvatar || null,
		liked: likedSet.has(Number(row.id))
	})) });
});

// History feed: posts the user viewed most recently
app.get('/api/posts/history', async (req, res) => {
	if (!req.user) return res.status(401).json({ error: 'Login required' });
	const rows = await db.listHistory(req.user.id);
	const likedSet = new Set(await db.getUserLikes(req.user.id));
	return res.json({ posts: rows.map((row) => ({
		id: row.id,
		title: row.title,
		description: row.description,
		fileUrl: storage.getUrl(row.filename),
		type: row.type,
		format: row.format || 'long',
		likes: row.likes,
		createdAt: row.createdAt,
		uploaderName: row.uploaderName,
		uploaderAvatar: row.uploaderAvatar || null,
		liked: likedSet.has(Number(row.id))
	})) });
});

// Watch Later feed: user’s saved posts
app.get('/api/posts/watchlater', async (req, res) => {
	if (!req.user) return res.status(401).json({ error: 'Login required' });
	const rows = await db.listWatchlist(req.user.id);
	const likedSet = new Set(await db.getUserLikes(req.user.id));
	return res.json({ posts: rows.map((row) => ({
		id: row.id,
		title: row.title,
		description: row.description,
		fileUrl: storage.getUrl(row.filename),
		type: row.type,
		format: row.format || 'long',
		likes: row.likes,
		createdAt: row.createdAt,
		uploaderName: row.uploaderName,
		uploaderAvatar: row.uploaderAvatar || null,
		liked: likedSet.has(Number(row.id))
	})) });
});

// Public post lookup; drafts are only visible with a correct edit token
app.get('/api/post/:id', async (req, res) => {
	const id = Number(req.params.id);
	if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

	const token = req.query.token;
	const row = await db.getPost(id);
	if (!row) return res.status(404).json({ error: 'Not found' });

	const tokenMatches = token && token === row.editToken;
	const isPublished = row.status === 'published';
	const isOwner = req.user?.discordId && row.uploaderDiscordId && req.user.discordId === row.uploaderDiscordId;
	const canSeeDraft = tokenMatches || isOwner;
	if (!isPublished && !canSeeDraft) {
		return res.status(404).json({ error: 'Not found' });
	}

	const liked = req.user ? await db.hasUserLiked(id, req.user.id) : false;

	return res.json({
		id: row.id,
		filename: row.filename,
		type: row.type,
		title: row.title,
		description: row.description,
		status: row.status,
		uploaderDiscordId: row.uploaderDiscordId,
		uploaderName: row.uploaderName,
		uploaderAvatar: row.uploaderAvatar || null,
		createdAt: row.createdAt,
		fileUrl: storage.getUrl(row.filename),
		format: row.format || 'long',
		likes: row.likes,
		liked,
		canEdit: Boolean(tokenMatches)
	});
});

// Record view in history (auth required)
app.post('/api/post/:id/view', requireAuth, async (req, res) => {
	const id = Number(req.params.id);
	if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
	const row = await db.getPost(id);
	if (!row || row.status !== 'published') return res.status(404).json({ error: 'Not found' });
	await db.recordView(id, req.user.id);
	return res.json({ ok: true });
});

// Authenticated like toggle endpoint
app.post('/api/post/:id/like', requireAuth, async (req, res) => {
	const id = Number(req.params.id);
	if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

	const row = await db.getPost(id);
	if (!row || row.status !== 'published') return res.status(404).json({ error: 'Not found' });

	const alreadyLiked = await db.hasUserLiked(id, req.user.id);
	const likes = await db.setLike(id, req.user.id, !alreadyLiked);

	return res.json({ likes, liked: !alreadyLiked });
});

// Watch later toggle (auth required)
app.post('/api/post/:id/watchlater', requireAuth, async (req, res) => {
	const id = Number(req.params.id);
	if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
	const row = await db.getPost(id);
	if (!row || row.status !== 'published') return res.status(404).json({ error: 'Not found' });
	const has = await db.hasWatchLater(id, req.user.id);
	const nowHas = await db.setWatchLater(id, req.user.id, !has);
	return res.json({ watchLater: nowHas });
});

// Follow endpoints
app.get('/api/user/:discordId/follow', async (req, res) => {
	const targetDiscordId = req.params.discordId;
	if (!targetDiscordId) return res.status(400).json({ error: 'Invalid user' });
	const followerCount = await db.followerCount(targetDiscordId);
	const following = req.user ? await db.hasFollow(req.user.id, targetDiscordId) : false;
	return res.json({ following, followerCount });
});

app.post('/api/user/:discordId/follow', requireAuth, async (req, res) => {
	const targetDiscordId = req.params.discordId;
	if (!targetDiscordId) return res.status(400).json({ error: 'Invalid user' });
	if (req.user.discordId === targetDiscordId) return res.status(400).json({ error: "You can't follow yourself" });

	// Ensure the target exists in users table for follower counts/joins
	if (typeof db.getUserByDiscordId === 'function') {
		const existing = await db.getUserByDiscordId(targetDiscordId);
		if (!existing) {
			const safeName = String(req.body?.username || 'Unknown').slice(0, 80) || 'Unknown';
			const safeAvatar = req.body?.avatar || null;
			try {
				await db.upsertUser({ discordId: targetDiscordId, username: safeName, avatar: safeAvatar });
			} catch (_err) {
				// ignore
			}
		}
	}

	const current = await db.hasFollow(req.user.id, targetDiscordId);
	const desired = typeof req.body?.follow === 'boolean' ? req.body.follow : !current;
	const following = await db.setFollow(req.user.id, targetDiscordId, desired);
	const followerCount = await db.followerCount(targetDiscordId);
	return res.json({ following, followerCount });
});

// Subscribe aliases (reuse follow logic)
app.get('/api/user/:discordId/subscribe', async (req, res) => {
	return app._router.handle({ ...req, url: `/api/user/${req.params.discordId}/follow`, method: 'GET' }, res, () => {});
});

app.post('/api/user/:discordId/subscribe', (req, res, next) => {
	// Delegate to follow handler while keeping auth guard
	req.url = `/api/user/${req.params.discordId}/follow`;
	return app._router.handle(req, res, next);
});

// Comments: list
app.get('/api/post/:id/comments', async (req, res) => {
	const id = Number(req.params.id);
	if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

	const row = await db.getPost(id);
	if (!row || row.status !== 'published') return res.status(404).json({ error: 'Not found' });

	const comments = await db.listComments(id);
	return res.json({ comments });
});

// Comments: create
app.post('/api/post/:id/comment', requireAuth, async (req, res) => {
	const id = Number(req.params.id);
	if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

	const { text = '' } = req.body;
	const trimmedText = String(text).trim().slice(0, 800);
	if (!trimmedText) return res.status(400).json({ error: 'Comment text is required' });

	const row = await db.getPost(id);
	if (!row || row.status !== 'published') return res.status(404).json({ error: 'Not found' });

	const createdAt = new Date().toISOString();
	const commentId = await db.insertComment(id, req.user.id, trimmedText, createdAt);

	return res.status(201).json({
		comment: { id: commentId, author: req.user.username, text: trimmedText, createdAt }
	});
});

// Edit endpoint: requires the edit token and publishes the post
app.post('/api/post/:id/edit', async (req, res) => {
	const id = Number(req.params.id);
	if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

	const { token, title = '', description = '' } = req.body;
	const row = await db.getPost(id);
	if (!row) return res.status(404).json({ error: 'Not found' });

	const isOwner = req.user?.discordId && row.uploaderDiscordId && req.user.discordId === row.uploaderDiscordId;
	const tokenMatches = token && token === row.editToken;
	if (!tokenMatches && !isOwner) return res.status(403).json({ error: 'Invalid token' });

	const trimmedTitle = String(title).trim().slice(0, 200);
	const trimmedDescription = String(description).trim().slice(0, 2000);

	await db.publishPost({ id, title: trimmedTitle, description: trimmedDescription });

	const updated = await db.getPost(id);
	return res.json({
		id: updated.id,
		title: updated.title,
		description: updated.description,
		status: updated.status,
		fileUrl: storage.getUrl(updated.filename),
		type: updated.type,
		createdAt: updated.createdAt
	});
});

// Auth routes
app.get('/api/auth/login', (req, res) => {
	if (!discordClientId || !discordClientSecret) {
		if (req.headers.accept?.includes('application/json')) {
			return res.status(500).json({
				error: 'Discord OAuth not configured',
				message: 'Please add DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET to your .env file'
			});
		}
		return res.status(500).send(`
			<html>
				<head><title>OAuth Not Configured</title></head>
				<body style="font-family: system-ui; padding: 40px; max-width: 600px; margin: 0 auto;">
					<h1>⚠️ Discord OAuth Not Configured</h1>
					<p>To enable login, you need to:</p>
					<ol>
						<li>Go to <a href="https://discord.com/developers/applications" target="_blank">Discord Developer Portal</a></li>
						<li>Create a new application or select existing one</li>
						<li>Go to OAuth2 settings</li>
						<li>Add redirect URL: <code>${discordRedirectUri}</code></li>
						<li>Copy Client ID and Client Secret</li>
						<li>Add them to your <code>.env</code> file:
							<pre style="background: #f5f5f5; padding: 10px; border-radius: 4px;">DISCORD_CLIENT_ID=your_client_id
DISCORD_CLIENT_SECRET=your_client_secret</pre>
						</li>
						<li>Restart the server</li>
					</ol>
					<p><a href="/">← Back to home</a></p>
				</body>
			</html>
		`);
	}
	const params = new URLSearchParams({
		client_id: discordClientId,
		redirect_uri: discordRedirectUri,
		response_type: 'code',
		scope: 'identify'
	});
	return res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
});

app.get('/api/auth/callback', async (req, res) => {
	const code = req.query.code;
	if (!code) return res.status(400).send('Missing code');
	if (!discordClientId || !discordClientSecret) {
		return res.status(500).send('Discord OAuth not configured');
	}

	try {
		const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				client_id: discordClientId,
				client_secret: discordClientSecret,
				grant_type: 'authorization_code',
				code,
				redirect_uri: discordRedirectUri
			})
		});

		if (!tokenResponse.ok) {
			const text = await tokenResponse.text();
			console.error('Discord token exchange failed', text);
			return res.status(400).send('Failed to sign in with Discord');
		}

		const tokenData = await tokenResponse.json();
		const userResponse = await fetch('https://discord.com/api/users/@me', {
			headers: { Authorization: `Bearer ${tokenData.access_token}` }
		});

		if (!userResponse.ok) {
			console.error('Discord user fetch failed', await userResponse.text());
			return res.status(400).send('Failed to fetch Discord profile');
		}

		const discordUser = await userResponse.json();
		const user = await db.upsertUser({
			discordId: discordUser.id,
			username: discordUser.username,
			avatar: discordUser.avatar ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png` : null
		});

		// Check if user is banned
		if (user.isBanned || user.isbanned) {
			return res.status(403).send('Your account has been banned and cannot access this platform.');
		}

		const session = signSession(user);
		res.cookie('session', session, sessionCookieOptions);

		return res.redirect(`${frontendBase}/`);
	} catch (authErr) {
		console.error('Discord auth error', authErr);
		return res.status(500).send('Authentication failed');
	}
});

app.get('/api/auth/me', (req, res) => {
	if (!req.user) return res.status(401).json({ user: null });
	return res.json({ user: req.user });
});

app.post('/api/auth/logout', (req, res) => {
	res.clearCookie('session', sessionCookieOptions);
	return res.json({ ok: true });
});

// Frontend routes (served as static HTML)
app.get('/edit/:id', (_req, res) => {
	res.sendFile(path.resolve(publicDir, 'edit.html'));
});

app.get('/post/:id', (_req, res) => {
	res.sendFile(path.resolve(publicDir, 'post.html'));
});

app.get('/shorts', (_req, res) => {
	res.sendFile(path.resolve(publicDir, 'shorts.html'));
});

app.get('/upload', (_req, res) => {
	res.sendFile(path.resolve(publicDir, 'upload.html'));
});

// Admin endpoints
app.delete('/api/post/:id', requireAdmin, async (req, res) => {
	const id = Number(req.params.id);
	if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid post id' });

	const post = await db.getPost(id);
	if (!post) return res.status(404).json({ error: 'Post not found' });

	await db.deletePost(id);
	return res.json({ success: true, message: 'Post deleted' });
});

app.post('/api/admin/user/:discordId/ban', requireAdmin, async (req, res) => {
	const discordId = req.params.discordId;
	if (!discordId) return res.status(400).json({ error: 'Invalid user' });

	const { banned } = req.body;
	await db.setBanned(discordId, Boolean(banned));
	return res.json({ success: true, message: `User ${banned ? 'banned' : 'unbanned'}` });
});

app.post('/api/admin/user/:discordId/verify', requireAdmin, async (req, res) => {
	const discordId = req.params.discordId;
	if (!discordId) return res.status(400).json({ error: 'Invalid user' });

	const { verified } = req.body;
	await db.setVerified(discordId, Boolean(verified));
	return res.json({ success: true, message: `User ${verified ? 'verified' : 'unverified'}` });
});

app.post('/api/admin/user/:discordId/admin', requireAdmin, async (req, res) => {
	const discordId = req.params.discordId;
	if (!discordId) return res.status(400).json({ error: 'Invalid user' });

	const { admin } = req.body;
	await db.setAdmin(discordId, Boolean(admin));
	return res.json({ success: true, message: `User ${admin ? 'promoted to' : 'removed from'} admin` });
});

// Setup endpoint (use SETUP_SECRET from .env to promote admins)
app.post('/api/setup/promote-admin', async (req, res) => {
	const setupSecret = process.env.SETUP_SECRET;
	if (!setupSecret) {
		return res.status(400).json({ error: 'Admin setup not available' });
	}

	const { secret, discordId } = req.body;
	if (!secret || secret !== setupSecret) {
		return res.status(403).json({ error: 'Invalid setup secret' });
	}

	if (!discordId) {
		return res.status(400).json({ error: 'Discord ID required' });
	}

	await db.setAdmin(discordId, true);
	return res.json({ success: true, message: `User ${discordId} promoted to admin` });
});

app.use((err, _req, res, _next) => {
	console.error('Unexpected error:', err);
	res.status(500).json({ error: 'Internal server error' });
});

app.listen(port, () => {
	console.log(`Server listening on http://localhost:${port}`);
});
