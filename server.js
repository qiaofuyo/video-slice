// server.js - static file server with Range support (improved)
// pm2 start server.js --watch
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8000;

// 页面目录 = E:\下载\视频剪切
const PUBLIC_DIR = path.join('E:', '下载', '视频剪切');
// 视频目录 = E:\下载
const VIDEOS_DIR = path.join('E:', '下载');

const mime = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.mp4': 'video/mp4',
  '.flv': 'video/x-flv',
  '.ts': 'video/mp2t',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

function sendFile(req, res, filePath) {
  fs.stat(filePath, (err, stat) => {
    if (err) { res.statusCode = 404; res.end('Not found'); return; }

    const total = stat.size;
    const range = req.headers.range;

    // CORS & 基本 headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache');
    // 明确告诉客户端支持 Range（总是设置）
    res.setHeader('Accept-Ranges', 'bytes');

    // Content-Type (提前设置，HEAD 时也有)
    const ext = path.extname(filePath).toLowerCase();
    if (mime[ext]) res.setHeader('Content-Type', mime[ext]);

    // HEAD 请求仅返回 headers，不发送 body
    if (req.method === 'HEAD') {
      res.statusCode = 200;
      res.setHeader('Content-Length', total);
      return res.end();
    }

    if (range) {
      // 处理范围请求
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
      if (isNaN(start) || isNaN(end) || start > end || start >= total) {
        res.statusCode = 416;
        res.setHeader('Content-Range', `bytes */${total}`);
        return res.end();
      }
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
      res.setHeader('Content-Length', (end - start) + 1);
      // stream the requested range
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      // 全量返回（但 Accept-Ranges 已在 header，客户端知道可 range）
      res.statusCode = 200;
      res.setHeader('Content-Length', total);
      fs.createReadStream(filePath).pipe(res);
    }
  });
}

const server = http.createServer((req, res) => {
  let urlPath = decodeURI(req.url.split('?')[0]);

  // 默认页面
  if (urlPath === '/') urlPath = '/视频切片.html';

  // 安全处理相对路径
  const relPublic = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');

  // 如果 URL 以 /videos/ 开头，则从 VIDEOS_DIR 提取文件
  if (urlPath.startsWith('/videos/')) {
    const rel = urlPath.replace(/^\/videos\//, '');
    const filePath = path.join(VIDEOS_DIR, rel);
    return sendFile(req, res, filePath);
  }

  // 默认从 PUBLIC_DIR 提取
  const filePath = path.join(PUBLIC_DIR, relPublic);
  return sendFile(req, res, filePath);
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Serving HTML from: ${PUBLIC_DIR}`);
  console.log(`Serving videos from: ${VIDEOS_DIR}  (URL prefix /videos)`);
});
// 怎么做到随意拖动进度条播放视频
// 已添加的剪辑片段播放时只加载片段时间范围内的视频内容