// server.js - static file server with Range support
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

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache');

    if (range) {
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
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', (end - start) + 1);
      const ext = path.extname(filePath).toLowerCase();
      if (mime[ext]) res.setHeader('Content-Type', mime[ext]);
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.statusCode = 200;
      res.setHeader('Content-Length', total);
      const ext = path.extname(filePath).toLowerCase();
      if (mime[ext]) res.setHeader('Content-Type', mime[ext]);
      fs.createReadStream(filePath).pipe(res);
    }
  });
}

const server = http.createServer((req, res) => {
  let urlPath = decodeURI(req.url.split('?')[0]);

  // 页面目录
  if (urlPath === '/') urlPath = '/视频切片.html';
  const relPublic = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, relPublic);
  return sendFile(req, res, filePath);
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Serving HTML from: ${PUBLIC_DIR}`);
  console.log(`Serving videos from: ${VIDEOS_DIR}  (URL prefix /videos)`);
});
