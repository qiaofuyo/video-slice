// server.js - 一个轻量级的、支持 Range 请求的静态文件服务器
// 功能：
// 1. 服务指定目录下的 HTML、JS、CSS 等静态文件。
// 2. 特别为大视频文件提供 Range 请求支持，实现流式播放。
// 3. 支持 CORS，允许前端页面跨域请求视频文件。
// 4. 监听 pm2 的 --watch 参数，当文件改变时自动重启。

// pm2 start server.js --watch

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8000;

// 定义静态文件目录和视频文件目录的绝对路径。
const PUBLIC_DIR = path.join(__dirname);
const VIDEOS_DIR = path.join('D:', '04_Temp', '直播', '快手直播');

// MIME 类型映射表，用于正确设置响应头中的 Content-Type。
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

// 核心功能函数：根据请求和文件路径发送文件内容。
function sendFile(req, res, filePath) {
  // 1. 获取文件状态，检查文件是否存在。
  fs.stat(filePath, (err, stat) => {
    if (err) {
      // 文件不存在或无法访问，返回 404 Not Found。
      res.statusCode = 404;
      res.end('Not found');
      return;
    }

    const total = stat.size;
    const range = req.headers.range;

    // 2. 设置通用的响应头。
    res.setHeader('Access-Control-Allow-Origin', '*'); // 允许所有来源的跨域请求
    res.setHeader('Cache-Control', 'no-cache'); // 强制客户端每次都重新验证
    res.setHeader('Accept-Ranges', 'bytes'); // 告知客户端服务器支持范围请求

    // 3. 根据文件扩展名设置 Content-Type。
    const ext = path.extname(filePath).toLowerCase();
    if (mime[ext]) res.setHeader('Content-Type', mime[ext]);

    // 4. 处理 HEAD 请求：只返回响应头，不发送文件内容。
    if (req.method === 'HEAD') {
      res.statusCode = 200;
      res.setHeader('Content-Length', total);
      return res.end();
    }

    // 5. 处理 Range 请求（核心功能）。
    if (range) {
      // 解析 Range 头部 "bytes=start-end"
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
      
      // 验证范围请求是否合法。
      if (isNaN(start) || isNaN(end) || start > end || start >= total) {
        // 请求的范围不合法，返回 416 Range Not Satisfiable。
        res.statusCode = 416;
        res.setHeader('Content-Range', `bytes */${total}`);
        return res.end();
      }

      // 设置 206 Partial Content 状态码和 Range 相关响应头。
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
      res.setHeader('Content-Length', (end - start) + 1);
      
      // 创建一个可读流，只读取请求的字节范围，并通过管道发送给响应。
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      // 6. 处理非 Range 的全量文件请求。
      res.statusCode = 200;
      res.setHeader('Content-Length', total);
      fs.createReadStream(filePath).pipe(res);
    }
  });
}

// 创建 HTTP 服务器，处理所有传入的请求。
const server = http.createServer((req, res) => {
  // 从 URL 中提取路径，并移除查询参数和特殊字符。
  let urlPath = decodeURI(req.url.split('?')[0]);

  // 默认请求 "/" 时，服务 index.html。
  if (urlPath === '/') urlPath = '/index.html';

  // 规范化路径，防止路径遍历攻击（如 `../../`）。
  const relPublic = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');

  // 根据 URL 前缀路由请求。
  // 如果 URL 以 "/videos/" 开头，则从 VIDEOS_DIR 服务文件。
  if (urlPath.startsWith('/videos/')) {
    let rel = urlPath.replace(/^\/videos\//, '');

    // 尝试多种解码策略，兼容错误编码的 URL
    const decodeAttempts = [
      rel,
      decodeURIComponent(rel),
      decodeURIComponent(decodeURIComponent(rel)), // 双重
      rel.replace(/%20/g, ' ').replace(/%27/g, "'").replace(/%7E/g, '~'),
    ];

    let filePath = null;
    for (const attempt of decodeAttempts) {
      const candidate = path.join(VIDEOS_DIR, attempt);
      if (fs.existsSync(candidate)) {
        filePath = candidate;
        break;
      }
    }

    if (!filePath) {
      res.statusCode = 404;
      res.end('File not found');
      return;
    }
    
    return sendFile(req, res, filePath);
  }

  // 否则，从 PUBLIC_DIR 服务文件。
  const filePath = path.join(PUBLIC_DIR, relPublic);
  return sendFile(req, res, filePath);
});

// 启动服务器并监听指定端口。
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Serving HTML from: ${PUBLIC_DIR}`);
  console.log(`Serving videos from: ${VIDEOS_DIR}  (URL prefix /videos)`);
});