@echo off
REM 1. 启动你的服务器（在新窗口中）
start cmd /k "node .\server.js"

REM 2. 调用 PowerShell 脚本来检测端口
echo Waiting for server to become available...
powershell -command "$available = $false; do { try { $response = Invoke-WebRequest -Uri 'http://localhost:8000' -Method Head -ErrorAction Stop; $available = $true; echo Server is up! } catch { echo .; Start-Sleep -Seconds 1 } } until ($available)"

REM 3. 一旦检测成功，脚本会继续执行，打开浏览器
start http://localhost:8000