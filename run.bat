@echo off
REM 1. ������ķ����������´����У�
start cmd /k "node .\server.js"

REM 2. ���� PowerShell �ű������˿�
echo Waiting for server to become available...
powershell -command "$available = $false; do { try { $response = Invoke-WebRequest -Uri 'http://localhost:8000' -Method Head -ErrorAction Stop; $available = $true; echo Server is up! } catch { echo .; Start-Sleep -Seconds 1 } } until ($available)"

REM 3. һ�����ɹ����ű������ִ�У��������
start http://localhost:8000