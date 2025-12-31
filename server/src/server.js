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
const maxUploadMb = Number(process.env.MAX_UPLOAD_MB || 1000); // 1 GB limit for long-form videos
const uploadsDir = path.resolve(__dirname, '..', 'uploads');
const publicDir = path.resolve(__dirname, '..', '..', 'public');
const frontendBase = (process.env.FRONTEND_BASE_URL || `http://localhost:${port}`).replace(/\/$/, '');
const jwtSecret = process.env.JWT_SECRET || 'dev-secret-change-me';
const isProd = process.env.NODE_ENV === 'production';
const discordClientId = process.env.DISCORD_CLIENT_ID;
const discordClientSecret = process.env.DISCORD_CLIENT_SECRET;
const discordRedirectUri = (process.env.DISCORD_REDIRECT_URI || `${frontendBase}/api/auth/callback`).replace(/\/$/, '');
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const googleRedirectUri = (process.env.GOOGLE_REDIRECT_URI || `${frontendBase}/api/auth/google/callback`).replace(/\/$/, '');
const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map((id) => id.trim()).filter(Boolean) : [];
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

const avatarUpload = multer({
	storage: multerStorage,
	limits: { fileSize: 5 * 1024 * 1024 },
	fileFilter: (_req, file, cb) => {
		if (!file.mimetype.startsWith('image/')) {
			return cb(new Error('Avatar must be an image'));
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
	const avatarRaw = user.avatar ?? user.avatarUrl ?? user.picture ?? null;
	const avatar = resolveAssetUrl(avatarRaw);
	const isAdmin = user.isAdmin ?? user.isadmin ?? false;
	const isBanned = user.isBanned ?? user.isbanned ?? false;
	return jwt.sign({ id: user.id, discordId, username, avatar, isAdmin, isBanned }, jwtSecret, { expiresIn: '30d' });
}

function normalizeUser(user) {
	if (!user) return undefined;
	const discordId = user.discordId ?? user.discordid ?? user.discord_id;
	if (!discordId) return undefined;
	const username = user.username ?? user.name ?? 'Unknown';
	const avatarRaw = user.avatar ?? user.avatarUrl ?? user.picture ?? null;
	const avatar = resolveAssetUrl(avatarRaw);
	const isAdmin = user.isAdmin ?? user.isadmin ?? false;
	const isBanned = user.isBanned ?? user.isbanned ?? false;
	return { id: user.id, discordId, username, avatar, isAdmin, isBanned };
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

		// Check if user is banned; if so, clear session and deny access
		if (user && user.isBanned) {
			res.clearCookie('session', sessionCookieOptions);
			req.user = undefined;
			return res.status(403).json({ error: 'Your account has been banned', banned: true });
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

function resolveAssetUrl(value) {
	if (!value) return null;
	if (/^https?:\/\//i.test(value)) return value;
	try {
		return storage.getUrl(value);
	} catch (_err) {
		return value;
	}
}

// Upload endpoint: accepts one validated file and optional thumbnail (auth required)
app.post('/api/upload', requireAuth, (req, res) => {
	upload.fields([
		{ name: 'file', maxCount: 1 },
		{ name: 'thumbnail', maxCount: 1 }
	])(req, res, async (err) => {
		if (err) {
			console.error('Upload error:', err.message);
			return res.status(400).json({ error: err.message });
		}

		const mainFile = req.files?.file?.[0];
		const thumbnailFile = req.files?.thumbnail?.[0];

		if (!mainFile) {
			return res.status(400).json({ error: 'File is required' });
		}

		const uploaderDiscordId = req.user?.discordId;
		const uploaderName = (req.user?.username || 'Unknown').trim().slice(0, 80) || 'Unknown';
		if (!uploaderDiscordId) {
			res.clearCookie('session', sessionCookieOptions);
			return res.status(401).json({ error: 'Login expired. Please sign in again.' });
		}
		
		const type = detectType(mainFile.mimetype);
		if (type === 'unknown') {
			fs.unlink(mainFile.path, () => {});
			if (thumbnailFile) fs.unlink(thumbnailFile.path, () => {});
			return res.status(400).json({ error: 'Unsupported file type' });
		}

		// Validate thumbnail is an image if provided
		if (thumbnailFile) {
			const thumbType = detectType(thumbnailFile.mimetype);
			if (thumbType !== 'image') {
				fs.unlink(mainFile.path, () => {});
				fs.unlink(thumbnailFile.path, () => {});
				return res.status(400).json({ error: 'Thumbnail must be an image' });
			}
		}
		
		// Auto-detect format: images are always 'photo', videos use user selection
		const formatVal = req.body?.format;
		let format;
		if (type === 'image') {
			format = 'photo'; // Images are always photos
		} else {
			format = ['short', 'long'].includes(formatVal) ? formatVal : 'long';
		}
		
		const publishNow = req.body?.publish === 'true' || req.body?.publish === 'on';
		const title = String(req.body?.title || '').trim().slice(0, 200);
		const description = String(req.body?.description || '').trim().slice(0, 2000);

		try {
			await db.upsertUser({ discordId: uploaderDiscordId, username: uploaderName, avatar: req.user?.avatar || null });
		} catch (userErr) {
			console.warn('Could not upsert uploader user', userErr?.message);
		}

		try {
			const fileUrl = await storage.upload(mainFile.path, mainFile.filename);
			
			// Upload thumbnail if provided
			let thumbnailUrl = '';
			if (thumbnailFile) {
				thumbnailUrl = await storage.upload(thumbnailFile.path, thumbnailFile.filename);
			}
			
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
				format,
				thumbnail: thumbnailUrl
			};

			console.log('Attempting to insert post with data:', { ...data, filename: '[url]', thumbnail: thumbnailUrl ? '[url]' : '' });
			const info = await db.insertPost(data);
			console.log('Post inserted successfully with ID:', info.lastInsertRowid);
			return res.status(201).json({
				id: info.lastInsertRowid,
				editToken,
				fileUrl: storage.getUrl(fileUrl),
				thumbnailUrl: thumbnailUrl ? storage.getUrl(thumbnailUrl) : null,
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
		thumbnail: row.thumbnail ? storage.getUrl(row.thumbnail) : null,
		type: row.type,
		format: row.format || 'long',
		likes: row.likes,
		createdAt: row.createdAt,
		uploaderName: row.uploaderName,
		uploaderAvatar: row.uploaderAvatar || null,
		uploaderDiscordId: row.uploaderDiscordId || null,
		uploaderVerified: Boolean(row.uploaderVerified),
		liked: likedSet ? likedSet.has(Number(row.id)) : false
	})) });
});

// Search posts
app.get('/api/posts/search', async (req, res) => {
	const query = req.query.q;
	if (!query || query.trim().length < 2) {
		return res.json({ posts: [] });
	}
	const rows = await db.searchPosts(query.trim());
	const likedSet = req.user ? new Set(await db.getUserLikes(req.user.id)) : null;
	return res.json({ posts: rows.map((row) => ({
		id: row.id,
		title: row.title,
		description: row.description,
		fileUrl: storage.getUrl(row.filename),
		thumbnail: row.thumbnail ? storage.getUrl(row.thumbnail) : null,
		type: row.type,
		format: row.format || 'long',
		likes: row.likes,
		createdAt: row.createdAt,
		uploaderName: row.uploaderName,
		uploaderAvatar: row.uploaderAvatar || null,
		uploaderDiscordId: row.uploaderDiscordId || null,
		uploaderVerified: Boolean(row.uploaderVerified),
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
		thumbnail: row.thumbnail ? storage.getUrl(row.thumbnail) : null,
		type: row.type,
		format: row.format || 'long',
		likes: row.likes,
		createdAt: row.createdAt,
		uploaderName: row.uploaderName,
		uploaderAvatar: row.uploaderAvatar || null,
		uploaderDiscordId: row.uploaderDiscordId || null,
		uploaderVerified: Boolean(row.uploaderVerified),
		liked: likedSet ? likedSet.has(Number(row.id)) : false
	})) });
});

// Photos feed: only photos
app.get('/api/posts/photos', async (req, res) => {
	const rows = await db.listPublished();
	const photos = rows.filter(row => row.format === 'photo');
	const likedSet = req.user ? new Set(await db.getUserLikes(req.user.id)) : null;
	return res.json({ posts: photos.map((row) => ({
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
		uploaderDiscordId: row.uploaderDiscordId || null,
		uploaderVerified: Boolean(row.uploaderVerified),
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
		uploaderDiscordId: row.uploaderDiscordId || null,
		uploaderVerified: Boolean(row.uploaderVerified),
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
		uploaderDiscordId: row.uploaderDiscordId || null,
		uploaderVerified: Boolean(row.uploaderVerified),
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
		uploaderAvatar: row.uploaderAvatar || null,		uploaderDiscordId: row.uploaderDiscordId || null,
		uploaderVerified: Boolean(row.uploaderVerified),		liked: likedSet.has(Number(row.id))
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
		uploaderVerified: Boolean(row.uploaderVerified),
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

	// Send notification to post owner when someone likes (not unlikes) their post
	if (!alreadyLiked && row.uploaderDiscordId && row.uploaderDiscordId !== req.user.discordId) {
		try {
			await db.createNotification(
				row.uploaderDiscordId,
				'like',
				'New Like!',
				`${req.user.username || 'Someone'} liked your post "${row.title || 'Untitled'}"`
			);
		} catch (err) {
			console.error('Failed to create like notification:', err);
		}
	}

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

function buildProfileResponse(profile) {
	if (!profile) return null;
	const avatar = resolveAssetUrl(profile.avatar);
	const videos = Array.isArray(profile.videos)
		? profile.videos.map((v) => ({
			...v,
			fileUrl: resolveAssetUrl(v.filename)
		}))
		: [];

	return {
		...profile,
		avatar,
		videos
	};
}

app.get('/api/me/profile', requireAuth, async (req, res) => {
	try {
		const profile = await db.getUserProfile(req.user.discordId);
		if (!profile) return res.status(404).json({ error: 'User not found' });
		return res.json(buildProfileResponse(profile));
	} catch (err) {
		console.error('Self profile fetch error:', err);
		return res.status(500).json({ error: 'Failed to load profile' });
	}
});

app.patch('/api/me/profile', requireAuth, (req, res) => {
	avatarUpload.single('avatar')(req, res, async (err) => {
		if (err) {
			return res.status(400).json({ error: err.message || 'Invalid upload' });
		}

		const requestedName = String(req.body?.username || '').trim().slice(0, 80);
		const avatarUrlFromBody = req.body?.avatarUrl ? String(req.body.avatarUrl).trim() : null;
		const bio = req.body?.bio !== undefined ? String(req.body.bio).trim().slice(0, 500) : undefined;
		const banner = req.body?.banner ? String(req.body.banner).trim() : undefined;
		const profileColor = req.body?.profileColor ? String(req.body.profileColor).trim() : undefined;

		let avatarUrl = avatarUrlFromBody || null;

		if (req.file) {
			try {
				avatarUrl = await storage.upload(req.file.path, req.file.filename);
			} catch (uploadErr) {
				console.error('Avatar upload failed:', uploadErr);
				return res.status(500).json({ error: 'Failed to save avatar' });
			}
		}

		if (!requestedName && !avatarUrl && bio === undefined && !banner && !profileColor) {
			return res.status(400).json({ error: 'Nothing to update' });
		}

		try {
			const updated = await db.updateUserProfile(req.user.discordId, {
				username: requestedName || undefined,
				avatar: avatarUrl || undefined,
				bio: bio,
				banner: banner,
				profileColor: profileColor
			});

			if (!updated) return res.status(404).json({ error: 'User not found' });

			const session = signSession(updated);
			res.cookie('session', session, sessionCookieOptions);
			return res.json({ user: normalizeUser(updated), avatar: resolveAssetUrl(updated.avatar) });
		} catch (updateErr) {
			console.error('Profile update error:', updateErr);
			return res.status(500).json({ error: 'Failed to update profile' });
		}
	});
});

// Follow endpoints
app.get('/api/user/:discordId/profile', async (req, res) => {
	const discordId = req.params.discordId;
	if (!discordId) return res.status(400).json({ error: 'Invalid user' });
	try {
		const profile = await db.getUserProfile(discordId);
		if (!profile) return res.status(404).json({ error: 'User not found' });
		return res.json(buildProfileResponse(profile));
	} catch (err) {
		console.error('Profile fetch error:', err);
		return res.status(500).json({ error: 'Failed to load profile' });
	}
});

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

	// Send notification to user when someone follows (not unfollows) them
	if (desired && !current) {
		try {
			await db.createNotification(
				targetDiscordId,
				'follow',
				'New Follower!',
				`${req.user.username || 'Someone'} started following you`
			);
		} catch (err) {
			console.error('Failed to create follow notification:', err);
		}
	}

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

app.get('/api/auth/google', (req, res) => {
	if (!googleClientId || !googleClientSecret) {
		if (req.headers.accept?.includes('application/json')) {
			return res.status(500).json({
				error: 'Google OAuth not configured',
				message: 'Please add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your .env file'
			});
		}
		return res.status(500).send(`
			<html>
				<head><title>OAuth Not Configured</title></head>
				<body style="font-family: system-ui; padding: 40px; max-width: 600px; margin: 0 auto;">
					<h1>⚠️ Google OAuth Not Configured</h1>
					<p>To enable Google login, you need to:</p>
					<ol>
						<li>Create OAuth credentials at <a href="https://console.cloud.google.com/apis/credentials" target="_blank">Google Cloud Console</a></li>
						<li>Add redirect URL: <code>${googleRedirectUri}</code></li>
						<li>Set Web application type, add your authorized domains</li>
						<li>Add these to your <code>.env</code> file:
							<pre style="background: #f5f5f5; padding: 10px; border-radius: 4px;">GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=${googleRedirectUri}</pre>
						</li>
						<li>Restart the server</li>
					</ol>
					<p><a href="/">← Back to home</a></p>
				</body>
			</html>
		`);
	}

	const params = new URLSearchParams({
		client_id: googleClientId,
		redirect_uri: googleRedirectUri,
		response_type: 'code',
		scope: 'openid email profile',
		access_type: 'offline',
		prompt: 'consent'
	});

	return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
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

		if (adminIds.includes(discordUser.id)) {
			await db.setAdmin(discordUser.id, true);
		}

		// Refresh user data after potential admin promotion
		const updatedUser = await db.getUserByDiscordId(discordUser.id) || user;

		// Check if user is banned
		if (updatedUser.isBanned || updatedUser.isbanned) {
			return res.status(403).send('Your account has been banned and cannot access this platform.');
		}

		const session = signSession(updatedUser);
		res.cookie('session', session, sessionCookieOptions);

		return res.redirect(`${frontendBase}/`);
	} catch (authErr) {
		console.error('Discord auth error', authErr);
		return res.status(500).send('Authentication failed');
	}
});

app.get('/api/auth/google/callback', async (req, res) => {
	const code = req.query.code;
	if (!code) return res.status(400).send('Missing code');
	if (!googleClientId || !googleClientSecret) {
		return res.status(500).send('Google OAuth not configured');
	}

	try {
		const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				code,
				client_id: googleClientId,
				client_secret: googleClientSecret,
				redirect_uri: googleRedirectUri,
				grant_type: 'authorization_code'
			})
		});

		if (!tokenResponse.ok) {
			const text = await tokenResponse.text();
			console.error('Google token exchange failed', text);
			return res.status(400).send('Failed to sign in with Google');
		}

		const tokenData = await tokenResponse.json();
		const userResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
			headers: { Authorization: `Bearer ${tokenData.access_token}` }
		});

		if (!userResponse.ok) {
			console.error('Google user fetch failed', await userResponse.text());
			return res.status(400).send('Failed to fetch Google profile');
		}

		const googleUser = await userResponse.json();
		const externalId = `g-${googleUser.sub}`;
		const displayName = (googleUser.name || googleUser.given_name || 'User').trim().slice(0, 80) || 'User';
		const avatar = googleUser.picture || null;

		const user = await db.upsertUser({
			discordId: externalId,
			username: displayName,
			avatar
		});

		if (adminIds.includes(externalId)) {
			await db.setAdmin(externalId, true);
		}

		const updatedUser = (await db.getUserByDiscordId(externalId)) || user;

		if (updatedUser.isBanned || updatedUser.isbanned) {
			return res.status(403).send('Your account has been banned and cannot access this platform.');
		}

		const session = signSession(updatedUser);
		res.cookie('session', session, sessionCookieOptions);

		return res.redirect(`${frontendBase}/`);
	} catch (authErr) {
		console.error('Google auth error', authErr);
		return res.status(500).send('Authentication failed');
	}
});

app.get('/api/auth/me', async (req, res) => {
	if (!req.user) return res.status(401).json({ user: null });
	let user = req.user;
	if (typeof db.getUserByDiscordId === 'function') {
		const fresh = await db.getUserByDiscordId(req.user.discordId);
		if (fresh) {
			user = normalizeUser(fresh);
			const session = signSession(fresh);
			res.cookie('session', session, sessionCookieOptions);
		}
	}
	return res.json({ user });
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
app.get('/api/admin/users', requireAdmin, async (req, res) => {
	const users = await db.getAllUsers();
	return res.json({ users });
});

// Delete post - allowed for admins OR the owner of the post
app.delete('/api/post/:id', requireAuth, async (req, res) => {
	const id = Number(req.params.id);
	if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid post id' });

	const post = await db.getPost(id);
	if (!post) return res.status(404).json({ error: 'Post not found' });

	// Allow if admin OR if user is the owner of the post
	const isOwner = req.user.discordId === post.uploaderDiscordId;
	const isAdmin = req.user.isAdmin;
	
	if (!isOwner && !isAdmin) {
		return res.status(403).json({ error: 'You can only delete your own posts' });
	}

	// If admin is deleting someone else's post, send a warning notification
	const reason = req.body?.reason || 'Content violated community guidelines';
	if (isAdmin && !isOwner) {
		const uploader = await db.getUserByDiscordId(post.uploaderDiscordId);
		if (uploader) {
			await db.createNotification(
				uploader.id,
				'warning',
				'Your content was removed',
				`Your post "${post.title || 'Untitled'}" was removed by a moderator. Reason: ${reason}. Please review our community guidelines to avoid future removals.`
			);
		}
	}

	await db.deletePost(id);
	return res.json({ success: true, message: 'Post deleted' });
});

// Notification endpoints
app.get('/api/notifications', requireAuth, async (req, res) => {
	const notifications = await db.getNotifications(req.user.id);
	const unreadCount = await db.getUnreadCount(req.user.id);
	return res.json({ notifications, unreadCount });
});

app.post('/api/notifications/:id/read', requireAuth, async (req, res) => {
	const id = Number(req.params.id);
	if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid notification id' });
	await db.markNotificationRead(id, req.user.id);
	return res.json({ success: true });
});

app.post('/api/notifications/read-all', requireAuth, async (req, res) => {
	await db.markAllNotificationsRead(req.user.id);
	return res.json({ success: true });
});

// Admin send warning to user
app.post('/api/admin/user/:discordId/warn', requireAdmin, async (req, res) => {
	const discordId = req.params.discordId;
	if (!discordId) return res.status(400).json({ error: 'Invalid user' });
	
	const { title, message } = req.body;
	if (!message) return res.status(400).json({ error: 'Message is required' });
	
	const user = await db.getUserByDiscordId(discordId);
	if (!user) return res.status(404).json({ error: 'User not found' });
	
	await db.createNotification(
		user.id,
		'warning',
		title || 'Warning from moderators',
		message
	);
	
	return res.json({ success: true, message: 'Warning sent to user' });
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

app.post('/api/admin/user/:discordId/staff', requireAdmin, async (req, res) => {
	const discordId = req.params.discordId;
	if (!discordId) return res.status(400).json({ error: 'Invalid user' });

	const { staff } = req.body;
	await db.setStaff(discordId, Boolean(staff));
	return res.json({ success: true, message: `User ${staff ? 'given' : 'removed'} Staff badge` });
});

app.post('/api/admin/user/:discordId/owner', requireAdmin, async (req, res) => {
	const discordId = req.params.discordId;
	if (!discordId) return res.status(400).json({ error: 'Invalid user' });

	const { owner } = req.body;
	await db.setOwner(discordId, Boolean(owner));
	return res.json({ success: true, message: `User ${owner ? 'given' : 'removed'} Owner badge` });
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

// Report endpoint - sends to Discord webhook
const REPORT_WEBHOOK_URL = 'https://discordapp.com/api/webhooks/1455624338064670751/Ap6frPffwkxjIosHOHwQNe7O0xL8DaSI9bgn3ve2DEf78n6aZRF85RxVuXRtJPY2O3Zz';

app.post('/api/report', requireAuth, async (req, res) => {
	try {
		const { type, targetId, reason, details } = req.body;
		
		if (!type || !targetId || !reason) {
			return res.status(400).json({ error: 'Missing required fields' });
		}

		if (!['user', 'video', 'comment'].includes(type)) {
			return res.status(400).json({ error: 'Invalid report type' });
		}

		// Build the embed for Discord
		const embed = {
			title: `🚨 New ${type.charAt(0).toUpperCase() + type.slice(1)} Report`,
			color: 0xff0000,
			fields: [
				{ name: 'Report Type', value: type, inline: true },
				{ name: 'Target ID', value: String(targetId), inline: true },
				{ name: 'Reason', value: reason, inline: false }
			],
			timestamp: new Date().toISOString(),
			footer: { text: 'BeardedVibes Report System' }
		};

		if (details) {
			embed.fields.push({ name: 'Additional Details', value: details.slice(0, 1000), inline: false });
		}

		embed.fields.push({ 
			name: 'Reported By', 
			value: `${req.user.username} (${req.user.discordId})`, 
			inline: false 
		});

		// Add link based on type
		if (type === 'video') {
			embed.fields.push({ name: 'Link', value: `${frontendBase}/post/${targetId}`, inline: false });
		} else if (type === 'user') {
			embed.fields.push({ name: 'Link', value: `${frontendBase}/profile.html?id=${targetId}`, inline: false });
		}

		// Send to Discord webhook
		const webhookRes = await fetch(REPORT_WEBHOOK_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ embeds: [embed] })
		});

		if (!webhookRes.ok) {
			console.error('Failed to send report to webhook:', await webhookRes.text());
			return res.status(500).json({ error: 'Failed to submit report' });
		}

		return res.json({ success: true, message: 'Report submitted successfully' });
	} catch (err) {
		console.error('Report error:', err);
		return res.status(500).json({ error: 'Failed to submit report' });
	}
});

app.use((err, _req, res, _next) => {
	console.error('Unexpected error:', err);
	res.status(500).json({ error: 'Internal server error' });
});

app.listen(port, () => {
	console.log(`Server listening on http://localhost:${port}`);
});
