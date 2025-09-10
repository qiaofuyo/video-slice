// app.js — 现代化重构版（含中文注释）
// 要点：模块化封装、单一状态对象、事件委托、职责分离、尽量少的全局变量
(() => {
  'use strict';

  /* ============================
   状态与 DOM 缓存（单一状态对象）
   - state 保存应用的所有运行时数据，方便集中管理与序列化
   - $ 用于快速按 id 查 DOM（只做一次查询，减少重复 DOM 操作）
  ============================ */
  const state = {
    clips: [],                 // 已添加的片段（对象数组）
    selectedFiles: [],         // 已选的文件（File 对象数组）
    currentFile: null,         // 当前正在播放/加载的文件（File）
    currentObjectURL: null,    // 当前 URL.createObjectURL 的值（用于 revoke）
    mpegtsPlayer: null,        // 若使用 mpegts.js 播放器则放在此
    currentClipEndTime: null,  // 当播放片段时，保存结束秒数用于 timeupdate 检查
    tempStartTime: null,       // 临时开始时间（秒）
    tempEndTime: null,         // 临时结束时间（秒）
    rotateDeg: 0,              // 记录视频窗口当前旋转角度，0, 90, 180, 270
    isResizing: false          // 视频窗口是否在缩放
  };

  // 根据 id 获取 DOM，供后面复用
  const $ = (id) => document.getElementById(id);

  // 一次性获取所有需要的 DOM 引用，避免重复查询
  const dropZone = $('drop-zone');
  const fileInput = $('file-input');
  const fileListDiv = $('file-list');
  const videoPlayerSection = $('video-player-section');
  const videoFloatWindow = $('video-float-window');
  const dragHandle = $('drag-handle');
  const resizeHandle = document.querySelector('#video-float-window.resize-handle');
  const rotateBtn = $('rotate-btn');
  const closeFloatBtn = $('close-float-btn');
  const videoPlayer = $('video-player');
  const markStartBtn = $('mark-start-btn');
  const markEndBtn = $('mark-end-btn');
  const addClipBtn = $('add-clip-btn');
  const clipsListSection = $('clips-list-section');
  const addedClipsList = $('added-clips-list');
  const generateBtn = $('generate-btn');
  const copyBtn = $('copy-btn');
  const outputCommands = $('output-commands');
  const messageBox = $('message-box');
  const fastForwardSecondsInput = $('fast-forward-seconds');
  const fastBackwardSecondsInput = $('fast-backward-seconds');
  const longFastForwardMinutesInput = $('long-fast-forward-minutes');
  const longFastBackwardMinutesInput = $('long-fast-backward-minutes');
  const rewindBtn = $('rewind-btn');
  const forwardBtn = $('forward-btn');
  const longRewindBtn = $('long-rewind-btn');
  const longForwardBtn = $('long-forward-btn');
  const videoSourcePathInput = $('video-source-path-input');
  const outputPathInput = $('output-path-input');
  const manualStartTimeInput = $('manual-start-time');
  const manualEndTimeInput = $('manual-end-time');
  const clearAllClipsBtn = $('clear-all-clips-btn');

  /* ============================
   工具函数（pure utilities）
   - pad/formatTime: 时间格式化（秒 -> HH:MM:SS）
   - parseTime: 将任意含数字字符串转换为秒（用于输入 hhmmss 或 010203）
   - basenameNoExt / formatDateYYYYMMDD：文件名/日期相关
   - debounce：防抖，减少高频事件处理
  ============================ */
  const pad = (n) => (n < 10 ? '0' + n : String(n));
  const formatTime = (seconds) => {
    // 将秒数格式化为 hh:mm:ss 字符串
    const s = Math.floor(Number(seconds) || 0);
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
  };

  // 解析时间输入（数字字符串，如 10105 或 010105 或 1:01:05）为秒，失败返回 null
  const parseTime = (timeString) => {
    const digits = String(timeString || '').replace(/\D/g, '');
    if (!digits) return null;
    const padded = digits.padStart(6, '0').slice(-6);
    const h = parseInt(padded.slice(0, 2), 10);
    const m = parseInt(padded.slice(2, 4), 10);
    const s = parseInt(padded.slice(4, 6), 10);
    if ([h, m, s].some((v) => Number.isNaN(v))) return null;
    return h * 3600 + m * 60 + s;
  };

  // 去掉文件扩展名
  const basenameNoExt = (name = '') => name.replace(/\.[^/.]+$/, '');
  // 将毫秒或当前时间格式化为 YYYYMMDD（用于输出命名）
  const formatDateYYYYMMDD = (ms) => {
    const d = typeof ms === 'number' ? new Date(ms) : new Date();
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  };

  // 简单防抖
  const debounce = (fn, delay = 150) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), delay);
    };
  };

  // 页面短暂提示（非阻塞），自动淡出
  const showMessage = (text) => {
    if (!messageBox) return;
    messageBox.textContent = text;
    messageBox.classList.remove('opacity-0');
    messageBox.classList.add('opacity-100');
    clearTimeout(showMessage._timer);
    showMessage._timer = setTimeout(() => {
      messageBox.classList.remove('opacity-100');
      messageBox.classList.add('opacity-0');
    }, 2500);
  };

  /* ============================
   Object URL 与播放器清理
   - setVideoObjectURL：创建并记录 objectURL（并 revoke 旧的）
   - cleanupPlayer：销毁 mpegts 播放器、撤销 objectURL、重置 video src
  ============================ */
  const setVideoObjectURL = (blobOrFile) => {
    if (state.currentObjectURL) {
      try { URL.revokeObjectURL(state.currentObjectURL); } catch (e) { }
      state.currentObjectURL = null;
    }
    const url = URL.createObjectURL(blobOrFile);  // 视频播不经服务端
    // const url = `/videos/快手直播/荔枝甜心/${encodeURIComponent(blobOrFile.name)}`;  // 视频播放经由服务端
    state.currentObjectURL = url;
    return url;
  };

  const cleanupPlayer = () => {
    if (state.mpegtsPlayer) {
      try { state.mpegtsPlayer.destroy(); } catch (e) { }
      state.mpegtsPlayer = null;
    }
    if (state.currentObjectURL) {
      try { URL.revokeObjectURL(state.currentObjectURL); } catch (e) { }
      state.currentObjectURL = null;
    }
    try {
      videoPlayer.removeAttribute('src');
      videoPlayer.load();
    } catch (e) { /* 忽略加载错误 */ }
    state.currentFile = null;
    state.currentClipEndTime = null;
    renderFileList(); // 更新文件列表高亮状态
  };

  /* ============================
   文件加载（兼容原生播放与 mpegts.js）
   - 根据文件扩展名选择播放方式（mp4 用原生，flv/ts/m2ts 在可用时用 mpegts.js）
  ============================ */
  const canUseMpegts = typeof window.mpegts !== 'undefined' && typeof window.mpegts.getFeatureList === 'function';

  // loadFile：加载 File 到 video 元素或 mpegts 播放器，callbackOnReady 在 metadata 可用时触发
  const loadFile = (file, callbackOnReady) => {
    if (!file) return;
    cleanupPlayer();
    state.currentFile = file;
    renderFileList();
    const ext = (file.name.split('.').pop() || '').toLowerCase();

    // 显示悬浮窗播放器
    videoFloatWindow.classList.remove('hidden');

    // 原生播放的设置逻辑（适用于 mp4 / 本地文件）
    const setupNative = (blobFile) => {
      const url = setVideoObjectURL(blobFile);
      videoPlayer.src = url;
      videoPlayer.addEventListener('loadedmetadata', function once() {
        videoPlayer.removeEventListener('loadedmetadata', once);
        if (typeof callbackOnReady === 'function') callbackOnReady();
      }, { once: true });
    };

    // 若支持 mpegts 且文件扩展名是 flv/ts/m2ts，尝试用 mpegts.js
    if (canUseMpegts && ['flv', 'ts', 'm2ts'].includes(ext)) {
      const url = setVideoObjectURL(file);
      const type = ext === 'flv' ? 'flv' : (ext === 'm2ts' ? 'm2ts' : 'mpegts');
      try {
        state.mpegtsPlayer = mpegts.createPlayer({
          type,
          isLive: false,
          filesize: file.size,
          url
        }, {
          enableWorker: true,
          enableStashBuffer: true,
          stashInitialSize: 384 * 1024 * 10,
          lazyLoad: true,
          lazyLoadMaxDuration: 10 * 60,
          lazyLoadRecoverDuration: 3 * 60,
          autoCleanupSourceBuffer: true,
          autoCleanupMinBackwardDuration: 2 * 60,
          autoCleanupMaxBackwardDuration: 5 * 60
        });
        state.mpegtsPlayer.attachMediaElement(videoPlayer);
        state.mpegtsPlayer.load();
        videoPlayer.addEventListener('loadedmetadata', function once() {
          videoPlayer.removeEventListener('loadedmetadata', once);
          if (typeof callbackOnReady === 'function') callbackOnReady();
        }, { once: true });
      } catch (e) {
        // 若 mpegts 创建失败则回退到原生播放
        console.warn('mpegts createPlayer failed, fallback to native', e);
        setupNative(file);
      }
    } else {
      // 非 mpegts 格式或不支持 mpegts 时直接用原生播放
      setupNative(file);
    }
  };

  /* ============================
   渲染函数（将状态渲染到 DOM）
   - renderFileList：显示已选择文件并生成播放/删除按钮（使用事件委托处理点击）
   - renderClipsList：显示已添加的片段列表，包含重命名与删除等操作输入
  ============================ */
  const renderFileList = () => {
    fileListDiv.innerHTML = '';
    if (state.selectedFiles.length === 0) {
      videoPlayerSection.classList.add('hidden');
      return;
    }
    videoPlayerSection.classList.remove('hidden');

    state.selectedFiles.forEach((file, idx) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'file-item flex items-center justify-between p-2 bg-gray-100 rounded-lg border border-gray-200';
      const isPlaying = state.currentFile && file.name === state.currentFile.name && file.size === state.currentFile.size;
      if (isPlaying) wrapper.classList.add('playing');

      wrapper.innerHTML = `
        <span class="file-name font-semibold text-gray-800 break-words">${file.name}</span>
        <div class="flex gap-2">
          <button class="play-file-btn bg-blue-500 text-white py-1 px-3 rounded-lg text-sm" data-index="${idx}">播放</button>
          <button class="delete-file-btn bg-red-400 text-white py-1 px-3 rounded-lg text-sm" data-index="${idx}">删除</button>
        </div>
      `;
      fileListDiv.appendChild(wrapper);
    });
  };

  const renderClipsList = () => {
    addedClipsList.innerHTML = '';
    if (!Array.isArray(state.clips) || state.clips.length === 0) {
      clipsListSection.classList.add('hidden');
      return;
    }
    clipsListSection.classList.remove('hidden');

    state.clips.forEach((clip, i) => {
      const item = document.createElement('div');
      item.className = 'clip-item flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200';
      item.innerHTML = `
        <div class="flex flex-col md:flex-row md:items-center md:space-x-4">
          <span class="text-sm font-bold">${clip.fileName}</span>
          <span class="text-sm text-gray-600">${clip.startTime} - ${clip.endTime}</span>
          <div class="flex items-center gap-2">
            <label class="text-xs">输出名称:</label>
            <input class="output-name" data-index="${i}" value="${clip.clipName}" style="width:220px;padding:4px;border:1px solid #ddd;border-radius:4px;">
            <span>.</span>
            <input class="output-ext" data-index="${i}" value="${clip.ext}" style="width:60px;padding:4px;border:1px solid #ddd;border-radius:4px;">
          </div>
        </div>
        <div class="flex gap-2">
          <button class="play-clip-btn bg-purple-500 text-white py-1 px-2 rounded text-xs" data-index="${i}">播放片段</button>
          <button class="delete-clip-btn bg-red-400 text-white py-1 px-2 rounded text-xs" data-index="${i}">删除</button>
        </div>
      `;
      addedClipsList.appendChild(item);
    });
  };

  /* ============================
   文件输入与拖拽处理（一次添加多个文件）
   - handleFiles：过滤已存在文件并加入 state.selectedFiles
   - 绑定 file input change、dragover/dragleave/drop 事件（使用事件委托思想）
  ============================ */
  const handleFiles = (fileList) => {
    if (!fileList || fileList.length === 0) return;
    const arr = Array.from(fileList);
    // 去重：按 name + size 判断（简单可靠）
    const newFiles = arr.filter(f => !state.selectedFiles.some(sf => sf.name === f.name && sf.size === f.size));
    if (newFiles.length === 0) {
      showMessage('未添加新文件。');
      return;
    }
    state.selectedFiles.push(...newFiles);
    renderFileList();
    showMessage(`已添加 ${newFiles.length} 个文件。`);
  };

  // 文件选择器变化
  fileInput.addEventListener('change', (e) => handleFiles(e.target.files));
  // 拖拽区域交互
  if (dropZone) {
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => { e.preventDefault(); dropZone.classList.remove('drag-over'); handleFiles(e.dataTransfer.files); });
  }

  /* ============================
   播放相关辅助（播放选中文件、停止并隐藏播放器）
  ============================ */
  const playSelectedFile = (file) => {
    if (!file) return;
    const stateLoaded = loadPlayerState();
    loadFile(file, () => {
      if (!stateLoaded) setInitialVideoSizeAndCenter(videoPlayer.videoWidth, videoPlayer.videoHeight);
      showMessage(`正在播放: ${state.currentFile.name}`);
      videoPlayer.play().catch(() => { });
    });
  };

  // 旋转视频窗口
  const rotateVideo = () => {
    if (!videoPlayer || !videoPlayer.src) {
      showMessage('请先播放一个视频');
      return;
    }
    // 每次点击旋转90度
    state.rotateDeg += 90;
    videoFloatWindow.style.transform = `rotate(${state.rotateDeg}deg)`;
    
    centerVideoWindow();
    savePlayerState();
    showMessage(`视频已旋转 90 度`);
  };

  const stopAndHidePlayer = () => {
    videoFloatWindow.classList.add('hidden');
    try { videoPlayer.pause(); } catch (e) { }
    try { videoPlayer.currentTime = 0; } catch (e) { }
    savePlayerState();
    cleanupPlayer();
  };

  /* ============================
   播放器状态持久化（窗口尺寸/位置） - sessionStorage
   - loadPlayerState：尝试恢复位置与尺寸，返回是否成功
   - savePlayerState：保存当前窗口位置与尺寸
  ============================ */
  const loadPlayerState = () => {
    try {
      const raw = sessionStorage.getItem('videoPlayerState');
      if (!raw) return false;
      const s = JSON.parse(raw);
      videoFloatWindow.style.width = s.width || '';
      videoFloatWindow.style.height = s.height || '';
      videoFloatWindow.style.left = s.left || '';
      videoFloatWindow.style.top = s.top || '';
      return true;
    } catch (e) { return false; }
  };

  const savePlayerState = () => {
    try {
      const s = {
        width: videoFloatWindow.style.width,
        height: videoFloatWindow.style.height,
        left: videoFloatWindow.style.left,
        top: videoFloatWindow.style.top
      };
      sessionStorage.setItem('videoPlayerState', JSON.stringify(s));
    } catch (e) { /* 忽略持久化错误 */ }
  };

  // 首次打开时设置播放器尺寸并居中（基于视频宽高）
  const setInitialVideoSizeAndCenter = (videoWidth, videoHeight) => {
    if (!videoWidth || !videoHeight) return;
    const aspect = videoWidth / videoHeight;
    const maxW = window.innerWidth;
    const maxH = window.innerHeight;
    let w = videoWidth, h = videoHeight;
    if (w > maxW) { w = maxW; h = w / aspect; }
    if (h > maxH) { h = maxH; w = h * aspect; }
    videoFloatWindow.style.width = `${w}px`;
    videoFloatWindow.style.height = `${h}px`;
    centerVideoWindow();
    savePlayerState();
  };

  // 将悬浮播放器居中（窗口尺寸改变时使用）
  const centerVideoWindow = () => {
    if (videoFloatWindow.classList.contains('hidden')) return;
    const ww = window.innerWidth, wh = window.innerHeight;
    const ew = videoFloatWindow.offsetWidth, eh = videoFloatWindow.offsetHeight;
    videoFloatWindow.style.left = `${Math.round((ww - ew) / 2)}px`;
    videoFloatWindow.style.top = `${Math.round((wh - eh) / 2)}px`;
  };

  window.addEventListener('resize', debounce(centerVideoWindow, 150));

  /* ============================
   标记与添加剪辑
   - markStartBtn / markEndBtn：将当前播放时间标记到输入框（同时记录到 state）
   - addClipBtn：基于手动/标记时间生成片段对象并插入 state.clips
   - 输出文件名生成使用规则：主机名/文件名第一段 + 文件修改日期 + 顺序索引
  ============================ */
  markStartBtn && markStartBtn.addEventListener('click', () => {
    if (!state.currentFile && !videoPlayer.src) { showMessage('请先选择并播放视频'); return; }
    state.tempStartTime = videoPlayer.currentTime;
    manualStartTimeInput.value = formatTime(state.tempStartTime).replace(/:/g, '');
    showMessage('已标记开始时间');
  });

  markEndBtn && markEndBtn.addEventListener('click', () => {
    if (!state.currentFile && !videoPlayer.src) { showMessage('请先选择并播放视频'); return; }
    state.tempEndTime = videoPlayer.currentTime;
    manualEndTimeInput.value = formatTime(state.tempEndTime).replace(/:/g, '');
    showMessage('已标记结束时间');
  });

  // 获取同一 host + 日期下下一个索引（用于命名中的序号）
  const getNextIndexForHostDate = (outputHost, fileDate) => {
    let sameCount = 0;
    state.clips.forEach(c => { if (c && c.outputHost === outputHost && c.fileDate === fileDate) sameCount++; });
    return sameCount + 1;
  };

  addClipBtn && addClipBtn.addEventListener('click', () => {
    if (!state.currentFile) { showMessage('请先选择视频文件'); return; }
    const startSec = parseTime(manualStartTimeInput.value);
    const endSec = parseTime(manualEndTimeInput.value);
    if (startSec === null || endSec === null) { showMessage('请先标记或输入开始/结束时间'); return; }
    if (startSec >= endSec) { showMessage('结束时间必须晚于开始时间'); return; }

    // 尝试从 UI 获取 hostNameInput（如果存在），否则从文件名中取第一段
    let outputHost = 'unknown';
    try {
      const hostInputEl = document.getElementById('hostNameInput');
      if (hostInputEl && hostInputEl.value.trim() !== '') {
        outputHost = hostInputEl.value.trim().replace(/[\/\\:\*\?"<>\|]/g, '_'); // 过滤文件名非法字符
      } else {
        const base = basenameNoExt(state.currentFile.name);
        outputHost = (base.split('_')[0] || base).replace(/[\/\\:\*\?"<>\|]/g, '_');
      }
    } catch (e) { outputHost = 'unknown'; }

    const fileDate = (state.currentFile && state.currentFile.lastModified) ? formatDateYYYYMMDD(state.currentFile.lastModified) : formatDateYYYYMMDD(Date.now());
    const idx = getNextIndexForHostDate(outputHost, fileDate);
    const ext = 'mp4'; // 默认输出格式
    const clipName = `${outputHost}_${fileDate}_${idx}`;
    const outputFileName = `${clipName}.${ext}`;

    // 将片段对象入 state.clips
    state.clips.push({
      fileName: state.currentFile.name,
      startTime: formatTime(startSec),
      endTime: formatTime(endSec),
      outputHost,
      fileDate,
      idx,
      clipName,
      ext,
      outputFileName,
      originalFileSize: state.currentFile.size,
      originalFileLastModified: state.currentFile.lastModified || null
    });

    // 清空临时标记并更新界面
    state.tempStartTime = state.tempEndTime = null;
    manualStartTimeInput.value = '';
    manualEndTimeInput.value = '';
    outputCommands.value = '';
    renderClipsList();
    showMessage(`已添加片段：${state.currentFile.name} (${formatTime(startSec)} - ${formatTime(endSec)})`);
  });

  /* ============================
   事件委托：文件列表（播放 / 删除）
   - 通过监听父容器的 click 事件来处理多个按钮，避免为每个按钮都注册事件
  ============================ */
  fileListDiv && fileListDiv.addEventListener('click', (e) => {
    const playBtn = e.target.closest('.play-file-btn');
    const delBtn = e.target.closest('.delete-file-btn');
    if (playBtn) {
      const idx = Number(playBtn.dataset.index);
      const file = state.selectedFiles[idx];
      if (file) playSelectedFile(file);
      return;
    }
    if (delBtn) {
      const idx = Number(delBtn.dataset.index);
      const f = state.selectedFiles[idx];
      if (!f) return;
      state.selectedFiles.splice(idx, 1);
      // 如果删的是当前播放的文件则停止播放器
      if (state.currentFile && state.currentFile.name === f.name && state.currentObjectURL) {
        stopAndHidePlayer();
      }
      showMessage(`已删除文件: ${f.name}（相关剪辑片段保留）`);
      renderFileList();
      renderClipsList();
    }
  });

  /* ============================
   事件委托：片段列表（播放片段 / 删除 / 重命名）
   - 点击事件 -> 播放 / 删除
   - input 事件 -> 更新片段名或扩展名并同步 state（立即生效）
  ============================ */
  addedClipsList && addedClipsList.addEventListener('click', (e) => {
    const playBtn = e.target.closest('.play-clip-btn');
    const delBtn = e.target.closest('.delete-clip-btn');

    if (playBtn) {
      const idx = Number(playBtn.dataset.index);
      const clip = state.clips[idx];
      const originalFile = state.selectedFiles.find(f => f.name === clip.fileName && f.size === clip.originalFileSize);
      if (!originalFile) { showMessage(`错误：找不到原始文件 ${clip.fileName}`); return; }

      // 如果当前已加载同一文件则直接播放片段，否则先加载文件再播放片段
      if (state.currentFile && state.currentFile.name === originalFile.name && state.currentFile.size === originalFile.size && state.currentObjectURL && videoPlayer.src === state.currentObjectURL) {
        playClipRange(clip);
      } else {
        loadFile(originalFile, () => playClipRange(clip));
      }
      return;
    }

    if (delBtn) {
      const idx = Number(delBtn.dataset.index);
      const removed = state.clips.splice(idx, 1)[0];
      // 删除后对同一 host+date 的后续片段重新编号（保持序号连续）
      for (let i = idx; i < state.clips.length; i++) {
        const c = state.clips[i];
        if (c.outputHost === removed.outputHost && c.fileDate === removed.fileDate) {
          c.idx = c.idx - 1;
          c.clipName = `${c.outputHost}_${c.fileDate}_${c.idx}`;
          c.outputFileName = `${c.clipName}.${c.ext}`;
        }
      }
      renderClipsList();
      showMessage('已删除片段');
      outputCommands.value = '';
    }
  });

  // 对片段列表的输入（文件名与扩展）使用 input 事件同步 state（事件委托）
  addedClipsList && addedClipsList.addEventListener('input', (e) => {
    const nameInp = e.target.closest('.output-name');
    const extInp = e.target.closest('.output-ext');
    if (nameInp) {
      const idx = Number(nameInp.dataset.index);
      if (!Number.isNaN(idx) && state.clips[idx]) {
        const ext = state.clips[idx].ext || state.clips[idx].outputFileName.split('.').pop();
        state.clips[idx].clipName = nameInp.value;
        state.clips[idx].outputFileName = `${nameInp.value}.${ext}`;
      }
    }
    if (extInp) {
      const idx = Number(extInp.dataset.index);
      if (!Number.isNaN(idx) && state.clips[idx]) {
        const base = state.clips[idx].outputFileName.replace(/\.[^/.]+$/, '');
        state.clips[idx].ext = extInp.value;
        state.clips[idx].outputFileName = `${base}.${extInp.value}`;
      }
    }
    outputCommands.value = '';
  });

  /* ============================
   播放片段范围与 timeupdate 停止逻辑
   - playClipRange：将 currentTime 跳到片段开始并记录结束秒数
   - timeupdate：当达到结束秒数时暂停并定位到结束
  ============================ */
  const playClipRange = (clip) => {
    state.currentClipEndTime = parseTime(clip.endTime);
    videoPlayer.currentTime = parseTime(clip.startTime);
    videoPlayer.play().catch(() => { });
    showMessage(`正在播放片段: ${clip.fileName} (${clip.startTime} - ${clip.endTime})`);
  };

  videoPlayer.addEventListener('timeupdate', () => {
    if (state.currentClipEndTime !== null && videoPlayer.currentTime >= state.currentClipEndTime) {
      videoPlayer.pause();
      videoPlayer.currentTime = state.currentClipEndTime;
      state.currentClipEndTime = null;
      showMessage('片段播放结束');
    }
  });

  /* ============================
   生成 FFmpeg 指令 & 复制到剪贴板
   - generateBtn：将 state.clips 转换为一组 ffmpeg 命令（按用户指定的源目录/输出目录）
   - copyBtn：尝试使用 navigator.clipboard，失败回退 document.execCommand
  ============================ */
  generateBtn && generateBtn.addEventListener('click', () => {
    if (state.clips.length === 0) { outputCommands.value = '没有任何剪辑片段。'; showMessage('请先添加片段'); return; }
    const srcDir = videoSourcePathInput.value.trim();
    const outDir = outputPathInput.value.trim();
    if (!srcDir) { outputCommands.value = '请先输入视频文件所在目录。'; showMessage('请输入视频文件目录'); return; }
    if (!outDir) { outputCommands.value = '请先输入输出目录。'; showMessage('请输入输出目录'); return; }

    // 将斜杠替换为 Windows 风格反斜杠，便于直接粘贴到 Windows cmd（如果需要 Linux 可自行修改）
    const inDir = srcDir.replace(/\//g, '\\');
    const oDir = outDir.replace(/\//g, '\\');

    const cmds = state.clips.map(clip => {
      const inputPath = `${inDir}\\${clip.fileName}`;
      const outputPath = `${oDir}\\${clip.outputFileName}`;
      // -ss -to 参数用来指定开始和结束时间，-c copy 保持流拷贝（快速、无转码）
      return `ffmpeg -loglevel quiet -ss "${clip.startTime}" -to "${clip.endTime}" -i "${inputPath}" -c copy "${outputPath}"`;
    }).join('\n');

    outputCommands.value = cmds;
  });

  copyBtn && copyBtn.addEventListener('click', async () => {
    const txt = outputCommands.value || '';
    if (!txt) { showMessage('没有可复制的指令'); return; }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(txt);
        showMessage('已复制到剪贴板');
      } else {
        // 后备：老浏览器复制方案
        outputCommands.select();
        if (document.execCommand && document.execCommand('copy')) {
          showMessage('已复制到剪贴板');
        } else {
          showMessage('复制失败，请手动复制');
        }
        window.getSelection().removeAllRanges();
      }
    } catch (e) {
      showMessage('复制失败，请手动复制');
    }
  });

  /* ============================
   快进 / 快退 与 跳转（寻址）
   - seekVideo：相对跳转当前时间，自动限制边界（0 ~ duration）
   - 绑定按钮及键盘快捷键（Space 播放/暂停，左右方向键跳转）
  ============================ */
  const seekVideo = (seconds) => {
    if (!videoPlayer.src || isNaN(videoPlayer.duration)) { showMessage('请先播放一个视频'); return; }
    const newTime = videoPlayer.currentTime + seconds;
    videoPlayer.currentTime = Math.max(0, Math.min(newTime, videoPlayer.duration));
    const direction = seconds > 0 ? '前进' : '后退';
    const unit = Math.abs(seconds) >= 60 ? '分钟' : '秒';
    const amount = Math.abs(seconds) >= 60 ? Math.abs(seconds) / 60 : Math.abs(seconds);
    showMessage(`${direction} ${amount} ${unit}`);
  };

  forwardBtn && forwardBtn.addEventListener('click', () => {
    const seconds = parseFloat(fastForwardSecondsInput.value) || 15;
    seekVideo(seconds);
  });
  rewindBtn && rewindBtn.addEventListener('click', () => {
    const seconds = parseFloat(fastBackwardSecondsInput.value) || 5;
    seekVideo(-seconds);
  });
  longForwardBtn && longForwardBtn.addEventListener('click', () => {
    const minutes = parseFloat(longFastForwardMinutesInput.value) || 2;
    seekVideo(minutes * 60);
  });
  longRewindBtn && longRewindBtn.addEventListener('click', () => {
    const minutes = parseFloat(longFastBackwardMinutesInput.value) || 2;
    seekVideo(-minutes * 60);
  });

  /* ============================
   全局键盘快捷键（在非输入框聚焦时生效）
   - Space：播放 / 暂停
   - ArrowLeft / ArrowRight：小步跳转（Ctrl + 箭头 -> 长跳转）
   - ArrowUp / ArrowDown：快捷标记开始/结束时间
   - Escape：关闭播放器
  ============================ */
  document.addEventListener('keydown', (e) => {
    // 若焦点在 input/textarea 中则忽略快捷键（避免影响用户输入）
    if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

    // ESC 关闭悬浮播放器
    if (e.key === 'Escape' && !videoFloatWindow.classList.contains('hidden')) { stopAndHidePlayer(); return; }
    if (!videoPlayer.src) return;

    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault();
      if (videoPlayer.paused) { videoPlayer.play(); showMessage('播放'); }
      else { videoPlayer.pause(); showMessage('暂停'); }
      return;
    }

    const ffSec = parseFloat(fastForwardSecondsInput.value) || 15;
    const fbSec = parseFloat(fastBackwardSecondsInput.value) || 5;
    const longFfMin = parseFloat(longFastForwardMinutesInput.value) || 2;
    const longFbMin = parseFloat(longFastBackwardMinutesInput.value) || 2;

    if (e.ctrlKey) {
      if (e.key === 'ArrowRight') { e.preventDefault(); seekVideo(longFfMin * 60); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); seekVideo(-longFbMin * 60); }
    } else {
      if (e.key === 'ArrowRight') { e.preventDefault(); seekVideo(ffSec); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); seekVideo(-fbSec); }
    }

    if (e.key === 'ArrowUp') { e.preventDefault(); markStartBtn && markStartBtn.click(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); markEndBtn && markEndBtn.click(); }
  });

  /* ============================
   悬浮窗口拖拽与缩放交互（startInteraction 提供统一的拖动生命周期）
   - startInteraction：开始交互，返回 cleanup 回调
   - dragHandle：鼠标按下拖动窗口
   - resizeHandle：鼠标按下横向拖动调整大小（保持长宽比）
   - 保存位置/尺寸到 sessionStorage（savePlayerState）
  ============================ */
  const startInteraction = (opts = {}) => {
    if (videoFloatWindow.dataset.interacting === '1') return null;
    videoFloatWindow.dataset.interacting = '1';
    document.body.style.userSelect = 'none';
    const onMove = typeof opts.onMove === 'function' ? opts.onMove : () => { };
    const moveHandler = (ev) => onMove(ev);
    const upHandler = () => cleanup();
    function cleanup() {
      state.isResizing = false;
      window.removeEventListener('mousemove', moveHandler);
      window.removeEventListener('mouseup', upHandler);
      window.removeEventListener('blur', upHandler);
      document.body.style.userSelect = '';
      videoFloatWindow.dataset.interacting = '0';
      savePlayerState();
    }
    window.addEventListener('mousemove', moveHandler);
    window.addEventListener('mouseup', upHandler);
    window.addEventListener('blur', upHandler);
    return cleanup;
  };

  // 拖动句柄：移动悬浮窗口
  dragHandle && dragHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (e.button !== 0) return; // 只响应鼠标左键

    // 获取视频浮动窗口的初始位置和尺寸。
    // getBoundingClientRect() 返回一个 DOMRect 对象，它提供了元素相对于视口的大小和位置。
    const rect = videoFloatWindow.getBoundingClientRect();

    // initLeft：窗口在按下鼠标瞬间，其左边缘距离视口左边缘的距离（px）。
    // initTop：窗口在按下鼠标瞬间，其上边缘距离视口上边缘的距离（px）。
    // width：窗口旋转后的宽度（px）。
    // height：窗口旋转后的高度（px）。
    let { left: initLeft, top: initTop, width, height } = rect;

    // 记录鼠标按下瞬间的初始全局坐标。
    // clientX：鼠标指针相对于浏览器视口（viewport）的水平坐标。
    // clientY：鼠标指针相对于浏览器视口（viewport）的垂直坐标。
    const startX = e.clientX, startY = e.clientY;

    // 调用 startInteraction 函数开始拖拽交互。
    // 该函数会添加全局的 mousemove 和 mouseup 监听器，并在交互结束时自动清理。
    const cleanup = startInteraction({
      // onMove：当鼠标移动时执行的回调函数。
      onMove: (ev) => {
        // 计算鼠标在移动过程中的总水平和垂直位移。
        // dx (delta x)：鼠标从按下瞬间到当前位置的水平移动距离。
        // dy (delta y)：鼠标从按下瞬间到当前位置的垂直移动距离。
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;

        let newLeft, newTop;
        newLeft = initLeft + dx;
        newTop = initTop + dy;

        // 边界限制：确保窗口不会拖出浏览器视口。
        // window.innerWidth：浏览器视口的当前宽度。
        // window.innerHeight：浏览器视口的当前高度。
        const maxLeft = Math.max(0, window.innerWidth - width);  // 右边壁
        const maxTop = Math.max(0, window.innerHeight - height);  // 底边壁
        newLeft = Math.max(0, Math.min(newLeft, maxLeft));  // 0 <= newLeft <= 右边壁
        newTop = Math.max(0, Math.min(newTop, maxTop));  // 0 <= newTop <= 底边壁

        // 更新元素的 style.left 和 style.top 属性来移动窗口。
        // 这里更新的是元素在未旋转时的 DOM 布局位置，所以需要进行偏移。
        if ([90, -90, 270, -270].includes(state.rotateDeg % 360)) {
          const offsetLeft = (videoFloatWindow.offsetHeight - videoFloatWindow.offsetWidth) / 2;
          newLeft += offsetLeft;
          newTop -= offsetLeft;
        }
        videoFloatWindow.style.left = `${Math.round(newLeft)}px`;
        videoFloatWindow.style.top = `${Math.round(newTop)}px`;
      }
    });
    if (!cleanup) return;
  });

  // 缩放句柄：水平拖动改变宽度，并按视频长宽比计算高度
  resizeHandle && resizeHandle.addEventListener('mousedown', (e) => {
    const direction = getBorderDirection(e);
    if (!direction) return;  // 鼠标不在边框上，不进行拖拽

    e.preventDefault();
    if (e.button !== 0) return;

    state.isResizing = true;

    const startX = e.clientX;
    const rect = videoFloatWindow.getBoundingClientRect();
    const { width: initW, height: initH, left: left0, top: top0 } = rect;
    const aspect = (videoPlayer && videoPlayer.videoWidth && videoPlayer.videoHeight) ? (videoPlayer.videoWidth / videoPlayer.videoHeight) : (initW / initH);
    const minSize = 200;
    const cleanup = startInteraction({
      onMove: (ev) => {
        if (!state.isResizing) return;

        const dx = ev.clientX - startX;

        let newW = Math.max(minSize, initW + dx);
        let newH = newW / aspect;

        const maxW = Math.max(0, window.innerWidth - left0);
        const maxH = Math.max(0, window.innerHeight - top0);
        if (newW > maxW) { newW = maxW; newH = newW / aspect; }
        if (newH > maxH) { newH = maxH; newW = newH * aspect; if (newW < minSize) { newW = minSize; newH = newW / aspect; } }
        if (newH < minSize) { newH = minSize; newW = newH * aspect; }
        videoFloatWindow.style.width = `${Math.round(newW)}px`;
        videoFloatWindow.style.height = `${Math.round(newH)}px`;
      }
    });
    if (!cleanup) return;
  });

  /**
   * 判断鼠标是否在边框上
   * @param {MouseEvent} e - 鼠标事件对象
   * @param {getBoundingClientRect} rect - 相对于视口的坐标位置
   * @returns {string} - 鼠标所在的边框方向，如果不在则返回 null
   */
  function getBorderDirection(e) {
    const borderSize = window.getComputedStyle(resizeHandle).borderWidth.split('px');
    const rect = resizeHandle.getBoundingClientRect();
    const atTop = e.clientY - rect.top < borderSize;
    const atBottom = rect.bottom - e.clientY < borderSize;
    const atLeft = e.clientX - rect.left < borderSize;
    const atRight = rect.right - e.clientX < borderSize;

    if (atTop && atLeft) return 'top-left';
    if (atTop && atRight) return 'top-right';
    if (atBottom && atLeft) return 'bottom-left';
    if (atBottom && atRight) return 'bottom-right';
    if (atTop) return 'top';
    if (atBottom) return 'bottom';
    if (atLeft) return 'left';
    if (atRight) return 'right';

    return null;
  }

  // 监听鼠标在 div 上的移动，改变光标样式
  resizeHandle && resizeHandle.addEventListener('onpointerover', (e) => {
    if (state.isResizing) return;

    const direction = getBorderDirection(e);
    // 移除光标样式类
    resizeHandle.classList.remove(`resizing-${direction}`);
    if (direction) {
      resizableDiv.classList.add(`resizing-${direction}`);
    }
  });

  // 为旋转按钮绑定事件监听器
  rotateBtn && rotateBtn.addEventListener('click', rotateVideo);

  // 关闭按钮：停止并隐藏播放器
  closeFloatBtn && closeFloatBtn.addEventListener('click', stopAndHidePlayer);

  /* ============================
   清空所有片段（UI 操作）
  ============================ */
  clearAllClipsBtn && clearAllClipsBtn.addEventListener('click', () => {
    state.clips = [];
    renderClipsList();
    showMessage('已清除所有片段');
  });

  /* ============================
   初始化函数：渲染初始界面、居中播放器
  ============================ */
  const init = () => {
    renderFileList();
    renderClipsList();
    centerVideoWindow();
  };

  // 不暴露任何全局变量（IIFE）
  init();

})(); // IIFE end
