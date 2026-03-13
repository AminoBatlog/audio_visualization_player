# Audio Ring Visualizer

项目现在包含两条线：

- `Python Bridge`：负责 Windows 输出设备枚举、系统音频 loopback 采集、共享配置存储，以及 WebSocket 频谱推送
- `Web 版本`：负责透明背景可视化和配置页面，并作为 OBS Browser Source 的主要入口

## Main Entry Points

前端工程在 [web](./web) 目录。

主要页面：

- `web/visualizer.html`
- `web/config.html`

本地 bridge 服务入口：

- `bridge_server.py`

## Current Features

当前 Web 版本已包含：

- 透明背景环形可视化页面
- 玻璃质感光柱风格
- 中心图片自定义
- 检测到音频时图片旋转
- 配置页
- 本地配置持久化
- 共享 bridge 配置持久化
- `Python Bridge` WebSocket 频谱推送
- 音频源选择
  - `Demo Signal`
  - `Microphone`
  - `Audio File`
  - `Python Bridge`
- Python bridge 输出设备选择

## One-Click Start

推荐直接使用：

```bat
start_all.bat
```

它会自动：

- 启动 Python bridge
- 启动 Web 开发服务
- 打开配置页

OBS Browser Source 使用地址：

```text
http://127.0.0.1:5173/visualizer.html
```

## Start Python Bridge

```bat
start_bridge.bat
```

默认监听：

```text
HTTP: http://127.0.0.1:8765
WS:   ws://127.0.0.1:8766
```

接口包括：

- `GET /health`
- `GET /devices`
- `GET /state`
- `GET /config`
- `POST /config`
- `GET /spectrum?bars=72`
- `POST /device`
- `WebSocket /` 频谱推送

说明：

- `config.html` 会把设置同步到 bridge
- `visualizer.html` 会优先从 bridge 拉共享配置
- `Python Bridge` 模式优先使用 WebSocket 推送，失败时回退到 HTTP 读取
- OBS Browser Source 不再依赖普通浏览器的 `localStorage`

如果你修改过 `bridge_server.py`，要先重启 bridge，OBS 才会拿到新接口。

## Run Web Version

单独启动 Web 开发模式：

```bat
start_web_dev.bat
```

或手动：

```powershell
cd web
& 'C:\Program Files\nodejs\node.exe' 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' install
& 'C:\Program Files\nodejs\node.exe' .\node_modules\vite\bin\vite.js
```

构建：

```powershell
cd web
& 'C:\Program Files\nodejs\node.exe' .\node_modules\vite\bin\vite.js build
```

## Recommended Workflow

本地使用和 OBS 接入建议按这个顺序：

1. 关闭旧的 bridge 进程
2. 运行 `start_all.bat`
3. 在配置页中设置 `Python Bridge` 输出设备和视觉参数
4. 在 OBS 中加载 `http://127.0.0.1:5173/visualizer.html` 作为 `Browser Source`

## OBS Direction

当前推荐接入方式：

- 使用 OBS `Browser Source`
- 加载开发环境中的 `visualizer.html`，或构建后的 `web/dist/visualizer.html`

如果后续要进一步增强，可继续做：

- OBS 专用纯净页面
- bridge 自动发现和自动重连
- 输出设备热切换状态提示
