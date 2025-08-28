@echo off
REM `REM` ��������ű���ע�ͱ�ǡ�
REM ����һ�������ű���ּ���Զ������� Node.js �������ʹ�������Ĺ��̡�

REM 1. ������ķ�������
REM `start cmd /k` �������һ���µ� CMD ������ִ�к����������ִ����Ϻ󴰿ڲ���رա�
REM �������û��ڷ����������ڼ䣬��Ȼ���Կ�������������־�����
start cmd /k "node E:\����\��Ƶ����\server.js"

REM 2. ���� PowerShell �ű������˿ڣ��ȴ������������ɹ���
echo Waiting for server to become available...
REM PowerShell �� Windows 10/11 Ĭ���Դ��Ľű����ԡ�
REM `Invoke-WebRequest -Method Head` ����һ�� HEAD ��������һ��������������ֻ��ȡ��Ӧͷ�����������ݡ�
REM `-ErrorAction Stop` ȷ���������ʧ�ܣ����磬������δ���������ű����׳����󲢽��� catch �顣
REM `do {} until ($available)` ѭ����ÿ�볢��һ�Σ�ֱ���������ɹ���Ӧ��
powershell -command "$available = $false; do { try { $response = Invoke-WebRequest -Uri 'http://localhost:8000' -Method Head -ErrorAction Stop; $available = $true; echo Server is up! } catch { echo .; Start-Sleep -Seconds 1 } } until ($available)"

REM 3. һ�����ɹ����ű������ִ�У����������
REM `start` �������ڴ�һ���ļ��� URL��
REM ��ȷ���������ֻ�ڷ�������ȫ������Ŵ򿪣��������û��������޷����ӡ��Ĵ���ҳ�档
start http://localhost:8000