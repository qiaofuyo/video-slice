@echo off
chcp 65001

REM 自动化启动 Node.js 服务器和打开浏览器的过程。

REM 1. 启动你的服务器。
REM `start cmd /k` 命令会在一个新的 CMD 窗口中执行后续命令，并且执行完毕后窗口不会关闭。
REM 这允许用户在服务器运行期间，仍然可以看到服务器的日志输出。
start cmd /k "node %~dp0\server.js"

REM 2. 调用 PowerShell 脚本来检测端口，等待服务器启动成功。
echo Waiting for server to become available...
REM `Invoke-WebRequest -Method Head` 发送一个 HEAD 请求，这是一种轻量级的请求，只获取响应头而不下载内容。
REM `-ErrorAction Stop` 确保如果请求失败（例如，服务器未启动），脚本会抛出错误并进入 catch 块。
REM `do {} until ($available)` 循环会每秒尝试一次，直到服务器成功响应。
powershell -command "$available = $false; do { try { $response = Invoke-WebRequest -Uri 'http://localhost:8000' -Method Head -ErrorAction Stop; $available = $true; echo Server is up! } catch { echo .; Start-Sleep -Seconds 1 } } until ($available)"

REM 3. 一旦检测成功，脚本会继续执行，打开浏览器。
start http://localhost:8000