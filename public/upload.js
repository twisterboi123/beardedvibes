const form = document.getElementById('upload-form');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');
const uploadBtn = document.getElementById('upload-btn');
const sessionPill = document.getElementById('session-pill');
const logoutBtn = document.getElementById('logout-btn');
const homeBtn = document.getElementById('home-btn');
const fileInput = document.getElementById('file');
const fileLabel = document.getElementById('file-label');
const dropzone = document.getElementById('dropzone');
const publishCheckbox = document.getElementById('publish-now');
const formatInput = document.getElementById('format-input');
const formatButtons = document.querySelectorAll('#format-toggle .tab');
const formatToggle = document.getElementById('format-toggle');
const filePreview = document.getElementById('file-preview');
const previewMedia = document.getElementById('preview-media');
const previewName = document.getElementById('preview-name');
const previewSize = document.getElementById('preview-size');
const previewRemove = document.getElementById('preview-remove');

homeBtn.addEventListener('click', () => window.location.href = '/');
logoutBtn.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/';
});

// Format file size
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Update format toggle based on file type
function updateFormatOptions(file) {
  const isVideo = file && file.type.startsWith('video/');
  
  formatButtons.forEach((btn) => {
    const fmt = btn.dataset.format;
    // Only show short/long options for videos
    btn.style.display = (fmt === 'short' || fmt === 'long') ? '' : 'none';
    if (isVideo && formatInput.value !== 'short' && formatInput.value !== 'long') {
      // Default to long form for videos
      formatInput.value = 'long';
      btn.classList.toggle('active', fmt === 'long');
    }
  });
}

// Show file preview
function showPreview(file) {
  if (!file) {
    hidePreview();
    return;
  }
  
  // Update format options based on file type
  updateFormatOptions(file);
  
  previewMedia.innerHTML = '';
  previewName.textContent = file.name;
  previewSize.textContent = formatFileSize(file.size);
  
  const url = URL.createObjectURL(file);
  
  if (file.type.startsWith('video/')) {
    const video = document.createElement('video');
    video.src = url;
    video.controls = true;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    previewMedia.appendChild(video);
  } else if (file.type.startsWith('image/')) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = 'Preview';
    previewMedia.appendChild(img);
  }
  
  filePreview.classList.add('active');
  dropzone.style.display = 'none';
}

// Hide file preview
function hidePreview() {
  filePreview.classList.remove('active');
  dropzone.style.display = 'block';
  previewMedia.innerHTML = '';
  previewName.textContent = '';
  previewSize.textContent = '';
  // Reset format options when file is removed
  formatButtons.forEach((btn) => {
    btn.style.display = '';
  });
}

// Remove file
function removeFile() {
  fileInput.value = '';
  hidePreview();
  // Reset to default format
  formatInput.value = 'long';
  formatButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.format === 'long');
    btn.style.display = '';
  });
  fileLabel.innerHTML = 'Drag & drop or click to choose<br><small style="color: var(--yt-text-secondary);">mp4, webm, jpg, png, webp</small>';
}

previewRemove.addEventListener('click', removeFile);

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragging');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragging'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragging');
  if (e.dataTransfer.files?.length) {
    fileInput.files = e.dataTransfer.files;
    showPreview(e.dataTransfer.files[0]);
  }
});

fileInput.addEventListener('change', () => {
  if (fileInput.files?.length) {
    showPreview(fileInput.files[0]);
  } else {
    hidePreview();
  }
});

formatButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const fmt = btn.dataset.format; // 'short', 'long', or 'photo'
    formatInput.value = fmt;
    formatButtons.forEach((b) => b.classList.toggle('active', b === btn));
  });
});

function setStatus(text, type = 'info') {
  statusEl.style.display = 'block';
  statusEl.textContent = text;
  statusEl.className = `status ${type === 'error' ? 'error' : type === 'success' ? 'success' : ''}`;
}

function setResult({ status, editLink, token, viewLink }) {
  resultEl.style.display = 'block';
  if (status === 'published') {
    resultEl.innerHTML = `Published! <a href="${viewLink}" target="_blank">View post</a>.`;
  } else {
    resultEl.innerHTML = `Draft saved. <a href="${editLink}" target="_blank">Open edit page</a> (token auto-included).`;
  }
}

async function ensureSession() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) throw new Error();
    const data = await res.json();
    if (!data.user) throw new Error();
    sessionPill.textContent = `Signed in as ${data.user.username}`;
    logoutBtn.style.display = 'inline-flex';
  } catch (_err) {
    sessionPill.textContent = 'Sign in with Discord to upload';
    window.location.href = '/api/auth/login';
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = fileInput.files?.[0];
  if (!file) {
    setStatus('Choose a file to upload.', 'error');
    return;
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('format', formatInput.value || 'long'); // 'short', 'long', or 'photo'
  formData.append('title', form.title.value);
  formData.append('description', form.description.value);
  formData.append('publish', publishCheckbox.checked ? 'true' : 'false');

  uploadBtn.disabled = true;
  setStatus('Uploading…');
  resultEl.style.display = 'none';

  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });
    if (!res.ok) {
      const msg = (await res.json().catch(() => ({}))).error || 'Upload failed';
      throw new Error(msg);
    }
    const data = await res.json();
    const editLink = `/edit/${data.id}?token=${data.editToken}`;
    const viewLink = `/post/${data.id}`;
    if (data.status === 'published') {
      setStatus('Uploaded and published!', 'success');
    } else {
      setStatus('Upload saved as draft. Edit and publish next.', 'success');
    }
    setResult({ status: data.status, editLink, token: data.editToken, viewLink });
    form.reset();
    removeFile();
  } catch (err) {
    setStatus(err.message, 'error');
  } finally {
    uploadBtn.disabled = false;
  }
});

ensureSession();
