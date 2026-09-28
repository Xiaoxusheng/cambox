@echo off
cd /d %~dp0
if not exist camhub.exe (
  echo 首次运行, 正在编译...
  go build -o camhub.exe ./cmd/server
  if errorlevel 1 (
    echo 编译失败, 请确认已安装 Go 1.22+
    pause
    exit /b 1
  )
)
echo camhub 启动中... 浏览器打开 http://127.0.0.1:8787 (Ctrl+C 退出)
camhub.exe
pause
