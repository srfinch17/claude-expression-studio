@echo off
echo %DATE% %TIME% SPAWNED >> C:\Temp\mcp_spawn.log
call "C:\Program Files\nodejs\node.exe" "C:\Users\srfin\Dropbox\Dev\repos\peckworks-esp32s3matrix\mcp_server\dist\index.js" 2>>C:\Temp\mcp_spawn.log
