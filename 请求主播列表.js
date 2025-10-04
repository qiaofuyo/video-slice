/**
 * 这是一个示例函数，它包含了提供的所有 fetch 请求的执行和合并逻辑。
 * 假设这个函数将在支持 Promise 和 fetch API 的环境中运行。
 */
async function fetchAndCombineKuaishouAuthors() {
  // 1. 定义所有请求的分页游标（pcursor）
  const pcursors = ["", "30", "61", "91", "121", "152", "183", "213", "243", "273"];

  // 2. 封装单个 fetch 请求的配置
  function createFetchPromise(pcursor) {
    const url = "https://www.kuaishou.com/rest/v/relation/fol";
    const config = {
      "headers": {
        "accept": "application/json",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
        "cache-control": "no-cache",
        "content-type": "application/json",
        // 请确保此 kww 仍然是有效的
        "kww": "PnGU+9+Y8008S+nH0U+0mjPf8fP08f+98f+nLlwnrIP9+Sw/ZFGfzY+eGlGf+f+e4SGfbYP0QfGnLFwBLU80mYGAGUGfcMP/Z7+fb0wn8f8BclP0zjP0DM+e8f80rAG/pSPArE+e80P9chGA80+epj+/zYwBr98eGE+/LEGAGEGAWlG/YfP/Ll+Abf+0ZUG0p0+ePIGArEP0cl+AqAG/zS8c==",
        "pragma": "no-cache",
        "sec-ch-ua": "\"Google Chrome\";v=\"141\", \"Not?A_Brand\";v=\"8\", \"Chromium\";v=\"141\"",
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": "\"Windows\"",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin"
      },
      "referrer": "https://www.kuaishou.com/profile/3xgaiws3d3uy7dy",
      "body": JSON.stringify({ "pcursor": pcursor, "ftype": 1 }),
      "method": "POST",
      "mode": "cors",
      "credentials": "include"
    };

    return fetch(url, config)
      .then(response => {
        if (!response.ok) {
          // 如果状态码不是 2xx，抛出错误
          throw new Error(`HTTP error! Status: ${response.status} for pcursor: ${pcursor}`);
        }
        // 解析 JSON
        return response.json();
      })
      .catch(error => {
        console.error(`Fetch failed for pcursor ${pcursor}:`, error);
        // 确保在出错时返回一个具有空 authors 数组的对象，以便 Promise.all 不会中断
        return { authors: [] };
      });
  }

  // 3. 并发执行所有请求
  const fetchPromises = pcursors.map(createFetchPromise);
  let results;
  try {
    // Promise.all 等待所有请求完成，并保证结果顺序与 pcursors 一致
    results = await Promise.all(fetchPromises);
  } catch (e) {
    console.error("Critical error during one of the fetch calls, stopping merge.", e);
    return []; // 发生致命错误，返回空列表
  }

  // 4. ***核心：提取并拼接 'authors' 字段***
  const combinedAuthorsList = results.reduce((accumulator, currentResult) => {
    // 尝试从当前结果中获取 'authors' 数组，如果不存在则使用空数组 []
    const authorsList = currentResult.authors || [];

    // 使用 concat 拼接数组
    return accumulator.concat(authorsList);
  }, []);

  // 5. 打印结果
  console.log("所有请求结果已按序合并。");
  console.log("合并后的用户总数:", combinedAuthorsList.length);
  console.log("合并后的列表:", combinedAuthorsList);

  return combinedAuthorsList;
}

// 调用函数执行所有请求和合并操作
fetchAndCombineKuaishouAuthors();