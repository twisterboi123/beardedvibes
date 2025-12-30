const statusEl = document.getElementById('status');
const previewEl = document.getElementById('preview');
const titleEl = document.getElementById('title');
const descriptionEl = document.getElementById('description');
const typePill = document.getElementById('type-pill');
const publishedAtEl = document.getElementById('published-at');
const uploaderTag = document.getElementById('uploader-tag');
const uploaderNameEl = document.getElementById('uploader-name');
const uploaderAvatarEl = document.getElementById('uploader-avatar');
const followerCountEl = document.getElementById('follower-count');
const likeBtn = document.getElementById('like-btn');
const likeCount = document.getElementById('like-count');
const watchBtn = document.getElementById('watch-btn');
const deleteBtn = document.getElementById('delete-btn');
const followBtn = document.getElementById('follow-btn');
const commentsList = document.getElementById('comments-list');
const commentForm = document.getElementById('comment-form');
const commentText = document.getElementById('comment-text');
const commentSubmit = document.getElementById('comment-submit');
const commentHint = document.getElementById('comment-hint');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const authLabel = document.getElementById('auth-label');
const sessionUser = document.getElementById('session-user');
const sessionAvatar = document.getElementById('session-avatar');
const commentCountEl = document.getElementById('comment-count');
const playerWrapper = document.querySelector('.player-wrapper');

let videoEl = null;
let hasRecordedView = false;
let playOverlay = null;

const state = {
  user: null,
  postId: null,
  liked: false,
  watchLater: false,
  following: false,
  uploaderDiscordId: null,
  uploaderName: null
};

// Create lightbox elements
let lightbox = null;
let lightboxImg = null;

function createLightbox() {
  if (lightbox) return;
  
  lightbox = document.createElement('div');
  lightbox.className = 'lightbox';
  lightbox.onclick = closeLightbox;
  
  lightboxImg = document.createElement('img');
  lightboxImg.onclick = (e) => e.stopPropagation();
  
  const closeBtn = document.createElement('button');
  closeBtn.className = 'lightbox-close';
  closeBtn.innerHTML = '✕';
  closeBtn.onclick = closeLightbox;
  
  lightbox.appendChild(lightboxImg);
  lightbox.appendChild(closeBtn);
  document.body.appendChild(lightbox);
  
  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && lightbox.classList.contains('active')) {
      closeLightbox();
    }
  });
}

function openLightbox(src, alt) {
  createLightbox();
  lightboxImg.src = src;
  lightboxImg.alt = alt || 'Full size image';
  lightbox.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  if (lightbox) {
    lightbox.classList.remove('active');
    document.body.style.overflow = '';
  }
}

function setAvatar(el, url, fallback) {
  if (!el) return;
  el.innerHTML = '';
  if (url) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = fallback;
    el.appendChild(img);
    return;
  }
  el.textContent = (fallback || '?').slice(0, 2).toUpperCase();
}

function setStatus(text, type = 'info') {
  statusEl.textContent = text;
  statusEl.className = `status ${type === 'error' ? 'error' : type === 'success' ? 'success' : ''}`;
}

function renderPreview(data) {
  previewEl.innerHTML = '';
  if (data.type === 'image') {
    const img = document.createElement('img');
    img.src = data.fileUrl;
    img.alt = data.title || 'Post preview';
    img.style.cursor = 'zoom-in';
    img.onclick = () => openLightbox(data.fileUrl, data.title);
    previewEl.appendChild(img);
    videoEl = null;
  } else if (data.type === 'video') {
    const video = document.createElement('video');
    video.src = data.fileUrl;
    video.controls = false;
    video.preload = 'metadata';
    video.playsInline = true;
    videoEl = video;
    previewEl.appendChild(video);

    playOverlay = document.createElement('div');
    playOverlay.className = 'play-overlay';
    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'play-btn';
    playBtn.textContent = '▶';
    playOverlay.appendChild(playBtn);
    previewEl.appendChild(playOverlay);

    const startPlayback = () => {
      if (!videoEl) return;
      if (playOverlay) playOverlay.style.display = 'none';
      if (playerWrapper) playerWrapper.classList.add('is-playing');
      videoEl.controls = true;
      videoEl.muted = false;
      videoEl.play().catch(() => {});
      if (!hasRecordedView && state.user) {
        hasRecordedView = true;
        recordView(state.postId).catch(() => {});
      }
    };

    video.addEventListener('play', () => {
      if (playOverlay) playOverlay.style.display = 'none';
      if (playerWrapper) playerWrapper.classList.add('is-playing');
    });

    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startPlayback();
    });
    previewEl.addEventListener('click', startPlayback);
  } else {
    previewEl.textContent = 'Unsupported file type';
  }
}

async function fetchPost(id) {
  const response = await fetch(`/api/post/${id}`);
  if (!response.ok) {
    const message = (await response.json().catch(() => ({}))).error || 'Post not found';
    throw new Error(message);
  }
  return response.json();
}

async function fetchComments(id) {
  const response = await fetch(`/api/post/${id}/comments`);
  if (!response.ok) return [];
  const data = await response.json();
  return data.comments || [];
}

function renderComments(list) {
  commentsList.innerHTML = '';
  if (commentCountEl) commentCountEl.textContent = list.length;
  if (!list.length) {
    const empty = document.createElement('p');
    empty.textContent = 'No comments yet. Be the first!';
    commentsList.appendChild(empty);
    return;
  }
  list.forEach((c) => {
    const card = document.createElement('div');
    card.className = 'comment';
    
    const author = document.createElement('div');
    author.className = 'author';
    author.style.display = 'flex';
    author.style.alignItems = 'center';
    author.style.gap = '6px';
    
    if (c.authorDiscordId) {
      const authorLink = document.createElement('a');
      authorLink.href = `/profile.html?id=${c.authorDiscordId}`;
      authorLink.textContent = c.author;
      authorLink.style.cursor = 'pointer';
      authorLink.style.color = 'inherit';
      authorLink.style.textDecoration = 'none';
      authorLink.title = 'View profile';
      author.appendChild(authorLink);
    } else {
      const nameSpan = document.createElement('span');
      nameSpan.textContent = c.author;
      author.appendChild(nameSpan);
    }
    
    if (c.authorVerified) {
      const badge = document.createElement('span');
      badge.className = 'verified-badge';
      badge.innerHTML = '<svg viewBox="0 0 24 24" style="width:10px;height:10px;fill:currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>Verified';
      badge.style.fontSize = '9px';
      badge.style.padding = '1px 6px';
      author.appendChild(badge);
    }
    
    const text = document.createElement('div');
    text.className = 'text';
    text.textContent = c.text;
    const time = document.createElement('div');
    time.className = 'time';
    time.textContent = new Date(c.createdAt).toLocaleString();
    card.append(author, text, time);
    commentsList.appendChild(card);
  });
}

async function likePost(id) {
  const response = await fetch(`/api/post/${id}/like`, { method: 'POST' });
  if (!response.ok) throw new Error('Unable to like right now');
  return response.json();
}

async function toggleWatchLater(id) {
  const response = await fetch(`/api/post/${id}/watchlater`, { method: 'POST' });
  if (!response.ok) throw new Error('Unable to update Watch Later');
  return response.json();
}

async function recordView(id) {
  const response = await fetch(`/api/post/${id}/view`, { method: 'POST' });
  if (!response.ok) return;
}

async function fetchFollowStatus(discordId) {
  const res = await fetch(`/api/user/${discordId}/follow`);
  if (!res.ok) throw new Error('Unable to load follow status');
  return res.json();
}

async function toggleFollow(discordId, follow, meta = {}) {
  const res = await fetch(`/api/user/${discordId}/follow`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ follow, username: meta.username, avatar: meta.avatar })
  });
  if (!res.ok) {
    const msg = (await res.json().catch(() => ({}))).error || 'Unable to update follow';
    throw new Error(msg);
  }
  return res.json();
}

async function addComment(id, text) {
  const response = await fetch(`/api/post/${id}/comment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  if (!response.ok) {
    const msg = (await response.json().catch(() => ({}))).error || 'Failed to post comment';
    throw new Error(msg);
  }
  return response.json();
}

function updateAuthUi() {
  if (state.user) {
    authLabel.textContent = `Logged in as ${state.user.username}`;
    loginBtn.style.display = 'none';
    logoutBtn.style.display = 'inline-flex';
    if (sessionUser) sessionUser.style.display = 'flex';
    setAvatar(sessionAvatar, state.user.avatar, state.user.username || 'User');
    commentText.disabled = false;
    commentSubmit.disabled = false;
    commentHint.textContent = `Commenting as ${state.user.username}`;
  } else {
    authLabel.textContent = 'Not logged in. Likes and comments require Discord.';
    loginBtn.style.display = 'inline-flex';
    logoutBtn.style.display = 'none';
    if (sessionUser) sessionUser.style.display = 'none';
    commentText.disabled = true;
    commentSubmit.disabled = true;
    commentHint.textContent = 'Log in with Discord to comment.';
  }
}

function updateFollowUi(following, followerCount) {
  state.following = following;
  if (followBtn) {
    followBtn.classList.toggle('following', following);
    followBtn.textContent = following ? 'Following' : 'Follow';
  }
  if (followerCountEl && typeof followerCount === 'number') {
    followerCountEl.textContent = `${followerCount} follower${followerCount === 1 ? '' : 's'}`;
  }
}

async function loadUser() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) {
      if (res.status === 403) {
        const data = await res.json().catch(() => ({}));
        if (data.banned) {
          alert('Your account has been banned and cannot access this platform.');
          window.location.href = '/api/auth/logout';
          return;
        }
      }
      throw new Error('No session');
    }
    const data = await res.json();
    state.user = data.user;
  } catch (_err) {
    state.user = null;
  }
  updateAuthUi();
}

loginBtn.addEventListener('click', () => {
  window.location.href = '/api/auth/login';
});

logoutBtn.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  state.user = null;
  updateAuthUi();
  updateLikeButton(false);
});

function updateLikeButton(liked) {
  state.liked = liked;
  likeBtn.classList.toggle('active', liked);
  const label = likeBtn.querySelector('span');
  if (label) {
    label.textContent = liked ? '❤️ Liked' : '♡ Like';
  }
}

function updateWatchButton(active) {
  state.watchLater = active;
  watchBtn.classList.toggle('active', active);
  watchBtn.textContent = active ? '✓ Saved' : '⏰ Watch Later';
}

async function init() {
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  const id = pathParts[pathParts.length - 1];
  state.postId = id;

  const loadingOverlay = document.getElementById('loading-post');
  
  await loadUser();

  try {
    setStatus('Loading post…');
    const data = await fetchPost(id);
    
    // Hide loading overlay with fade
    setTimeout(() => {
      loadingOverlay.style.opacity = '0';
      setTimeout(() => {
        loadingOverlay.style.display = 'none';
      }, 300);
    }, 500);
    
    titleEl.textContent = data.title || 'Untitled';
    descriptionEl.textContent = data.description || 'No description provided yet.';
    const formatLabel = data.format === 'short' ? 'Short' : 'Long form';
    typePill.textContent = data.type === 'video' ? `Video • ${formatLabel}` : 'Image';
    publishedAtEl.textContent = `Published on ${new Date(data.createdAt).toLocaleString()}`;
    const uploaderName = data.uploaderName || 'Unknown uploader';
    uploaderTag.textContent = data.uploaderName ? `@${data.uploaderName.toLowerCase().replace(/\s+/g, '')}` : 'Uploader unknown';
    uploaderNameEl.innerHTML = '';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = uploaderName;
    uploaderNameEl.appendChild(nameSpan);
    if (data.uploaderVerified) {
      const badge = document.createElement('span');
      badge.className = 'verified-badge';
      badge.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>Verified';
      uploaderNameEl.appendChild(badge);
    }
    state.uploaderDiscordId = data.uploaderDiscordId || null;
    state.uploaderName = data.uploaderName || null;
    setAvatar(uploaderAvatarEl, data.uploaderAvatar, uploaderName);
    
    // Show delete button if user is owner or admin
    if (state.user && (state.user.discordId === state.uploaderDiscordId || state.user.isAdmin)) {
      deleteBtn.style.display = 'inline-flex';
    }
    
    if (state.uploaderDiscordId) {
      uploaderNameEl.href = `/profile.html?id=${state.uploaderDiscordId}`;
      uploaderNameEl.style.cursor = 'pointer';
      uploaderNameEl.title = 'View profile';
      uploaderNameEl.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.location.href = `/profile.html?id=${state.uploaderDiscordId}`;
      };
      uploaderAvatarEl.style.cursor = 'pointer';
      uploaderAvatarEl.title = 'View profile';
      uploaderAvatarEl.onclick = (e) => {
        e.stopPropagation();
        window.location.href = `/profile.html?id=${state.uploaderDiscordId}`;
      };
    }
    likeCount.textContent = data.likes ?? 0;
    updateLikeButton(Boolean(data.liked));
    // watch later initial state (optional; not provided by API yet)
    try {
      if (state.user) {
        await recordView(id);
        hasRecordedView = true;
      }
    } catch (_e) {}
    renderPreview(data);
    setStatus('Published and ready to watch.', 'success');

    // Follow status
    if (state.uploaderDiscordId) {
      try {
        const followData = await fetchFollowStatus(state.uploaderDiscordId);
        updateFollowUi(followData.following, followData.followerCount);
      } catch (_err) {
        updateFollowUi(false, 0);
      }
    }

    const initialComments = await fetchComments(id);
    renderComments(initialComments);

    likeBtn.addEventListener('click', async () => {
      if (!state.user) {
        window.location.href = '/api/auth/login';
        return;
      }
      likeBtn.disabled = true;
      try {
        const result = await likePost(id);
        likeCount.textContent = result.likes;
        updateLikeButton(result.liked);
      } catch (err) {
        setStatus(err.message, 'error');
      } finally {
        likeBtn.disabled = false;
      }
    });

    watchBtn.addEventListener('click', async () => {
      if (!state.user) {
        window.location.href = '/api/auth/login';
        return;
      }
      watchBtn.disabled = true;
      try {
        const result = await toggleWatchLater(id);
        updateWatchButton(result.watchLater);
        setStatus(result.watchLater ? 'Saved to Watch Later.' : 'Removed from Watch Later.', 'success');
        setTimeout(() => setStatus('Published and ready to watch.', 'success'), 1500);
      } catch (err) {
        setStatus(err.message, 'error');
      } finally {
        watchBtn.disabled = false;
      }
    });

    deleteBtn.addEventListener('click', async () => {
      if (!state.user) return;
      
      const confirmDelete = confirm('Are you sure you want to delete this post? This action cannot be undone.');
      if (!confirmDelete) return;
      
      deleteBtn.disabled = true;
      deleteBtn.textContent = 'Deleting...';
      
      try {
        const res = await fetch(`/api/post/${id}`, { method: 'DELETE' });
        const result = await res.json();
        
        if (!res.ok) throw new Error(result.error || 'Failed to delete');
        
        alert('Post deleted successfully!');
        window.location.href = '/';
      } catch (err) {
        setStatus(err.message, 'error');
        deleteBtn.disabled = false;
        deleteBtn.textContent = '🗑️ Delete';
      }
    });

    followBtn.addEventListener('click', async () => {
      if (!state.user) {
        window.location.href = '/api/auth/login';
        return;
      }
      if (!state.uploaderDiscordId) return;
      followBtn.disabled = true;
      try {
        const result = await toggleFollow(state.uploaderDiscordId, !state.following, {
          username: uploaderName,
          avatar: data.uploaderAvatar
        });
        updateFollowUi(result.following, result.followerCount);
      } catch (err) {
        setStatus(err.message, 'error');
      } finally {
        followBtn.disabled = false;
      }
    });

    commentForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!state.user) {
        window.location.href = '/api/auth/login';
        return;
      }
      commentSubmit.disabled = true;
      commentSubmit.textContent = 'Posting...';
      try {
        const text = commentText.value.trim();
        if (!text) throw new Error('Please enter a comment.');
        await addComment(id, text);
        commentText.value = '';
        const latest = await fetchComments(id);
        renderComments(latest);
        setStatus('Comment posted!', 'success');
        setTimeout(() => setStatus('Published and ready to watch.', 'success'), 2000);
      } catch (err) {
        setStatus(err.message, 'error');
      } finally {
        commentSubmit.disabled = false;
        commentSubmit.textContent = 'Post comment';
      }
    });
    
    // Load recommended videos
    loadRecommendedVideos(id);
  } catch (err) {
    loadingOverlay.style.display = 'none';
    setStatus(err.message, 'error');
    previewEl.innerHTML = '<p>Nothing to show.</p>';
    titleEl.textContent = 'Unavailable';
    descriptionEl.textContent = '';
    likeBtn.disabled = true;
    commentSubmit.disabled = true;
  }
}

async function loadRecommendedVideos(currentPostId) {
  const recommendedContainer = document.getElementById('recommended-videos');
  if (!recommendedContainer) return;
  
  try {
    const res = await fetch('/api/posts');
    if (!res.ok) return;
    
    const data = await res.json();
    const posts = (data.posts || [])
      .filter(p => p.id !== Number(currentPostId)) // Exclude current post
      .slice(0, 8); // Show up to 8 recommended videos
    
    if (posts.length === 0) {
      recommendedContainer.innerHTML = '<p style="color: var(--yt-text-secondary); font-size: 14px;">No other videos yet.</p>';
      return;
    }
    
    recommendedContainer.innerHTML = '';
    posts.forEach(post => {
      const card = document.createElement('div');
      card.className = 'recommended-card';
      card.onclick = () => window.location.href = `/post/${post.id}`;
      
      const thumb = document.createElement('div');
      thumb.className = 'thumb';
      
      if (post.type === 'video') {
        const video = document.createElement('video');
        video.src = post.fileUrl;
        video.muted = true;
        video.preload = 'metadata';
        thumb.appendChild(video);
        
        card.addEventListener('mouseenter', () => video.play().catch(() => {}));
        card.addEventListener('mouseleave', () => { video.pause(); video.currentTime = 0; });
      } else {
        const img = document.createElement('img');
        img.src = post.fileUrl;
        img.alt = post.title || 'Image';
        img.loading = 'lazy';
        thumb.appendChild(img);
      }
      
      const info = document.createElement('div');
      info.className = 'info';
      
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = post.title || 'Untitled';
      
      const channel = document.createElement('div');
      channel.className = 'channel';
      channel.textContent = post.uploaderName || 'Unknown';
      
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = `${post.likes || 0} likes`;
      
      info.append(title, channel, meta);
      card.append(thumb, info);
      recommendedContainer.appendChild(card);
    });
  } catch (err) {
    console.error('Failed to load recommended videos:', err);
  }
}

init();
