/**
 * 顺序拉取并合并 authors（直到服务端返回 pcursor === "no_more"）
 * 说明：第一次请求 pcursor = ""；随后每次用上一次响应的 pcursor 作为下一次请求的 pcursor。
 *
 * 注意：
 * - 请确认 headers 中的 Cookie、kww 是否需要更新。
 * - 提供了 maxIterations 防止无限循环（默认 200）。
 */
import fs from "fs";
async function fetchAndCombineKuaishouAuthorsSequential(maxIterations = 200) {
  const url = "https://www.kuaishou.com/rest/v/relation/fol";

  const headers = {
    "Accept": "application/json",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Content-Type": "application/json",
    "Cookie": "",
    "Origin": "https://www.kuaishou.com",
    "Referer": "https://www.kuaishou.com/profile/",
    "kww": "",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
  };

  let pcursor = "";  // 第一条请求的 pcursor
  const combinedAuthors = [];
  let iter = 0;

  while (true) {
    iter += 1;
    if (iter > maxIterations) {
      console.warn(`达到最大迭代次数 ${maxIterations}，停止请求以防死循环。`);
      break;
    }

    const body = JSON.stringify({ pcursor, ftype: 1 });

    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body,
        mode: "cors"
      });
    } catch (err) {
      console.error(`第 ${iter} 次请求网络错误：`, err);
      break;
    }

    if (!response.ok) {
      console.error(`第 ${iter} 次请求返回非 2xx 状态：${response.status}，停止。`);
      break;
    }

    let data;
    try {
      data = await response.json();
    } catch (err) {
      console.error(`第 ${iter} 次响应解析 JSON 失败：`, err);
      break;
    }

    // 提取并拼接 authors（若不存在按空数组处理）
    const authors = Array.isArray(data.authors) ? data.authors : [];
    if (authors.length) {
      combinedAuthors.push(...authors);
    }

    // 日志（便于调试）
    console.log(`第 ${iter} 页：pcursor 响应 = ${String(data.pcursor)}, 本页 authors = ${authors.length}, 累计 = ${combinedAuthors.length}`);

    // 检查 pcursor 字段（若为 "no_more" 则停止）
    if (!("pcursor" in data)) {
      console.warn("响应中不包含 pcursor 字段，停止请求。");
      break;
    }

    if (data.pcursor === "no_more") {
      console.log("服务端返回 pcursor === 'no_more'，分页结束。");
      break;
    }

    // 为下一轮请求设定 pcursor
    // 若 data.pcursor 非空字符串，则继续；否则也作为保护直接停止
    if (typeof data.pcursor === "string" && data.pcursor.length > 0) {
      pcursor = data.pcursor;
    } else {
      console.warn("pcursor 值异常（为空或非字符串），停止请求以防无限循环。");
      break;
    }
  }

  console.log("所有页合并完成。合并后 authors 总数：", combinedAuthors.length);
  return combinedAuthors;
}

// 调用
fetchAndCombineKuaishouAuthorsSequential().then(list => {
  console.log('最终列表长度：', list.length);

  // 将合并结果写入文件（漂亮缩进）
  const OUTFILE = 'anchor_list.json';
  fs.writeFileSync(OUTFILE, JSON.stringify(list, null, 2), { encoding: "utf8" });
  console.log(`已写入 ${OUTFILE}，包含 authors 数量：`, list.length);
}).catch(err => {
  console.error("执行过程中发生错误：", err && err.message ? err.message : err);
  // 发生错误时并不会立刻强制退出——Node 会在事件循环（pending I/O、定时器、未完成的 promise 等）执行完后自然退出
  process.exitCode = 2;
});
