# ESP32-S3 Matrix — Claude-Controlled LED Display

A Waveshare ESP32-S3-Matrix (8×8 WS2812B LEDs) controlled in natural language via Claude AI through a custom MCP (Model Context Protocol) server.

```
Claude (AI) → MCP Server (Node.js) → HTTP → ESP32 Firmware (C++) → LED Matrix
```

## What It Does

You talk to Claude in plain English — *"show a purple matrix rain animation"* or *"set a 5-minute snow timer"* — and the LEDs respond in real time. The MCP server acts as the bridge, translating Claude's structured tool calls into HTTP requests to the firmware running on the board.

## Features

### Animations
| Mode | Description |
|---|---|
| `fire` | Heat-rise simulation with configurable palette, intensity, tendrils, and sparks |
| `matrix_rain` | Digital rain / falling character screensaver (classic, blue, red, purple) |
| `liquid` | Tilt-reactive fluid simulation using the onboard IMU — tilt the board to slosh it |
| `imu` | Live 3-axis accelerometer bar graph |
| `rainbow` / `wave` / `breathe` / `solid` | Classic LED effects |
| `weather` | Animated weather icon + live data (temp, humidity, UV, pressure) via wttr.in |
| `chiptemp` | ESP32 chip temperature display with pulsing background |
| `clock` | Live 12-hour clock synced via NTP |
| `timer_fill` | Countdown as a gradient LED fill (bottom → top) |
| `timer_snow` | Countdown as snowfall accumulation |
| `timer_text` | Countdown as MM:SS digits |

### Text Scrolling
Scrolling text in three font sizes (5×7, 3×5, 3×3), with solid or two-color gradient support.

### Web UI
Each mode has a dedicated HTML control page served directly from the board's flash (LittleFS), accessible at `http://esp32matrix.local` from any browser on the same network.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Claude (claude.ai or Claude Code)                   │
│  "Show fire animation, high intensity, blue palette" │
└──────────────────┬──────────────────────────────────┘
                   │  MCP tool call: matrix_set_animation
                   ▼
┌─────────────────────────────────────────────────────┐
│  MCP Server  (mcp_server/index.ts — Node.js)        │
│  • 8 registered tools                               │
│  • Translates natural language params → HTTP JSON   │
│  • Runs as a stdio process managed by Claude Code   │
└──────────────────┬──────────────────────────────────┘
                   │  POST http://esp32matrix.local/api/display/animation
                   ▼
┌─────────────────────────────────────────────────────┐
│  ESP32-S3 Firmware  (Arduino C++)                   │
│  • WebServer on port 80                             │
│  • FastLED for LED control                          │
│  • millis()-based non-blocking animation loop       │
│  • QMI8658C IMU via I2C for tilt/liquid modes       │
└──────────────────┬──────────────────────────────────┘
                   │  FastLED.show()
                   ▼
        [ 8×8 WS2812B LED Matrix ]
```

## Hardware

- **Board:** Waveshare ESP32-S3-Matrix
- **Display:** 8×8 WS2812B RGB LED grid (64 LEDs), data pin 14
- **IMU:** QMI8658C 6-axis (accelerometer + gyroscope), I2C SDA=11 SCL=12
- **Flash:** 8MB with LittleFS partition for web UI files

## Project Structure

```
esp32_matrix_webserver/     # Arduino sketch (all .ino files compile as one unit)
│   esp32_matrix_webserver.ino  — globals, setup(), loop()
│   api_handlers.ino            — all HTTP route handlers
│   anim_fire.ino               — fire animation
│   anim_liquid.ino             — IMU driver + liquid/imu animations
│   anim_effects.ino            — rainbow, breathe, wave, solid
│   anim_matrix.ino             — matrix rain screensaver
│   clock_timer.ino             — NTP clock + 3 timer modes
│   weather.ino                 — weather fetch + display
│   fonts.ino                   — 3×3 and 3×5 pixel fonts
│   scroll_text.ino             — 5×7, 3×5, 3×3 scrolling text
│   secrets.h.example           — copy to secrets.h and add your WiFi credentials
└── data/                       — web UI pages (uploaded via LittleFS)

mcp_server/                 # Node.js MCP server
│   index.ts                    — MCP tool definitions + HTTP request handlers
│   package.json
└── tsconfig.json
```

## Setup

### 1. Firmware

**Requirements:** Arduino IDE 2.x with the ESP32 board package installed.

**Libraries** (install via Tools → Manage Libraries):
- FastLED
- ArduinoJson
- PNGdec

**Board settings** (Tools menu):
- Board: `ESP32S3 Dev Module`
- USB Mode: `Hardware CDC and JTAG`
- USB CDC On Boot: `Enabled`
- Flash Size: `8MB (64Mb)`
- Partition Scheme: `8MB with spiffs (3MB APP, 5MB SPIFFS)`

**WiFi credentials:**
```
cp esp32_matrix_webserver/secrets.h.example esp32_matrix_webserver/secrets.h
# Edit secrets.h and fill in your SSID and password
```

Flash firmware, then upload the web UI:  
`Tools → ESP32 LittleFS Data Upload`

### 2. MCP Server

```bash
cd mcp_server
npm install
```

Set the board's IP (or use mDNS default):
```bash
# Optional — defaults to http://esp32matrix.local
export ESP32_URL=http://192.168.1.xxx
```

Wire it into Claude Code by adding to your `.claude/settings.json`:
```json
{
  "mcpServers": {
    "esp32-matrix": {
      "command": "npx",
      "args": ["tsx", "index.ts"],
      "cwd": "/path/to/mcp_server",
      "env": { "ESP32_URL": "http://esp32matrix.local" }
    }
  }
}
```

## API Reference

```
GET  /api/status
GET  /api/sensors/temperature
GET  /api/sensors/accelerometer
GET  /api/sensors/weather
POST /api/display/clear
POST /api/brightness              { "level": 0-255 }
POST /api/display/text            { "text", "color", "color2", "gradient", "small", "tiny", "scroll_speed" }
POST /api/display/animation       { "type", ...animation-specific params }
POST /api/display/matrix          { "matrix": [[8 rows × 8 hex colors]] }
POST /api/weather/mode            { "mode": "temp"|"humidity"|"uv"|"pressure"|"cycle" }
```

## Tech Stack

- **Firmware:** C++ / Arduino framework, FastLED, ArduinoJson, LittleFS, WiFi, HTTPClient
- **MCP Server:** TypeScript, Node.js, `@modelcontextprotocol/sdk`
- **AI Integration:** Claude via MCP (Model Context Protocol)
