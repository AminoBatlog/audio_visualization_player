# Audio Ring Visualizer

项目现在包含两条线：

- `Python Bridge`：负责 Windows 输出设备枚举、系统音频 loopback 采集、共享配置存储、当前歌曲元数据同步，以及 WebSocket 频谱推送
- `Web 版本`：负责透明背景可视化和配置页面，并作为 OBS Browser Source 的主要入口

## Main Entry Points

前端工程在 [web](./web) 目录。

主要页面：

- `web/visualizer.html`
- `web/config.html`

本地 bridge 服务入口：

- `bridge_server.py`

当前歌曲元数据 helper：

- `tools/windows_media_session.ps1`

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
- QQ 音乐自动封面与自动主色调
  - 通过 Windows 系统媒体会话识别当前 QQ 音乐歌曲
  - 自动将封面作为中心图
  - 自动从封面提取主色调并覆盖可视化 `accentHue`
  - 未识别到 QQ 音乐或无封面时回退到默认中心图和手动色调

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
- `GET /now-playing`
- `GET /config`
- `POST /config`
- `GET /spectrum?bars=72`
- `POST /device`
- `WebSocket /` 频谱推送

说明：

- `config.html` 会把设置同步到 bridge
- `visualizer.html` 会优先从 bridge 拉共享配置
- `visualizer.html` 会定时读取 `/now-playing`，在自动模式开启时覆盖中心图和主色调
- `Python Bridge` 模式优先使用 WebSocket 推送，失败时回退到 HTTP 读取
- OBS Browser Source 不再依赖普通浏览器的 `localStorage`

如果你修改过 `bridge_server.py` 或 `tools/windows_media_session.ps1`，要先重启 bridge，OBS 才会拿到新接口。

## QQ Music Auto Mode

配置页里新增了 `Auto QQ Music Cover + Tone` 开关。

行为规则：

- 关闭时：始终使用你手动保存的中心图和 `Accent Hue`
- 开启时：如果当前系统媒体会话识别到 QQ 音乐歌曲，则自动使用歌曲封面和封面主色调
- 没有识别到 QQ 音乐或封面缺失时：自动回退到默认中心图和手动色调

注意：

- 当前实现依赖 `Windows PowerShell 5.1` + Windows 系统媒体会话
- 只对识别为 QQ 音乐的媒体会话生效，不会默认接管其他播放器
- 如果你的系统没有可用的系统媒体会话服务，`/now-playing` 会返回不可用状态，但不会影响音频频谱功能

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
4. 需要自动封面时，打开 `Auto QQ Music Cover + Tone`
5. 在 QQ 音乐中开始播放歌曲
6. 在 OBS 中加载 `http://127.0.0.1:5173/visualizer.html` 作为 `Browser Source`

## OBS Direction

当前推荐接入方式：

- 使用 OBS `Browser Source`
- 加载开发环境中的 `visualizer.html`，或构建后的 `web/dist/visualizer.html`

如果后续要进一步增强，可继续做：

- 扩展到非 QQ 音乐播放器
- bridge 自动发现和自动重连
- 输出设备热切换状态提示
