import pg from 'pg';
import Database from 'better-sqlite3';

const { Pool } = pg;

export function createDatabase(config) {
  if (config.type === 'postgres') {
    const pool = new Pool({ connectionString: config.url, ssl: config.ssl ? { rejectUnauthorized: false } : false });

    const postWithLikes = `
      SELECT 
        p.id, p.filename, p.type, p.title, p.description, 
        p.uploaderdiscordid AS "uploaderDiscordId", 
        p.uploadername AS "uploaderName", 
        p.status, p.edittoken AS "editToken", 
        p.createdat AS "createdAt", 
        p.format,
        COALESCE(lc.count, 0) AS likes, 
        u.avatar AS "uploaderAvatar",
        COALESCE(u.isverified, false) AS "uploaderVerified"
      FROM posts p
      LEFT JOIN (
        SELECT postId, COUNT(*) AS count FROM likes GROUP BY postId
      ) lc ON lc.postId = p.id
      LEFT JOIN users u ON u.discordid = p.uploaderdiscordid
      WHERE p.id = $1
    `;

    return {
      async init() {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            discordId TEXT NOT NULL UNIQUE,
            username TEXT NOT NULL,
            avatar TEXT,
            isAdmin BOOLEAN NOT NULL DEFAULT FALSE,
            isBanned BOOLEAN NOT NULL DEFAULT FALSE,
            isVerified BOOLEAN NOT NULL DEFAULT FALSE,
            createdAt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            lastSeenAt TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
        `);
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS isAdmin BOOLEAN DEFAULT FALSE`);
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS isBanned BOOLEAN DEFAULT FALSE`);
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS isVerified BOOLEAN DEFAULT FALSE`);
        await pool.query(`
          CREATE TABLE IF NOT EXISTS posts (
            id SERIAL PRIMARY KEY,
            filename TEXT NOT NULL,
            type TEXT NOT NULL,
            title TEXT DEFAULT '',
            description TEXT DEFAULT '',
            uploaderDiscordId TEXT NOT NULL,
            uploaderName TEXT DEFAULT '',
            status TEXT NOT NULL,
            editToken TEXT NOT NULL,
            createdAt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            format TEXT NOT NULL DEFAULT 'long'
          );
        `);
        await pool.query(`
          CREATE TABLE IF NOT EXISTS likes (
            id SERIAL PRIMARY KEY,
            postId INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
            userId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            createdAt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE(postId, userId)
          );
        `);
        await pool.query(`
          CREATE TABLE IF NOT EXISTS comments (
            id SERIAL PRIMARY KEY,
            postId INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
            userId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            text TEXT NOT NULL,
            createdAt TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
        `);
        await pool.query(`
          CREATE TABLE IF NOT EXISTS history (
            id SERIAL PRIMARY KEY,
            postId INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
            userId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            viewedAt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE(postId, userId)
          );
        `);
        await pool.query(`
          CREATE TABLE IF NOT EXISTS watchlist (
            id SERIAL PRIMARY KEY,
            postId INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
            userId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            addedAt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE(postId, userId)
          );
        `);
        await pool.query(`
          CREATE TABLE IF NOT EXISTS follows (
            id SERIAL PRIMARY KEY,
            followerId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            followingDiscordId TEXT NOT NULL,
            createdAt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE(followerId, followingDiscordId)
          );
        `);
        await pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS uploaderName TEXT DEFAULT ''`);
        await pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS format TEXT DEFAULT 'long'`);
        await pool.query(`ALTER TABLE comments ADD COLUMN IF NOT EXISTS userId INTEGER REFERENCES users(id)`);
        await pool.query('CREATE INDEX IF NOT EXISTS idx_comments_postId ON comments(postId)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_likes_postId ON likes(postId)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_history_user ON history(userId, viewedAt DESC)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist(userId, addedAt DESC)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_follows_target ON follows(followingDiscordId)');
      },

      async upsertUser({ discordId, username, avatar }) {
        const res = await pool.query(
          `INSERT INTO users (discordId, username, avatar)
           VALUES ($1, $2, $3)
           ON CONFLICT (discordId) DO UPDATE SET username = EXCLUDED.username, avatar = EXCLUDED.avatar, lastSeenAt = NOW()
           RETURNING id, discordId AS "discordId", username, avatar`,
          [discordId, username, avatar]
        );
        return res.rows[0];
      },

      async getUserById(id) {
        const res = await pool.query(
          `SELECT id, discordId AS "discordId", username, avatar
           FROM users
           WHERE id = $1
           LIMIT 1`,
          [id]
        );
        return res.rows[0];
      },

      async getUserByDiscordId(discordId) {
        const res = await pool.query(
          `SELECT id, discordId AS "discordId", username, avatar, isAdmin AS "isAdmin", isBanned AS "isBanned", isVerified AS "isVerified"
           FROM users
           WHERE discordId = $1
           LIMIT 1`,
          [discordId]
        );
        return res.rows[0];
      },

      async insertPost(data) {
        const res = await pool.query(
          `INSERT INTO posts (filename, type, title, description, uploaderDiscordId, uploaderName, status, editToken, createdAt)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id`,
          [
            data.filename,
            data.type,
            data.title,
            data.description,
            data.uploaderDiscordId,
            data.uploaderName,
            data.status,
            data.editToken,
            data.createdAt
          ]
        );
        return { lastInsertRowid: res.rows[0].id };
      },

      async getPost(id) {
        const res = await pool.query(postWithLikes, [id]);
        return res.rows[0];
      },

      async listPublished() {
        const res = await pool.query(`
          SELECT p.*, COALESCE(lc.count, 0) AS likes, u.avatar AS "uploaderAvatar", COALESCE(u.isverified, false) AS "uploaderVerified"
          FROM posts p
          LEFT JOIN (
            SELECT postId, COUNT(*) AS count FROM likes GROUP BY postId
          ) lc ON lc.postId = p.id
          LEFT JOIN users u ON u.discordid = p.uploaderdiscordid
          WHERE p.status = 'published'
          ORDER BY p.id DESC
        `);
        return res.rows;
      },

      async searchPosts(query) {
        const searchTerm = `%${query}%`;
        const res = await pool.query(`
          SELECT p.*, COALESCE(lc.count, 0) AS likes, u.avatar AS "uploaderAvatar", COALESCE(u.isverified, false) AS "uploaderVerified"
          FROM posts p
          LEFT JOIN (
            SELECT postId, COUNT(*) AS count FROM likes GROUP BY postId
          ) lc ON lc.postId = p.id
          LEFT JOIN users u ON u.discordid = p.uploaderdiscordid
          WHERE p.status = 'published' AND (LOWER(p.title) LIKE LOWER($1) OR LOWER(p.description) LIKE LOWER($1) OR LOWER(p.uploadername) LIKE LOWER($1))
          ORDER BY p.id DESC
          LIMIT 50
        `, [searchTerm]);
        return res.rows;
      },

      async listTrending() {
        const res = await pool.query(`
          SELECT p.*, COALESCE(lc.count, 0) AS likes, u.avatar AS "uploaderAvatar", COALESCE(u.isverified, false) AS "uploaderVerified"
          FROM posts p
          LEFT JOIN (
            SELECT postId, COUNT(*) AS count FROM likes GROUP BY postId
          ) lc ON lc.postId = p.id
          LEFT JOIN users u ON u.discordid = p.uploaderdiscordid
          WHERE p.status = 'published'
          ORDER BY lc.count DESC NULLS LAST, p.createdAt DESC
          LIMIT 100
        `);
        return res.rows;
      },

      async listLiked(userId) {
        const res = await pool.query(`
          SELECT p.*, COALESCE(lc.count, 0) AS likes, u.avatar AS "uploaderAvatar", COALESCE(u.isverified, false) AS "uploaderVerified"
          FROM likes l
          JOIN posts p ON p.id = l.postId
          LEFT JOIN (
            SELECT postId, COUNT(*) AS count FROM likes GROUP BY postId
          ) lc ON lc.postId = p.id
          LEFT JOIN users u ON u.discordid = p.uploaderdiscordid
          WHERE l.userId = $1 AND p.status = 'published'
          ORDER BY l.createdAt DESC
        `, [userId]);
        return res.rows;
      },

      async listHistory(userId) {
        const res = await pool.query(`
          SELECT p.*, h.viewedAt, COALESCE(lc.count, 0) AS likes, u.avatar AS "uploaderAvatar", COALESCE(u.isverified, false) AS "uploaderVerified"
          FROM history h
          JOIN posts p ON p.id = h.postId
          LEFT JOIN (
            SELECT postId, COUNT(*) AS count FROM likes GROUP BY postId
          ) lc ON lc.postId = p.id
          LEFT JOIN users u ON u.discordid = p.uploaderdiscordid
          WHERE h.userId = $1 AND p.status = 'published'
          ORDER BY h.viewedAt DESC
        `, [userId]);
        return res.rows;
      },

      async listWatchlist(userId) {
        const res = await pool.query(`
          SELECT p.*, w.addedAt, COALESCE(lc.count, 0) AS likes, u.avatar AS "uploaderAvatar", COALESCE(u.isverified, false) AS "uploaderVerified"
          FROM watchlist w
          JOIN posts p ON p.id = w.postId
          LEFT JOIN (
            SELECT postId, COUNT(*) AS count FROM likes GROUP BY postId
          ) lc ON lc.postId = p.id
          LEFT JOIN users u ON u.discordid = p.uploaderdiscordid
          WHERE w.userId = $1 AND p.status = 'published'
          ORDER BY w.addedAt DESC
        `, [userId]);
        return res.rows;
      },

      async publishPost(data) {
        await pool.query(
          `UPDATE posts SET title = $1, description = $2, status = 'published' WHERE id = $3`,
          [data.title, data.description, data.id]
        );
      },

      async setLike(postId, userId, like) {
        if (like) {
          await pool.query(
            `INSERT INTO likes (postId, userId) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [postId, userId]
          );
        } else {
          await pool.query(`DELETE FROM likes WHERE postId = $1 AND userId = $2`, [postId, userId]);
        }
        const res = await pool.query('SELECT COUNT(*)::INT AS count FROM likes WHERE postId = $1', [postId]);
        return res.rows[0].count;
      },

      async hasUserLiked(postId, userId) {
        const res = await pool.query('SELECT 1 FROM likes WHERE postId = $1 AND userId = $2 LIMIT 1', [postId, userId]);
        return Boolean(res.rows[0]);
      },

      async getUserLikes(userId) {
        const res = await pool.query('SELECT postId FROM likes WHERE userId = $1', [userId]);
        return res.rows.map((r) => Number(r.postid ?? r.postId));
      },

      async insertComment(postId, userId, text, createdAt) {
        const res = await pool.query(
          'INSERT INTO comments (postId, userId, text, createdAt) VALUES ($1, $2, $3, $4) RETURNING id',
          [postId, userId, text, createdAt]
        );
        return res.rows[0].id;
      },

      async listComments(postId) {
        const res = await pool.query(
          `SELECT c.id, c.text, c.createdAt, u.username AS author, u.discordId AS "authorDiscordId", u.isVerified AS "authorVerified"
           FROM comments c
           JOIN users u ON u.id = c.userId
           WHERE c.postId = $1
           ORDER BY c.id DESC`,
          [postId]
        );
        return res.rows;
      },

      async recordView(postId, userId) {
        await pool.query(`
          INSERT INTO history (postId, userId, viewedAt)
          VALUES ($1, $2, NOW())
          ON CONFLICT (postId, userId)
          DO UPDATE SET viewedAt = EXCLUDED.viewedAt
        `, [postId, userId]);
      },

      async setWatchLater(postId, userId, add) {
        if (add) {
          await pool.query(`
            INSERT INTO watchlist (postId, userId, addedAt)
            VALUES ($1, $2, NOW())
            ON CONFLICT (postId, userId) DO NOTHING
          `, [postId, userId]);
          return true;
        }
        await pool.query('DELETE FROM watchlist WHERE postId = $1 AND userId = $2', [postId, userId]);
        return false;
      },

      async hasWatchLater(postId, userId) {
        const res = await pool.query('SELECT 1 FROM watchlist WHERE postId = $1 AND userId = $2 LIMIT 1', [postId, userId]);
        return Boolean(res.rows[0]);
      },

      async setFollow(followerId, followingDiscordId, follow) {
        if (follow) {
          await pool.query(
            `INSERT INTO follows (followerId, followingDiscordId)
             VALUES ($1, $2)
             ON CONFLICT (followerId, followingDiscordId) DO NOTHING`,
            [followerId, followingDiscordId]
          );
          return true;
        }
        await pool.query('DELETE FROM follows WHERE followerId = $1 AND followingDiscordId = $2', [followerId, followingDiscordId]);
        return false;
      },

      async hasFollow(followerId, followingDiscordId) {
        const res = await pool.query('SELECT 1 FROM follows WHERE followerId = $1 AND followingDiscordId = $2 LIMIT 1', [followerId, followingDiscordId]);
        return Boolean(res.rows[0]);
      },

      async followerCount(followingDiscordId) {
        const res = await pool.query('SELECT COUNT(*)::INT AS count FROM follows WHERE followingDiscordId = $1', [followingDiscordId]);
        return res.rows[0]?.count || 0;
      },

      async deletePost(postId) {
        await pool.query('DELETE FROM posts WHERE id = $1', [postId]);
        return true;
      },

      async setBanned(discordId, banned) {
        await pool.query('UPDATE users SET isBanned = $1 WHERE discordId = $2', [banned, discordId]);
        return true;
      },

      async setVerified(discordId, verified) {
        await pool.query('UPDATE users SET isVerified = $1 WHERE discordId = $2', [verified, discordId]);
        return true;
      },

      async setAdmin(discordId, admin) {
        await pool.query('UPDATE users SET isAdmin = $1 WHERE discordId = $2', [admin, discordId]);
        return true;
      },

      async getUserByDiscordId(discordId) {
        const res = await pool.query('SELECT id, discordId AS "discordId", username, avatar, isAdmin AS "isAdmin", isBanned AS "isBanned", isVerified AS "isVerified" FROM users WHERE discordId = $1 LIMIT 1', [discordId]);
        return res.rows[0] || null;
      },

      async updateUserProfile(discordId, { username, avatar }) {
        const res = await pool.query(
          `UPDATE users
           SET username = COALESCE($2, username),
               avatar = COALESCE($3, avatar),
               lastSeenAt = NOW()
           WHERE discordId = $1
           RETURNING id, discordId AS "discordId", username, avatar, isAdmin AS "isAdmin", isBanned AS "isBanned", isVerified AS "isVerified"`,
          [discordId, username ?? null, avatar ?? null]
        );
        return res.rows[0] || null;
      },

      async getAllUsers() {
        const res = await pool.query('SELECT id, discordId AS "discordId", username, avatar, isAdmin AS "isAdmin", isBanned AS "isBanned", isVerified AS "isVerified", createdAt AS "createdAt" FROM users ORDER BY createdAt DESC');
        return res.rows;
      },

      async getUserProfile(discordId) {
        const user = await this.getUserByDiscordId(discordId);
        if (!user) return null;

        const videosRes = await pool.query(
          `SELECT id, filename, type, title, description, format, createdat AS "createdAt", 
           COALESCE(lc.count, 0) AS likes
           FROM posts p
           LEFT JOIN (SELECT postId, COUNT(*) AS count FROM likes GROUP BY postId) lc ON lc.postId = p.id
           WHERE uploaderdiscordid = $1 AND status = 'published'
           ORDER BY createdat DESC`,
          [discordId]
        );

        const likesRes = await pool.query(
          `SELECT COALESCE(SUM(lc.count), 0)::INT AS total
           FROM posts p
           LEFT JOIN (SELECT postId, COUNT(*) AS count FROM likes GROUP BY postId) lc ON lc.postId = p.id
           WHERE p.uploaderdiscordid = $1 AND p.status = 'published'`,
          [discordId]
        );

        const followersRes = await pool.query(
          'SELECT COUNT(*)::INT AS count FROM follows WHERE followingDiscordId = $1',
          [discordId]
        );

        return {
          ...user,
          videos: videosRes.rows,
          totalVideos: videosRes.rows.length,
          totalLikes: likesRes.rows[0]?.total || 0,
          followerCount: followersRes.rows[0]?.count || 0
        };
      }
    };
  }

  // SQLite fallback
  const db = new Database(config.path);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discordId TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL,
      avatar TEXT,
      isAdmin INTEGER NOT NULL DEFAULT 0,
      isBanned INTEGER NOT NULL DEFAULT 0,
      isVerified INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      lastSeenAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const tableInfo = db.prepare('PRAGMA table_info(users)').all();
  if (!tableInfo.some(col => col.name === 'isAdmin')) {
    db.exec('ALTER TABLE users ADD COLUMN isAdmin INTEGER DEFAULT 0');
  }
  if (!tableInfo.some(col => col.name === 'isBanned')) {
    db.exec('ALTER TABLE users ADD COLUMN isBanned INTEGER DEFAULT 0');
  }
  if (!tableInfo.some(col => col.name === 'isVerified')) {
    db.exec('ALTER TABLE users ADD COLUMN isVerified INTEGER DEFAULT 0');
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT DEFAULT '',
      description TEXT DEFAULT '',
      uploaderDiscordId TEXT NOT NULL,
      uploaderName TEXT DEFAULT '',
      status TEXT NOT NULL,
      editToken TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      format TEXT NOT NULL DEFAULT 'long'
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      postId INTEGER NOT NULL,
      userId INTEGER NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(postId, userId),
      FOREIGN KEY (postId) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      postId INTEGER NOT NULL,
      userId INTEGER NOT NULL,
      text TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (postId) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      postId INTEGER NOT NULL,
      userId INTEGER NOT NULL,
      viewedAt TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(postId, userId),
      FOREIGN KEY (postId) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS watchlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      postId INTEGER NOT NULL,
      userId INTEGER NOT NULL,
      addedAt TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(postId, userId),
      FOREIGN KEY (postId) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS follows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      followerId INTEGER NOT NULL,
      followingDiscordId TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(followerId, followingDiscordId),
      FOREIGN KEY (followerId) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_comments_postId ON comments(postId)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_likes_postId ON likes(postId)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_history_user ON history(userId, viewedAt)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist(userId, addedAt)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_follows_target ON follows(followingDiscordId)');

  const postColumns = db.prepare("PRAGMA table_info(posts)").all();
  const commentColumns = db.prepare("PRAGMA table_info(comments)").all();

  if (!postColumns.some((r) => r.name === 'uploaderName')) {
    db.exec("ALTER TABLE posts ADD COLUMN uploaderName TEXT DEFAULT ''");
  }

  if (!postColumns.some((r) => r.name === 'format')) {
    db.exec("ALTER TABLE posts ADD COLUMN format TEXT DEFAULT 'long'");
  }

  if (!commentColumns.some((r) => r.name === 'userId')) {
    db.exec('ALTER TABLE comments ADD COLUMN userId INTEGER');
  }

  const upsertUserStmt = db.prepare(`
    INSERT INTO users (discordId, username, avatar)
    VALUES (@discordId, @username, @avatar)
    ON CONFLICT(discordId) DO UPDATE SET username = excluded.username, avatar = excluded.avatar, lastSeenAt = datetime('now')
    RETURNING id, discordId, username, avatar
  `);
  const insertPostStmt = db.prepare(`
    INSERT INTO posts (filename, type, title, description, uploaderDiscordId, uploaderName, status, editToken, createdAt)
    VALUES (@filename, @type, @title, @description, @uploaderDiscordId, @uploaderName, @status, @editToken, @createdAt)
  `);
  const getPostStmt = db.prepare(`
    SELECT p.*, COALESCE(lc.count, 0) AS likes, u.avatar AS uploaderAvatar, COALESCE(u.isVerified, 0) AS uploaderVerified
    FROM posts p
    LEFT JOIN (
      SELECT postId, COUNT(*) AS count FROM likes GROUP BY postId
    ) lc ON lc.postId = p.id
    LEFT JOIN users u ON u.discordId = p.uploaderDiscordId
    WHERE p.id = ?
  `);
  const listPublishedStmt = db.prepare(`
    SELECT p.*, COALESCE(lc.count, 0) AS likes, u.avatar AS uploaderAvatar, COALESCE(u.isVerified, 0) AS uploaderVerified
    FROM posts p
    LEFT JOIN (
      SELECT postId, COUNT(*) AS count FROM likes GROUP BY postId
    ) lc ON lc.postId = p.id
    LEFT JOIN users u ON u.discordId = p.uploaderDiscordId
    WHERE p.status = 'published'
    ORDER BY p.id DESC
  `);
  const listTrendingStmt = db.prepare(`
    SELECT p.*, COALESCE(lc.count, 0) AS likes, u.avatar AS uploaderAvatar, COALESCE(u.isVerified, 0) AS uploaderVerified
    FROM posts p
    LEFT JOIN (
      SELECT postId, COUNT(*) AS count FROM likes GROUP BY postId
    ) lc ON lc.postId = p.id
    LEFT JOIN users u ON u.discordId = p.uploaderDiscordId
    WHERE p.status = 'published'
    ORDER BY lc.count DESC, p.createdAt DESC
    LIMIT 100
  `);
  const publishPostStmt = db.prepare(`UPDATE posts SET title = @title, description = @description, status = 'published' WHERE id = @id`);
  const hasLikeStmt = db.prepare('SELECT 1 FROM likes WHERE postId = ? AND userId = ?');
  const insertLikeStmt = db.prepare('INSERT OR IGNORE INTO likes (postId, userId) VALUES (?, ?)');
  const deleteLikeStmt = db.prepare('DELETE FROM likes WHERE postId = ? AND userId = ?');
  const countLikesStmt = db.prepare('SELECT COUNT(*) AS count FROM likes WHERE postId = ?');
  const userLikesStmt = db.prepare('SELECT postId FROM likes WHERE userId = ?');
  const insertCommentStmt = db.prepare('INSERT INTO comments (postId, userId, text, createdAt) VALUES (?, ?, ?, ?)');
  const listCommentsStmt = db.prepare(`
    SELECT c.id, c.text, c.createdAt, u.username AS author, u.discordId AS authorDiscordId, u.isVerified AS authorVerified
    FROM comments c
    JOIN users u ON u.id = c.userId
    WHERE c.postId = ?
    ORDER BY c.id DESC
  `);
  const recordViewUpsertStmt = db.prepare(`
    INSERT INTO history (postId, userId, viewedAt)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(postId, userId) DO UPDATE SET viewedAt = excluded.viewedAt
  `);
  const listHistoryStmt = db.prepare(`
    SELECT p.*, h.viewedAt, COALESCE(lc.count, 0) AS likes, u.avatar AS uploaderAvatar, COALESCE(u.isVerified, 0) AS uploaderVerified
    FROM history h
    JOIN posts p ON p.id = h.postId
    LEFT JOIN (
      SELECT postId, COUNT(*) AS count FROM likes GROUP BY postId
    ) lc ON lc.postId = p.id
    LEFT JOIN users u ON u.discordId = p.uploaderDiscordId
    WHERE h.userId = ? AND p.status = 'published'
    ORDER BY h.viewedAt DESC
  `);
  const addWatchStmt = db.prepare(`
    INSERT INTO watchlist (postId, userId, addedAt)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(postId, userId) DO NOTHING
  `);
  const removeWatchStmt = db.prepare('DELETE FROM watchlist WHERE postId = ? AND userId = ?');
  const hasWatchStmt = db.prepare('SELECT 1 FROM watchlist WHERE postId = ? AND userId = ?');
  const listWatchlistStmt = db.prepare(`
    SELECT p.*, w.addedAt, COALESCE(lc.count, 0) AS likes, u.avatar AS uploaderAvatar, COALESCE(u.isVerified, 0) AS uploaderVerified
    FROM watchlist w
    JOIN posts p ON p.id = w.postId
    LEFT JOIN (
      SELECT postId, COUNT(*) AS count FROM likes GROUP BY postId
    ) lc ON lc.postId = p.id
    LEFT JOIN users u ON u.discordId = p.uploaderDiscordId
    WHERE w.userId = ? AND p.status = 'published'
    ORDER BY w.addedAt DESC
  `);
  const hasFollowStmt = db.prepare('SELECT 1 FROM follows WHERE followerId = ? AND followingDiscordId = ?');
  const followInsertStmt = db.prepare('INSERT OR IGNORE INTO follows (followerId, followingDiscordId) VALUES (?, ?)');
  const followDeleteStmt = db.prepare('DELETE FROM follows WHERE followerId = ? AND followingDiscordId = ?');
  const followerCountStmt = db.prepare('SELECT COUNT(*) AS count FROM follows WHERE followingDiscordId = ?');

  return {
    async init() {},

    async upsertUser(data) {
      return upsertUserStmt.get(data);
    },

    async getUserById(id) {
      return db.prepare('SELECT id, discordId, username, avatar FROM users WHERE id = ? LIMIT 1').get(id);
    },

    async getUserByDiscordId(discordId) {
      return db.prepare('SELECT id, discordId, username, avatar, isAdmin, isBanned, isVerified FROM users WHERE discordId = ? LIMIT 1').get(discordId);
    },

    insertPost: (data) => Promise.resolve(insertPostStmt.run(data)),

    getPost: (id) => Promise.resolve(getPostStmt.get(id)),

    listPublished: () => Promise.resolve(listPublishedStmt.all()),

    searchPosts: (query) => {
      const searchTerm = `%${query}%`;
      const stmt = db.prepare(`
        SELECT p.*, COALESCE(lc.count, 0) AS likes, u.avatar AS uploaderAvatar, COALESCE(u.isVerified, 0) AS uploaderVerified
        FROM posts p
        LEFT JOIN (
          SELECT postId, COUNT(*) AS count FROM likes GROUP BY postId
        ) lc ON lc.postId = p.id
        LEFT JOIN users u ON u.discordId = p.uploaderDiscordId
        WHERE p.status = 'published' AND (LOWER(p.title) LIKE LOWER(?) OR LOWER(p.description) LIKE LOWER(?) OR LOWER(p.uploaderName) LIKE LOWER(?))
        ORDER BY p.id DESC
        LIMIT 50
      `);
      return Promise.resolve(stmt.all(searchTerm, searchTerm, searchTerm));
    },

    listTrending: () => Promise.resolve(listTrendingStmt.all()),

    publishPost: (data) => Promise.resolve(publishPostStmt.run(data)),

    async setLike(postId, userId, like) {
      if (like) {
        insertLikeStmt.run(postId, userId);
      } else {
        deleteLikeStmt.run(postId, userId);
      }
      const res = countLikesStmt.get(postId);
      return res.count;
    },

    async hasUserLiked(postId, userId) {
      const row = hasLikeStmt.get(postId, userId);
      return Boolean(row);
    },

    async getUserLikes(userId) {
      return userLikesStmt.all(userId).map((r) => r.postId);
    },

    insertComment: (postId, userId, text, createdAt) => Promise.resolve(insertCommentStmt.run(postId, userId, text, createdAt).lastInsertRowid),

    listComments: (postId) => Promise.resolve(listCommentsStmt.all(postId))
    ,

    async recordView(postId, userId) {
      recordViewUpsertStmt.run(postId, userId);
    },

    async listHistory(userId) {
      return listHistoryStmt.all(userId);
    },

    async setWatchLater(postId, userId, add) {
      if (add) {
        addWatchStmt.run(postId, userId);
        return true;
      }
      removeWatchStmt.run(postId, userId);
      return false;
    },

    async hasWatchLater(postId, userId) {
      const row = hasWatchStmt.get(postId, userId);
      return Boolean(row);
    },

    async listWatchlist(userId) {
      return listWatchlistStmt.all(userId);
    },

    async setFollow(followerId, followingDiscordId, follow) {
      if (follow) {
        followInsertStmt.run(followerId, followingDiscordId);
        return true;
      }
      followDeleteStmt.run(followerId, followingDiscordId);
      return false;
    },

    async hasFollow(followerId, followingDiscordId) {
      const row = hasFollowStmt.get(followerId, followingDiscordId);
      return Boolean(row);
    },

    async followerCount(followingDiscordId) {
      const row = followerCountStmt.get(followingDiscordId);
      return row?.count || 0;
    },

    async deletePost(postId) {
      db.prepare('DELETE FROM posts WHERE id = ?').run(postId);
      return true;
    },

    async setBanned(discordId, banned) {
      db.prepare('UPDATE users SET isBanned = ? WHERE discordId = ?').run(banned ? 1 : 0, discordId);
      return true;
    },

    async setVerified(discordId, verified) {
      db.prepare('UPDATE users SET isVerified = ? WHERE discordId = ?').run(verified ? 1 : 0, discordId);
      return true;
    },

    async setAdmin(discordId, admin) {
      db.prepare('UPDATE users SET isAdmin = ? WHERE discordId = ?').run(admin ? 1 : 0, discordId);
      return true;
    },

    async getUserByDiscordId(discordId) {
      const user = db.prepare('SELECT id, discordId, username, avatar, isAdmin, isBanned, isVerified FROM users WHERE discordId = ? LIMIT 1').get(discordId) || null;
      if (!user) return null;
      return {
        ...user,
        isAdmin: Boolean(user.isAdmin),
        isBanned: Boolean(user.isBanned),
        isVerified: Boolean(user.isVerified)
      };
    },

    async updateUserProfile(discordId, { username, avatar }) {
      const stmt = db.prepare(`
        UPDATE users
        SET username = COALESCE(@username, username),
            avatar = COALESCE(@avatar, avatar),
            lastSeenAt = datetime('now')
        WHERE discordId = @discordId
        RETURNING id, discordId, username, avatar, isAdmin, isBanned, isVerified
      `);
      return stmt.get({ discordId, username: username ?? null, avatar: avatar ?? null }) || null;
    },

    async getUserProfile(discordId) {
      const user = this.getUserByDiscordId(discordId);
      if (!user) return null;

      const videos = db.prepare(
        `SELECT p.id, p.filename, p.type, p.title, p.description, p.format, p.createdAt,
         COALESCE(lc.count, 0) AS likes
         FROM posts p
         LEFT JOIN (SELECT postId, COUNT(*) AS count FROM likes GROUP BY postId) lc ON lc.postId = p.id
         WHERE p.uploaderDiscordId = ? AND p.status = 'published'
         ORDER BY p.createdAt DESC`
      ).all(discordId);

      const totalLikes = db.prepare(
        `SELECT COALESCE(SUM(lc.count), 0) AS total
         FROM posts p
         LEFT JOIN (SELECT postId, COUNT(*) AS count FROM likes GROUP BY postId) lc ON lc.postId = p.id
         WHERE p.uploaderDiscordId = ? AND p.status = 'published'`
      ).get(discordId);

      const followerCount = db.prepare(
        'SELECT COUNT(*) AS count FROM follows WHERE followingDiscordId = ?'
      ).get(discordId);

      return {
        ...user,
        videos,
        totalVideos: videos.length,
        totalLikes: totalLikes?.total || 0,
        followerCount: followerCount?.count || 0
      };
    },

    async getAllUsers() {
      const users = db.prepare('SELECT id, discordId, username, avatar, isAdmin, isBanned, isVerified, createdAt FROM users ORDER BY createdAt DESC').all();
      return users.map(u => ({
        ...u,
        isAdmin: Boolean(u.isAdmin),
        isBanned: Boolean(u.isBanned),
        isVerified: Boolean(u.isVerified)
      }));
    }
  };
}
