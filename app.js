/******************************************************************
 * 全局状态与 DOM 引用（必要变量，去掉未使用项）
 ******************************************************************/
let clips = [];                  // 存储添加的剪辑片段对象
let selectedFiles = [];          // 存储已选择的 File 对象列表
let currentFile = null;          // 当前正在播放的文件对象
let currentObjectURL = null;     // 当前为 video 创建的 object URL（便于 revoke）
let mpegtsPlayer = null;         // mpegts.js 的实例（若使用 .flv/.ts/.mp4）
let currentClipEndTime = null;   // 播放片段时的结束时间（秒）
let tempStartTime = null;        // 临时保存标记的开始时间（秒）
let tempEndTime = null;          // 临时保存标记的结束时间（秒）

// DOM 引用
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const fileListDiv = document.getElementById('file-list');
const videoPlayerSection = document.getElementById('video-player-section');
const videoFloatWindow = document.getElementById('video-float-window');
const dragHandle = document.getElementById('drag-handle');
const resizeHandle = document.getElementById('resize-handle');
const closeFloatBtn = document.getElementById('close-float-btn');
const videoPlayer = document.getElementById('video-player');

const markStartBtn = document.getElementById('mark-start-btn');
const markEndBtn = document.getElementById('mark-end-btn');
const addClipBtn = document.getElementById('add-clip-btn');
const clipsListSection = document.getElementById('clips-list-section');
const addedClipsList = document.getElementById('added-clips-list');
const generateBtn = document.getElementById('generate-btn');
const copyBtn = document.getElementById('copy-btn');
const outputCommands = document.getElementById('output-commands');
const messageBox = document.getElementById('message-box');

const fastForwardSecondsInput = document.getElementById('fast-forward-seconds');
const fastBackwardSecondsInput = document.getElementById('fast-backward-seconds');
const longFastForwardMinutesInput = document.getElementById('long-fast-forward-minutes');
const longFastBackwardMinutesInput = document.getElementById('long-fast-backward-minutes');

// 新增：快进快退按钮引用
const rewindBtn = document.getElementById('rewind-btn');
const forwardBtn = document.getElementById('forward-btn');
const longRewindBtn = document.getElementById('long-rewind-btn');
const longForwardBtn = document.getElementById('long-forward-btn');

const videoSourcePathInput = document.getElementById('video-source-path-input');
const outputPathInput = document.getElementById('output-path-input');

const manualStartTimeInput = document.getElementById('manual-start-time');
const manualEndTimeInput = document.getElementById('manual-end-time');

// 新增：清除所有片段按钮引用
const clearAllClipsBtn = document.getElementById('clear-all-clips-btn');

/******************************************************************
 * 时间格式化与解析辅助函数
 ******************************************************************/
// 秒 -> "HH:MM:SS"
function formatTime(seconds) {
  const date = new Date(null);
  date.setSeconds(Math.floor(seconds));
  return date.toISOString().substr(11, 8);
}

// 支持 "hhmmss"（或带非数字字符）的解析，返回秒或 null
function parseTime(timeString) {
  const s = (timeString || '').replace(/\D/g, '');
  if (!s) return null;
  // 最多取 6 位（hhmmss）
  const padded = s.padStart(6, '0');
  const h = parseInt(padded.slice(-6, -4), 10);
  const m = parseInt(padded.slice(-4, -2), 10);
  const sec = parseInt(padded.slice(-2), 10);
  return h * 3600 + m * 60 + sec;
}

// 2) 新增：添加片段命名所需辅助函数
function basenameNoExt(name){ return (name || '').replace(/\.[^/.]+$/, ''); }
function pad(n){ return n<10? '0'+n : ''+n; }
function formatDateYYYYMMDD(ms){ var d = (typeof ms === 'number') ? new Date(ms) : new Date(ms); return ''+d.getFullYear()+pad(d.getMonth()+1)+pad(d.getDate()); }

/******************************************************************
 * 辅助：安全创建并管理 Object URL
 ******************************************************************/
function setVideoObjectURL(blobOrFile) {
  if (currentObjectURL) {
    URL.revokeObjectURL(currentObjectURL);
    currentObjectURL = null;
  }
  const url = URL.createObjectURL(blobOrFile);
  currentObjectURL = url;
  return url;
}

/******************************************************************
 * 公共：清理 player（抽出公共逻辑）
 ******************************************************************/
function cleanupPlayer() {
  // 销毁 mpegtsPlayer（如果存在）
  if (mpegtsPlayer) {
    try { mpegtsPlayer.destroy(); } catch (e) { /* ignore */ }
    mpegtsPlayer = null;
  }
  // 撤销 object URL
  if (currentObjectURL) {
    try { URL.revokeObjectURL(currentObjectURL); } catch (e) {}
    currentObjectURL = null;
  }
  // 清空 video src 并重置状态
  try { videoPlayer.removeAttribute('src'); videoPlayer.load(); } catch (e) {}
  currentFile = null;
  currentClipEndTime = null;
  renderFileList(); // 更新：移除高亮
}

/******************************************************************
 * 公共：加载 file（抽成函数，统一处理 mpegts.js / 原生）
 * callback 在媒体可播放时被调用（用于开始播放或设置大小）
 ******************************************************************/
function loadFile(file, callbackOnReady) {
  if (!file) return;
  // 先统一清理旧资源
  cleanupPlayer();
  currentFile = file;
  renderFileList(); // 更新：设置高亮
  const ext = file.name.split('.').pop().toLowerCase();

  // 显示浮窗（由回调处理播放）
  videoFloatWindow.classList.remove('hidden');

  // 如果浏览器支持 mpegts.js，并且文件是 flv/ts/m2ts（或你也想用 mpegts.js 播放 mp4），则优先用 mpegts
  const canUseMpegts = window.mpegts && mpegts.getFeatureList; // 库存在的弱判定
  if (canUseMpegts && ['flv', 'ts', 'm2ts'].includes(ext)) {
    const url = setVideoObjectURL(file);
    // map ext -> mpegts type
    let type = 'mpegts';
    if (ext === 'flv') type = 'flv';
    if (ext === 'ts' || ext === 'm2ts') type = (ext === 'm2ts' ? 'm2ts' : 'mpegts');

    try {
      mpegtsPlayer = mpegts.createPlayer({
        type,
        isLive: false,
        filesize: file.size,
        url
      }, {
        enableWorker: true,
        enableStashBuffer: true,
        stashInitialSize: 384 * 1024 * 10,  // 指示 IO 存储缓冲区的初始大小
        lazyLoad: true,  // 如果有足够的数据可供播放，则中止 http 连接
        lazyLoadMaxDuration: 10 * 60,  // 懒加载
        lazyLoadRecoverDuration: 3 * 60,  // 恢复边界
        autoCleanupSourceBuffer: true,  // 自动清理 SourceBuffer
        autoCleanupMinBackwardDuration: 2 * 60,  // 保留 2 分钟用于回退
        autoCleanupMaxBackwardDuration: 5 * 60,  // 当向后缓冲区持续时间超过此值时，自动清理 SourceBuffer（删除更早的）
      });
      mpegtsPlayer.attachMediaElement(videoPlayer);
      mpegtsPlayer.load();
      // 等待视频元数据可用
      videoPlayer.addEventListener('loadedmetadata', function onceMeta() {
        videoPlayer.removeEventListener('loadedmetadata', onceMeta);
        if (typeof callbackOnReady === 'function') callbackOnReady();
      }, { once: true });
    } catch (e) {
      console.warn('mpegts.createPlayer 失败，回退至原生播放：', e);
      const url2 = setVideoObjectURL(file);
      videoPlayer.src = url2;
      videoPlayer.addEventListener('loadedmetadata', function onceMeta2() {
        videoPlayer.removeEventListener('loadedmetadata', onceMeta2);
        if (typeof callbackOnReady === 'function') callbackOnReady();
      }, { once: true });
    }
  } else if (canUseMpegts && ext === 'mp4') {
    // 对 mp4：你可以让 mpegts 处理（type:'mp4'），但对本地文件通常使用原生 <video> 更可靠
    // 这里优先使用原生行为（更稳定且无需 transmux）
    const url = setVideoObjectURL(file);
    videoPlayer.src = url;
    videoPlayer.addEventListener('loadedmetadata', function onceMeta() {
      videoPlayer.removeEventListener('loadedmetadata', onceMeta);
      if (typeof callbackOnReady === 'function') callbackOnReady();
    }, { once: true });
  } else {
    // 普通文件使用原生 loadedmetadata（兜底）
    const url = setVideoObjectURL(file);
    videoPlayer.src = url;
    videoPlayer.addEventListener('loadedmetadata', function onceMeta() {
      videoPlayer.removeEventListener('loadedmetadata', onceMeta);
      if (typeof callbackOnReady === 'function') callbackOnReady();
    }, { once: true });
  }
}

function renderFileList() {
  fileListDiv.innerHTML = '';
  if (selectedFiles.length === 0) {
    videoPlayerSection.classList.add('hidden');
  } else {
    videoPlayerSection.classList.remove('hidden');
  }

  selectedFiles.forEach((file, idx) => {
    const div = document.createElement('div');
    div.className = 'flex items-center justify-between p-2 bg-gray-100 rounded-lg border border-gray-200';
    
    // 更新：检查是否为当前播放文件，如果是则添加高亮 class
    if (currentFile && file.name === currentFile.name && file.size === currentFile.size) {
      div.classList.add('playing');
    }

    div.innerHTML = `
      <span class="font-semibold text-gray-800 break-words">${file.name}</span>
      <div class="flex gap-2">
        <button class="play-file-btn bg-blue-500 text-white py-1 px-3 rounded-lg text-sm" data-index="${idx}">播放</button>
        <button class="delete-file-btn bg-red-400 text-white py-1 px-3 rounded-lg text-sm" data-index="${idx}">删除</button>
      </div>
    `;
    fileListDiv.appendChild(div);
  });
}

/******************************************************************
 * 处理文件输入（拖拽 / 选择）
 ******************************************************************/
function handleFiles(list) {
  if (!list || list.length === 0) return;
  const filesArr = Array.from(list);
  const newFiles = filesArr.filter(f => !selectedFiles.some(sf => sf.name === f.name && sf.size === f.size));
  if (newFiles.length > 0) {
    selectedFiles.push(...newFiles);
    renderFileList();
    showMessage(`已添加 ${newFiles.length} 个文件。`);
  } else {
    showMessage('未添加新文件。');
  }
}

fileInput.addEventListener('change', (e) => handleFiles(e.target.files));
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => { e.preventDefault(); dropZone.classList.remove('drag-over'); handleFiles(e.dataTransfer.files); });

/******************************************************************
 * 播放文件（使用 loadFile 封装）
 ******************************************************************/
function playSelectedFile(file) {
  if (!file) return;

  // 尝试加载上次保存的状态
  const stateLoaded = loadPlayerState();

  loadFile(file, () => {
    // 如果没有加载到状态，则使用默认大小和居中
    if (!stateLoaded) {
      setInitialVideoSizeAndCenter(videoPlayer.videoWidth, videoPlayer.videoHeight);
    }

    showMessage(`正在播放: ${currentFile.name}`);
    videoPlayer.play().catch(()=>{});
  });
}

// 停止并隐藏播放器（使用 cleanupPlayer）
function stopAndHidePlayer() {
  videoFloatWindow.classList.add('hidden');
  try { videoPlayer.pause(); } catch (e) {}
  try { videoPlayer.currentTime = 0; } catch(e){}
  savePlayerState();
  cleanupPlayer();
}

// 加载播放器状态
function loadPlayerState() {
  const savedState = sessionStorage.getItem('videoPlayerState');
  if (savedState) {
    const state = JSON.parse(savedState);
    videoFloatWindow.style.width = state.width;
    videoFloatWindow.style.height = state.height;
    videoFloatWindow.style.left = state.left;
    videoFloatWindow.style.top = state.top;
    return true; // 表示已成功加载状态
  }
  return false; // 表示没有保存的状态
}

// 保存播放器状态到本地
function savePlayerState() {
  const playerState = {
    width: videoFloatWindow.style.width,
    height: videoFloatWindow.style.height,
    left: videoFloatWindow.style.left,
    top: videoFloatWindow.style.top
  };
  sessionStorage.setItem('videoPlayerState', JSON.stringify(playerState));
}

/******************************************************************
 * 设置浮动窗口的大小并居中
 ******************************************************************/
function setInitialVideoSizeAndCenter(videoWidth, videoHeight) {
  if (!videoWidth || !videoHeight) return;

  const aspect = videoWidth / videoHeight;
  const maxW = window.innerWidth * 1;  // 默认宽高
  const maxH = window.innerHeight * 1;
  let w = videoWidth, h = videoHeight;
  if (w > maxW) { w = maxW; h = w / aspect; }
  if (h > maxH) { h = maxH; w = h * aspect; }

  videoFloatWindow.style.width = `${w}px`;
  videoFloatWindow.style.height = `${h}px`;
  centerVideoWindow();
  savePlayerState();
}

// 添加通用的防抖函数
function debounce(func, delay) {
  let timer;
  return function(...args) {
    const context = this;
    clearTimeout(timer);
    timer = setTimeout(() => {
      func.apply(context, args);
    }, delay);
  };
}

function centerVideoWindow() {
  if (videoFloatWindow.classList.contains('hidden')) return;
  const ww = window.innerWidth, wh = window.innerHeight;
  const ew = videoFloatWindow.offsetWidth, eh = videoFloatWindow.offsetHeight;
  videoFloatWindow.style.left = `${(ww - ew) / 2}px`;
  videoFloatWindow.style.top = `${(wh - eh) / 2}px`;
}
window.addEventListener('resize', debounce(centerVideoWindow, 150));

/******************************************************************
 * 标记 / 添加片段
 ******************************************************************/
// 标记开始时间（取当前播放时间）
markStartBtn.addEventListener('click', () => {
  if (!currentFile && !videoPlayer.src) { showMessage('请先选择并播放视频'); return; }
  tempStartTime = videoPlayer.currentTime;
  manualStartTimeInput.value = formatTime(tempStartTime).replace(/:/g, '');
  showMessage('已标记开始时间');
});

// 标记结束时间
markEndBtn.addEventListener('click', () => {
  if (!currentFile && !videoPlayer.src) { showMessage('请先选择并播放视频'); return; }
  tempEndTime = videoPlayer.currentTime;
  manualEndTimeInput.value = formatTime(tempEndTime).replace(/:/g, '');
  showMessage('已标记结束时间');
});

// 2) 添加片段
addClipBtn.addEventListener('click', () => {
  if (!currentFile) { showMessage('请先选择视频文件'); return; }
  const startSec = parseTime(manualStartTimeInput.value);
  const endSec = parseTime(manualEndTimeInput.value);
  if (startSec === null || endSec === null) { showMessage('请先标记或输入开始/结束时间'); return; }
  if (startSec >= endSec) { showMessage('结束时间必须晚于开始时间'); return; }

  // derive outputHost (fallback from filename)
  let outputHost='unknown';
  try {
    let base = basenameNoExt(currentFile.name);
    let hostPart = base.split('_')[0] || base;
    outputHost = hostPart.replace(/[\/\\:\*\?"<>\|]/g, '_');
  } catch(e) {
    outputHost = 'unknown';
  }

  // prefer UI input
  let hostInputEl = document.getElementById('hostNameInput');
  if (hostInputEl && hostInputEl.value && hostInputEl.value.trim() !== '') {
    outputHost = hostInputEl.value.trim().replace(/[\/\\:\*\?"<>\|]/g,'_');
  }

  // file date from metadata
  let fileDate = '00000000';
  try {
    if (currentFile && currentFile.lastModified) fileDate = formatDateYYYYMMDD(currentFile.lastModified);
    else fileDate = formatDateYYYYMMDD(Date.now());
  } catch(e) { fileDate = formatDateYYYYMMDD(Date.now()); }

  let idx = getNextIndexForHostDate(outputHost, fileDate)
  let ext = 'mp4'
  let clipName = outputHost + '_' + fileDate + '_' + idx;
  let outputFileName = clipName + '.' + ext;

  clips.push({
    fileName: currentFile.name,
    startTime: formatTime(startSec),
    endTime: formatTime(endSec),
    outputHost,
    fileDate,
    idx,
    clipName,
    ext,
    outputFileName,
    originalFileSize: currentFile.size,
    originalFileLastModified: currentFile.lastModified || null
  });

  // 清空临时标记输入
  tempStartTime = tempEndTime = null;
  manualStartTimeInput.value = '';
  manualEndTimeInput.value = '';
  outputCommands.value = ''

  renderClipsList();
  showMessage(`已添加片段：${currentFile.name} (${formatTime(startSec)} - ${formatTime(endSec)})`);
});

/******************************************************************
 * 渲染剪辑列表（只渲染 DOM，事件使用委托绑定在外部）
 ******************************************************************/
function renderClipsList() {
  addedClipsList.innerHTML = '';
  if (clips.length === 0) {
    clipsListSection.classList.add('hidden');
    return;
  }
  clipsListSection.classList.remove('hidden');

  clips.forEach((clip, i) => {
    const item = document.createElement('div');
    item.className = 'flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200';
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
}

// 4) 按 outputHost + fileDate 计算下一个序号
function getNextIndexForHostDate(outputHost, fileDate) {
  let sameCount = 0;
  if (Array.isArray(clips)) {
    for (let i=0;i<clips.length;i++){
      let c = clips[i];
      if (c && c.outputHost === outputHost && c.fileDate === fileDate) sameCount++;
    }
  }
  return ++sameCount;
}

/******************************************************************
 * 使用事件委托替代多次 querySelectorAll(...).forEach(...) 绑定
 * - fileListDiv: 处理播放/删除文件
 * - addedClipsList: 处理播放/删除片段与输出名/扩展名输入
 ******************************************************************/
fileListDiv.addEventListener('click', (e) => {
  const playBtn = e.target.closest('.play-file-btn');
  const delBtn = e.target.closest('.delete-file-btn');
  if (playBtn) {
    const idx = parseInt(playBtn.dataset.index, 10);
    const file = selectedFiles[idx];
    if (file) playSelectedFile(file);
    return;
  }
  if (delBtn) {
    const idx = parseInt(delBtn.dataset.index, 10);
    const f = selectedFiles[idx];
    if (!f) return;
    selectedFiles.splice(idx, 1);
    // 如果被删除的是当前播放文件，则停止播放并清理
    if (currentFile && currentFile.name === f.name && currentObjectURL) {
      stopAndHidePlayer();
    }
    showMessage(`已删除文件: ${f.name}（相关剪辑片段保留）`);
    renderFileList();
    renderClipsList();
  }
});

// 委托处理 clips 列表内的按钮与输入
addedClipsList.addEventListener('click', (e) => {
  const playBtn = e.target.closest('.play-clip-btn');
  const delBtn = e.target.closest('.delete-clip-btn');
  if (playBtn) {
    const idx = parseInt(playBtn.dataset.index, 10);
    const clip = clips[idx];
    const originalFile = selectedFiles.find(f => f.name === clip.fileName && f.size === clip.originalFileSize);
    if (!originalFile) { showMessage(`错误：找不到原始文件 ${clip.fileName}`); return; }

    // 如果已加载且与当前文件一致，直接跳转播放；否则使用 loadFile
    if (currentFile && currentFile.name === originalFile.name && currentFile.size === originalFile.size && currentObjectURL && videoPlayer.src === currentObjectURL) {
      playClipRange(clip);
    } else {
      loadFile(originalFile, () => playClipRange(clip));
    }
    return;
  }
  if (delBtn) {
    const idx = parseInt(delBtn.dataset.index, 10);
    // 5) 删除时先 splice 并保存 removed，然后调用 renumber 再 render
    let removed = clips.splice(idx, 1)[0];
    // 更新 clips
    for (let index = idx; index < clips.length; index++) {
      let clip = clips[index];
      if (removed.outputHost === clip.outputHost && removed.fileDate === clip.fileDate) {
        clip.idx--;
        clip.clipName = clip.outputHost + '_' + clip.fileDate + '_' + clip.idx;
        clip.outputFileName = clip.clipName + '.' + clip.ext
      }
    }
    renderClipsList();
    showMessage('已删除片段');
    outputCommands.value = ''
  }
});

// 处理 output name/ext 的 input 事件（委托）
addedClipsList.addEventListener('input', (e) => {
  const nameInp = e.target.closest('.output-name');
  const extInp = e.target.closest('.output-ext');
  if (nameInp) {
    const idx = parseInt(nameInp.dataset.index, 10);
    if (!isNaN(idx) && clips[idx]) {
      const ext = clips[idx].outputFileName.split('.').pop();
      clips[idx].outputFileName = `${nameInp.value}.${ext}`;
    }
  }
  if (extInp) {
    const idx = parseInt(extInp.dataset.index, 10);
    if (!isNaN(idx) && clips[idx]) {
      const base = clips[idx].outputFileName.replace(/\.[^/.]+$/, "");
      clips[idx].outputFileName = `${base}.${extInp.value}`;
    }
  }

  outputCommands.value = ''
});

/******************************************************************
 * 播放 clip 的时间段（clip.startTime/clip.endTime 为 "HH:MM:SS"）
 ******************************************************************/
function playClipRange(clip) {
  currentClipEndTime = parseTime(clip.endTime);
  videoPlayer.currentTime = parseTime(clip.startTime);
  videoPlayer.play().catch(()=>{});
  showMessage(`正在播放片段: ${clip.fileName} (${clip.startTime} - ${clip.endTime})`);
}

// 监听播放进度，自动在片段结束时停止
videoPlayer.addEventListener('timeupdate', () => {
  if (currentClipEndTime !== null && videoPlayer.currentTime >= currentClipEndTime) {
    videoPlayer.pause();
    videoPlayer.currentTime = currentClipEndTime;
    currentClipEndTime = null;
    showMessage('片段播放结束');
  }
});

/******************************************************************
 * 生成 FFmpeg 指令并复制
 ******************************************************************/
generateBtn.addEventListener('click', () => {
  if (clips.length === 0) { outputCommands.value = '没有任何剪辑片段。'; showMessage('请先添加片段'); return; }
  const srcDir = videoSourcePathInput.value.trim();
  const outDir = outputPathInput.value.trim();
  if (!srcDir) { outputCommands.value = '请先输入视频文件所在目录。'; showMessage('请输入视频文件目录'); return; }
  if (!outDir) { outputCommands.value = '请先输入输出目录。'; showMessage('请输入输出目录'); return; }

  // 规范反斜杠（Windows 格式）
  const inDir = srcDir.replace(/\//g, '\\');
  const oDir = outDir.replace(/\//g, '\\');

  let cmds = '';
  clips.forEach(clip => {
    const inputPath = `${inDir}\\${clip.fileName}`;
    const outputPath = `${oDir}\\${clip.outputFileName}`;
    // -ss -to 在输入前/后的使用会影响精确性；此处采用简单可复制的形式
    cmds += `ffmpeg -loglevel quiet -ss "${clip.startTime}" -to "${clip.endTime}" -i "${inputPath}" -c copy "${outputPath}"\n`;
  });
  outputCommands.value = cmds.trim();
});

copyBtn.addEventListener('click', () => {
  if (!outputCommands.value) { showMessage('没有可复制的指令'); return; }
  outputCommands.select();
  try {
    if (document.execCommand('copy')) showMessage('已复制到剪贴板');
    else showMessage('复制失败，请手动复制');
  } catch (e) { showMessage('复制失败，请手动复制'); }
  window.getSelection().removeAllRanges();
});

/******************************************************************
 * 新增：为快进/快退按钮添加事件监听
 ******************************************************************/
function seekVideo(seconds) {
  if (!videoPlayer.src || isNaN(videoPlayer.duration)) {
    showMessage('请先播放一个视频');
    return;
  }
  const newTime = videoPlayer.currentTime + seconds;
  videoPlayer.currentTime = Math.max(0, Math.min(newTime, videoPlayer.duration));
  const direction = seconds > 0 ? '前进' : '后退';
  const unit = Math.abs(seconds) >= 60 ? '分钟' : '秒';
  const amount = Math.abs(seconds) >= 60 ? Math.abs(seconds) / 60 : Math.abs(seconds);
  showMessage(`${direction} ${amount} ${unit}`);
}

forwardBtn.addEventListener('click', () => {
  const seconds = parseFloat(fastForwardSecondsInput.value) || 15;
  seekVideo(seconds);
});

rewindBtn.addEventListener('click', () => {
  const seconds = parseFloat(fastBackwardSecondsInput.value) || 5;
  seekVideo(-seconds);
});

longForwardBtn.addEventListener('click', () => {
  const minutes = parseFloat(longFastForwardMinutesInput.value) || 2;
  seekVideo(minutes * 60);
});

longRewindBtn.addEventListener('click', () => {
  const minutes = parseFloat(longFastBackwardMinutesInput.value) || 2;
  seekVideo(-minutes * 60);
});

/******************************************************************
 * 全局键盘（合并：支持 Escape、空格、方向键与标记快捷键）
 ******************************************************************/
document.addEventListener('keydown', (e) => {
  // 当焦点在输入框时，不触发快捷键，以免影响正常输入
  if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
    return;
  }

  // Escape 始终关闭浮窗（如果可见）
  if (e.key === 'Escape' && !videoFloatWindow.classList.contains('hidden')) {
    stopAndHidePlayer(); return;
  }
  // 以下操作需要有视频 src 才有效
  if (!videoPlayer.src) return;

  if (e.key === ' ') {
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
    if (e.key === 'ArrowLeft')  { e.preventDefault(); seekVideo(-longFbMin * 60); }
  } else {
    if (e.key === 'ArrowRight') { e.preventDefault(); seekVideo(ffSec); }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); seekVideo(-fbSec); }
  }

  if (e.key === 'ArrowUp')    { e.preventDefault(); markStartBtn.click(); }
  if (e.key === 'ArrowDown')  { e.preventDefault(); markEndBtn.click(); }
});

/******************************************************************
 * 浮窗拖拽与缩放（简单实现）
 ******************************************************************/
// ---------- 通用交互启动器：防重复绑定 + 统一清理 ----------
function startInteraction(kind, opts) {
  // kind: 字符串，仅用于可读性（'drag' / 'resize'）
  // opts: { onMove: function(ev), minSize?: number }
  if (videoFloatWindow.dataset.interacting === '1') return null;
  videoFloatWindow.dataset.interacting = '1';
  document.body.style.userSelect = 'none';

  const onMove = typeof opts.onMove === 'function' ? opts.onMove : () => {};
  // 包装一下 move 处理器，确保引用一致，便于移除
  const moveHandler = (e) => onMove(e);

  const upHandler = () => cleanup();

  function cleanup() {
    window.removeEventListener('mousemove', moveHandler);
    window.removeEventListener('mouseup', upHandler);
    window.removeEventListener('blur', upHandler);
    document.body.style.userSelect = '';
    videoFloatWindow.dataset.interacting = '0';

    savePlayerState();
  }

  // 绑定到 window（保证在鼠标快速移出元素时仍接收到事件）
  window.addEventListener('mousemove', moveHandler);
  window.addEventListener('mouseup', upHandler);
  window.addEventListener('blur', upHandler);

  // 返回清理函数，若调用方想要在特定时机主动结束也可以调用
  return cleanup;
}

// ---------- 改进后的拖拽（使用通用启动器） ----------
dragHandle.addEventListener('mousedown', (e) => {
  e.preventDefault();
  if (e.button !== 0) return;

  const rect = videoFloatWindow.getBoundingClientRect();
  const startX = e.clientX;
  const startY = e.clientY;
  const initLeft = rect.left;
  const initTop = rect.top;
  const width = rect.width;
  const height = rect.height;

  // 启动交互（kind 仅做可读性标注）
  const cleanup = startInteraction('drag', {
    onMove: (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;

      let newLeft = initLeft + dx;
      let newTop = initTop + dy;

      // 视口边界检查：保持整个浮窗可见
      const maxLeft = Math.max(0, window.innerWidth - width);
      const maxTop = Math.max(0, window.innerHeight - height);

      if (newLeft < 0) newLeft = 0;
      if (newTop < 0) newTop = 0;
      if (newLeft > maxLeft) newLeft = maxLeft;
      if (newTop > maxTop) newTop = maxTop;

      videoFloatWindow.style.left = `${Math.round(newLeft)}px`;
      videoFloatWindow.style.top = `${Math.round(newTop)}px`;
    }
  });

  // 如果无法开始交互（已有会话），忽略
  if (!cleanup) return;
});

// ---------- 改进后的缩放（使用通用启动器） ----------
resizeHandle.addEventListener('mousedown', (e) => {
  e.preventDefault();
  if (e.button !== 0) return;

  const startX = e.clientX;
  const rect = videoFloatWindow.getBoundingClientRect();
  const initW = rect.width;
  const initH = rect.height;
  const left0 = rect.left;
  const top0 = rect.top;

  // 尝试使用视频真实尺寸计算纵横比；若无则用当前 DOM 宽高比
  const aspect = (videoPlayer && videoPlayer.videoWidth && videoPlayer.videoHeight)
    ? (videoPlayer.videoWidth / videoPlayer.videoHeight)
    : (initW / initH);

  const minSize = 200; // 最小像素阈值（如需可改成 minWidth/minHeight）

  const cleanup = startInteraction('resize', {
    onMove: (ev) => {
      const dx = ev.clientX - startX;
      let newW = Math.max(minSize, initW + dx);
      let newH = newW / aspect;

      // 视口边界（以左上角 left0/top0 为基准）
      const maxW = Math.max(0, window.innerWidth - left0);
      const maxH = Math.max(0, window.innerHeight - top0);

      if (newW > maxW) {
        newW = maxW;
        newH = newW / aspect;
      }

      if (newH > maxH) {
        newH = maxH;
        newW = newH * aspect;
        if (newW < minSize) {
          newW = minSize;
          newH = newW / aspect;
        }
      }

      if (newH < minSize) {
        newH = minSize;
        newW = newH * aspect;
      }

      videoFloatWindow.style.width = `${Math.round(newW)}px`;
      videoFloatWindow.style.height = `${Math.round(newH)}px`;
    }
  });

  if (!cleanup) return;
});


// 关闭按钮
closeFloatBtn.addEventListener('click', stopAndHidePlayer);

/******************************************************************
 * 简单消息显示：显示一段时间后自动隐藏
 ******************************************************************/
function showMessage(text) {
  messageBox.textContent = text;
  messageBox.classList.remove('opacity-0');
  messageBox.classList.add('opacity-100');
  clearTimeout(showMessage._timer);
  showMessage._timer = setTimeout(() => {
    messageBox.classList.remove('opacity-100');
    messageBox.classList.add('opacity-0');
  }, 2500);
}

// 清除所有片段按钮处理
clearAllClipsBtn.addEventListener('click', () => {
  clips = [];
  renderClipsList();
  showMessage('已清除所有片段');
});