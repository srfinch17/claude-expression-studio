@echo off
REM Launch the compiled MCP server directly. Do NOT redirect stderr to a shared
REM fixed file -- a long-lived server holds that handle for its whole lifetime,
REM so an orphaned instance locks the file and every new spawn's redirect fails
REM ("file is being used by another process") -> stdout pipe dies -> MCP -32000.
REM Claude Code already captures this server's stderr in its own per-session
REM mcp-logs, so the separate logfile is redundant. (Root-caused 2026-06-18.)
"C:\Program Files\nodejs\node.exe" "C:\Users\srfin\Dropbox\Dev\repos\peckworks-esp32s3matrix\mcp_server\dist\index.js"
