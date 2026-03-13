# Audio Player Visualizer Implementation Plan

## Goal

做一个 Windows 桌面小软件，能够：

- 选择或指定音频输出设备
- 采集该设备正在播放的系统音频
- 在窗口中央显示一个环形跳动频谱
- 跟随音量和频段变化实时动画

## Scope

首版只做最小可用版本，不先做复杂播放器功能。

包含：

- 输出设备列表与切换
- 开始/停止采集
- 环形频谱可视化
- 基础参数调节
  - 柱条数量
  - 半径
  - 灵敏度
  - 平滑程度
- 错误提示和无信号状态

暂不包含：

- 本地音乐文件播放
- 歌词
- 皮肤系统
- 录制导出视频
- 多窗口和插件机制

## Recommended Stack

建议先用 Python 做最小版本：

- `tkinter`：桌面窗口和基础控件
- `numpy`：FFT 频谱分析
- `soundcard`：Windows WASAPI loopback 采集输出设备音频

## Python Environment Requirement

如果使用 Python，必须在当前项目目录中创建并使用本地虚拟环境，不直接使用系统 Python 作为项目运行环境。

固定约束：

- 虚拟环境路径：`.venv`
- 所有依赖安装到 `.venv` 内
- 所有运行、测试、安装命令都基于 `.venv` 执行

标准流程：

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python app.py
```

说明：

- 系统 Python 只用于创建 `.venv`
- 项目启动后不再依赖系统环境中的已安装包
- 后续文档、脚本和启动方式都应默认指向 `.venv`

这样做的原因：

- 当前环境已有 Python 和 `numpy`
- `tkinter` 是内置的，先不引入 GUI 重依赖
- Windows 输出设备 loopback 采集用 `soundcard` 路线更直接

## Architecture

建议拆成下面几层：

### 1. UI Layer

负责：

- 主窗口
- 设备下拉框
- 启停按钮
- 参数面板
- 画布渲染

### 2. Audio Capture Layer

负责：

- 枚举输出设备
- 按设备启动 loopback 采集
- 输出固定大小音频帧

接口建议：

```python
list_output_devices() -> list[str]
start_capture(device_name: str) -> None
read_frames() -> np.ndarray
stop_capture() -> None
```

### 3. Signal Processing Layer

负责：

- 单声道混合
- 窗函数
- FFT
- 频段压缩
- 平滑和归一化

输出：

- 一组用于绘制柱条的幅值数组

### 4. Renderer Layer

负责：

- 将幅值映射为圆周上的柱条长度
- 计算角度、内半径、外半径
- 绘制中心圆和环形柱条

## Rendering Plan

环形频谱建议这样做：

- 以窗口中心为圆心
- 将 48 到 96 根柱条均匀排布在圆周上
- 每根柱条长度由对应频段能量决定
- 使用平滑衰减，避免抖动过硬
- 中心保留一个空心圆，让视觉更干净

可选视觉增强：

- 按频段渐变着色
- 峰值保持
- 低频额外增益
- 音量驱动中心光晕

## Implementation Phases

### Phase 1

先做假数据驱动的界面原型：

- 主窗口
- 环形可视化
- 启停按钮
- 参数调节
- 用随机或正弦数据驱动动画

目的：

- 先把视觉和刷新机制跑通

### Phase 2

接入真实音频分析链：

- 加入音频帧缓冲
- FFT
- 频段聚合
- 平滑和归一化

目的：

- 让可视化逻辑独立于具体采集源

### Phase 3

接入 Windows 输出设备采集：

- 枚举输出设备
- 选择指定设备
- 用 loopback 读取系统输出音频

目的：

- 真正实现“根据设定的音频输出设备进行跳动”

### Phase 4

做稳定性和体验收尾：

- 设备断开恢复
- 无音频时降载
- 错误提示
- 配置持久化

## Key Risks

### 1. Device Capture Compatibility

Windows 输出设备采集依赖 WASAPI loopback。

风险：

- 个别设备名显示不一致
- 蓝牙设备切换时可能失效
- 默认设备变化后需要重新绑定

### 2. Dependency Installation

`soundcard` 不是当前环境自带。

风险：

- 安装依赖需要网络和本机环境配合
- 如果安装失败，需要换到其他采集方案

### 3. UI Refresh Rate

如果刷新过高，CPU 占用会上升。

控制方式：

- 默认 30 到 60 FPS
- 音频分析与绘制分离
- 柱条数量不要一开始就拉太高

## Fallback Options

如果 `soundcard` 路线不通，可切换：

### Option A

改用 Electron + WebAudio + 原生音频采集桥接。

优点：

- 界面更自由

缺点：

- 复杂度明显更高

### Option B

改用 PySide6。

优点：

- 绘制能力和界面表现更强

缺点：

- 需要额外安装较大的 GUI 依赖

## Deliverables

如果你确认开始实施，我建议交付顺序是：

1. 可运行的原型窗口
2. 环形频谱动画
3. 真实设备枚举与采集
4. 参数调节和配置保存
5. 打包说明

## Recommended Next Step

如果你认可这个方向，我下一步会先实现 `Phase 1 + Phase 2`：

- 先把界面和频谱链做实
- 再单独接入设备采集层

这样即使采集依赖暂时没装好，核心可视化软件也已经成型。
