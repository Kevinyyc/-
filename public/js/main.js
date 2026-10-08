// 主页：创建 / 加入房间
const socket = io();

const $ = (id) => document.getElementById(id);
const nameInput = $('nameInput');
const roomInput = $('roomInput');
const createBtn = $('createBtn');
const joinBtn = $('joinBtn');
const msg = $('msg');

function setMsg(text, color) {
  msg.textContent = text;
  msg.style.color = color || '#ffb86b';
}

function getName() {
  const n = nameInput.value.trim();
  if (!n) {
    setMsg('请先输入昵称', '#ff7b6b');
    nameInput.focus();
    return null;
  }
  return n;
}

// 稳定的用户标识（不同浏览器/隐身窗口 = 不同 userId，同一浏览器 = 同一 userId）
function getOrCreateUserId() {
  let id = localStorage.getItem('doudizhu_userId');
  if (!id) {
    if (window.crypto && crypto.randomUUID) id = crypto.randomUUID();
    else id = 'u_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('doudizhu_userId', id);
  }
  return id;
}

createBtn.addEventListener('click', () => {
  const name = getName();
  if (!name) return;
  createBtn.disabled = true;
  socket.emit('create_room', { name, userId: getOrCreateUserId() }, (resp) => {
    createBtn.disabled = false;
    if (resp && resp.ok) {
      localStorage.setItem('doudizhu_name', name);
      location.href = `/room.html?room=${resp.roomId}&name=${encodeURIComponent(name)}`;
    } else {
      setMsg((resp && resp.error) || '创建失败', '#ff7b6b');
    }
  });
});

joinBtn.addEventListener('click', () => {
  const name = getName();
  if (!name) return;
  const roomId = roomInput.value.trim().toUpperCase();
  if (!roomId) {
    setMsg('请输入房间号', '#ff7b6b');
    roomInput.focus();
    return;
  }
  joinBtn.disabled = true;
  socket.emit('join_room', { roomId, name, userId: getOrCreateUserId() }, (resp) => {
    joinBtn.disabled = false;
    if (resp && resp.ok) {
      localStorage.setItem('doudizhu_name', name);
      location.href = `/room.html?room=${resp.roomId}&name=${encodeURIComponent(name)}`;
    } else {
      setMsg((resp && resp.error) || '加入失败', '#ff7b6b');
    }
  });
});

roomInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinBtn.click(); });
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') createBtn.click(); });

// 保留上次昵称
const saved = localStorage.getItem('doudizhu_name');
if (saved) nameInput.value = saved;
nameInput.addEventListener('change', () => {
  if (nameInput.value.trim()) localStorage.setItem('doudizhu_name', nameInput.value.trim());
});
