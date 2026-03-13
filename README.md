# Audio Ring Visualizer

一个基于 `Python Bridge + Web Visualizer` 的 Windows 音频波形项目，适合本地预览和 OBS Browser Source 使用。

当前项目支持：

- 系统输出设备音频采集
- 环形频谱可视化
- 配置页实时调参
- 自定义中心图
- QQ 音乐当前歌曲识别
- 自动使用歌曲封面作为中心图
- 自动从封面提取主色调

## Requirements

- Windows
- Python 3.10+
- Node.js
- QQ 音乐桌面版（如果要用自动封面）

## Quick Start

推荐直接运行：

```bat
start_all.bat
```

它会：

- 启动 Python bridge
- 启动 Web dev server
- 打开配置页

启动后常用地址：

- 配置页：`http://127.0.0.1:5173/config.html`
- 可视化页：`http://127.0.0.1:5173/visualizer.html`
- Bridge：`http://127.0.0.1:8765`

## OBS

OBS `Browser Source` 直接使用：

```text
http://127.0.0.1:5173/visualizer.html
```

## Main Files

- `bridge_server.py`：Python bridge 主服务
- `tools/windows_media_session.ps1`：当前歌曲和封面 helper
- `web/config.html`：配置页入口
- `web/visualizer.html`：可视化页入口
- `start_all.bat`：单窗口启动面板

## Python Bridge

默认接口：

- `GET /health`
- `GET /devices`
- `GET /state`
- `GET /now-playing`
- `GET /config`
- `POST /config`
- `GET /spectrum?bars=72`
- `POST /device`
- `WS /`

默认端口：

- HTTP: `127.0.0.1:8765`
- WebSocket: `127.0.0.1:8766`

## QQ Music Auto Cover

配置页中开启 `Auto QQ Music Cover + Tone` 后：

- bridge 会识别当前 QQ 音乐歌曲
- 优先读取系统媒体会话
- 如果系统媒体会话拿不到封面，会回退到 QQ 音乐本地缓存封面
- 成功时自动替换中心图和色调
- 失败时回退到你手动配置的默认中心图和 `Accent Hue`

说明：

- 歌曲识别和封面更新是轮询方式，不是即时推送，所以切歌时会有轻微延迟
- 如果修改了 `bridge_server.py` 或 `tools/windows_media_session.ps1`，需要重启 bridge

## Manual Start

只启动 bridge：

```bat
start_bridge.bat
```

只启动 Web：

```bat
start_web_dev.bat
```

## Notes

- `start_all.bat` 现在是单窗口控制面板，支持重启、开日志、重新打开配置页和退出
- `.codex`、`.venv`、`start_codex.bat` 不会进入 git
