/**
 * 提供 cookie 的优先顺序（从外部读取，不要硬编码）:
 * 1) 环境变量：
 *    node --env-file=.env 请求主播列表.js
 *    $env:COOKIE_STRING = '_did=web_27533...'; node 请求主播列表.js
 * 2) 环境变量（文件路径）：
 *    $env:COOKIE_FILE='.\cookie.txt'; node 请求主播列表.js; Remove-Item Env:COOKIE_FILE
 * 
 * 3) 命令行参数：
 *    KEY=VAL：node 请求主播列表.js COOKIE_STRING='_did=web_27533...'
 *    --cookie 'value'：node 请求主播列表.js --cookie '_did=web_27533...'
 *    --cookie=value：node 请求主播列表.js --cookie='_did=web_27533...'
 * 
 * 4) 交互式粘贴（stdin）
 * 
 * 可选：若确实需要 自动处理 Set-Cookie / 持久 cookie，请改用 tough-cookie + fetch-cookie
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const BASE = "https://www.kuaishou.com";
const API = "/rest/v/relation/fol";
const OUTFILE = "anchor_list.json";
const MAX_ITER = 20;
const TIMEOUT_MS = 20000; // 超时保护

// ---- 如果没有全局 fetch，则动态加载 node-fetch（仅当需要时） ----
let _fetch = globalThis.fetch;
async function ensureFetch() {
  if (_fetch) return _fetch;
  try {
    // 动态 import，仅在 Node <18 或全局无 fetch 时触发
    const mod = await import("node-fetch");
    _fetch = mod.default || mod;
    return _fetch;
  } catch (e) {
    throw new Error("未检测到全局 fetch，且未安装 node-fetch。请运行：npm i node-fetch");
  }
}

// ---- 从环境 / 文件 / stdin 获取 cookie 字符串（不硬编码） ----
async function getCookie() {
  // 1) 环境变量
  if (process.env.COOKIE_STRING && process.env.COOKIE_STRING.trim()) {
    console.log("使用环境变量 COOKIE_STRING（优先）。");
    return process.env.COOKIE_STRING.trim();
  }

  // 2) 文件路径（环境变量指定）
  if (process.env.COOKIE_FILE) {
    const p = path.resolve(process.env.COOKIE_FILE);
    if (fs.existsSync(p)) {
      const s = fs.readFileSync(p, { encoding: "utf8" }).trim();
      if (s.length > 0) {
        console.log(`从文件读取 cookie：${p}`);
        return s;
      }
    } else {
      console.warn(`指定的 COOKIE_FILE 不存在：${p}`);
    }
  }

  // 3) 命令行参数（方便做一次性调试，适合非敏感参数）
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    console.log(`从命令行读取 cookie：${arg}`);
    // 支持 KEY=VAL
    if (arg.startsWith('COOKIE_STRING=')) {
      return arg.slice('COOKIE_STRING='.length);
    }
    // 支持 --cookie 'value'
    if (arg === '--cookie' && i + 1 < process.argv.length) {
      return process.argv[i + 1];
    }
    // 支持 --cookie=value
    if (arg.startsWith('--cookie=')) {
      return arg.slice('--cookie='.length);
    }
  }

  // 4) 交互式读取（开发时备用）
  if (process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const question = (q) => new Promise(resolve => rl.question(q, ans => resolve(ans)));
    const answer = await question('未发现 COOKIE_STRING / COOKIE_FILE。请粘贴 cookie 字符串并回车（可留空）：\n');
    rl.close();
    return (answer || '').trim();
  }

  // 如果是非交互式环境且无 cookie，则返回空
  return "";
}

// ---- fetch with timeout helper ----
async function fetchWithTimeout(url, opts = {}, timeout = TIMEOUT_MS) {
  const fetchImpl = await ensureFetch();
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetchImpl(url, { ...opts, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

// ---- 主函数：链式分页、合并 authors、写文件 ----
async function fetchAndWriteAuthors() {
  console.log(process.argv);
  // 获取 cookie
  const cookieString = await getCookie();
  if (!cookieString) {
    console.warn("未提供 cookie（COOKIE_STRING/COOKIE_FILE）。接口可能返回匿名数据或拒绝访问。");
  } else {
    console.log("已获得 cookie。长度：", cookieString.length);
  }

  // 可从环境读取签名头（例如 kww），以避免写死在代码里
  const EXTRA_HEADERS = {};
  if (process.env.KWW) EXTRA_HEADERS.kww = process.env.KWW;
  if (process.env.KWFV1) EXTRA_HEADERS.kwfv1 = process.env.KWFV1;

  let pcursor = "";
  const combinedAuthors = [];
  let iter = 0; // 页数

  while (true) {
    iter++;
    if (iter > MAX_ITER) {
      console.warn(`达到最大迭代次数 ${MAX_ITER}，停止以防死循环。`);
      break;
    }

    const url = BASE + API;
    const body = JSON.stringify({ pcursor, ftype: 1 });
    const headers = {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "Accept-Language": "zh-CN,zh;q=0.9",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      "Origin": "https://www.kuaishou.com",
      "Referer": "https://www.kuaishou.com/profile/3xgaiws3d3uy7dy",
      ...EXTRA_HEADERS
    };

    // 仅当存在 cookieString 时才把 Cookie header 附上
    if (cookieString) {
      headers.Cookie = cookieString;
    }

    let res;
    try {
      res = await fetchWithTimeout(url, {
        method: "POST",
        headers,
        body
      });
    } catch (err) {
      if (err.name === "AbortError") {
        console.error("请求超时或被中止：", err.message || err);
      } else {
        console.error("请求失败：", err && err.message ? err.message : err);
      }
      break;
    }

    if (!res.ok) {
      console.error(`HTTP ${res.status} ${res.statusText}，停止。`);
      break;
    }

    let data;
    try {
      data = await res.json();
    } catch (e) {
      console.error("响应解析 JSON 失败：", e && e.message ? e.message : e);
      break;
    }

    const authors = Array.isArray(data.authors) ? data.authors : [];
    if (authors.length) combinedAuthors.push(...authors);

    console.log(`第 ${iter} 页：pcursor = ${String(data.pcursor)}, 本页 authors = ${authors.length}, 累计 = ${combinedAuthors.length}`);

    if (!("pcursor" in data)) {
      console.warn("响应中不包含 pcursor，停止请求。");
      break;
    }
    if (data.pcursor === "no_more") {
      console.log("服务端返回 pcursor === 'no_more'，分页结束。");
      break;
    }
    if (typeof data.pcursor === "string" && data.pcursor.length > 0) {
      pcursor = data.pcursor;
      continue;
    } else {
      console.warn("pcursor 值异常（为空或非字符串），停止请求以防无限循环。");
      break;
    }
  }

  // 写文件
  try {
    fs.writeFileSync(OUTFILE, JSON.stringify(combinedAuthors, null, 2), { encoding: "utf8" });
    console.log(`已写入 ${OUTFILE}，包含 authors 数量：`, combinedAuthors.length);
  } catch (e) {
    console.error("写文件失败：", e?.message ? e.message : e);
    // 发生错误时不会立刻强制退出——Node 会在事件循环（pending I/O、定时器、未完成的 promise 等）执行完后自然退出，并带上自定义的退出码。
    process.exitCode = 2;
  }
}

// 立即执行
fetchAndWriteAuthors().catch(err => {
  console.error("执行异常：", err && err.message ? err.message : err);
  // 如果出错不会立刻强制退出——Node 会在事件循环（pending I/O、定时器、未完成的 promise 等）执行完后自然退出，并带上自定义的退出码
  process.exitCode = 2;
});
