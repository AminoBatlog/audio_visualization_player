# Web Visualizer Plan

## Goal

把当前 Python 桌面原型重构为 `Web 版本音频可视化器`，并让它更适合接入 OBS，而不是继续围绕桌面窗口采集做优化。

目标能力：

- 浏览器内渲染环形音频可视化
- 背景透明，适合直接放进 OBS
- 中心图片可自定义，并在检测到音频时自动旋转
- 提供单独配置页，自定义音频源、视觉参数、图片和旋转速度
- 后续可以方便接入 OBS，而不依赖普通窗口采集

## Product Direction

建议把项目拆成两个前端页面：

- `Visualizer Page`
  - 只负责渲染透明背景的可视化画面
  - 用于独立预览，也用于被 OBS 作为 Browser Source 加载
- `Config Page`
  - 负责所有参数设置
  - 可以本地保存配置
  - 可以控制可视化页面实时更新

这比把设置直接塞在可视化画面里更适合 OBS 场景。

## Recommended Stack

建议改成：

- `Vite`
- `React`
- `TypeScript`
- `Web Audio API`
- `Canvas 2D` 或 `WebGL`

首版建议先用 `Canvas 2D`。

原因：

- 足够做透明背景、环形频谱、图片旋转、玻璃质感
- 实现速度比直接上 WebGL 更快
- 后续如果需要更复杂特效，再升级到 WebGL 或 shader

## OBS Integration Strategy

### Primary Path: Browser Source

这条路线是首选。

根据 OBS 官方文档，`Browser Source` 可以直接加载本地文件，并且默认支持透明背景，还可以指定渲染尺寸和自定义帧率：

- Browser Source: https://obsproject.com/kb/browser-source

这意味着后续可以直接把可视化页面作为本地网页交给 OBS 加载，而不是靠窗口采集。

适合本项目的原因：

- 天然支持透明背景
- 可以直接控制页面尺寸
- 更容易发布和复用
- 后续可以单独给 OBS 提供一个专用页面入口

### Secondary Path: OBS WebSocket

根据 OBS 官方文档，OBS Studio 28 及以上已内置 WebSocket。

- Remote Control Guide: https://obsproject.com/kb/remote-control-guide

这条路线不负责画面渲染，但适合后续扩展：

- 场景切换时同步参数
- 开始录制或直播时自动切换样式
- 从外部控制可视化状态

首版不建议把它作为主接入方式，只建议预留。

### Heavyweight Path: Native OBS Source Plugin

OBS 官方文档支持编写原生插件和 Source。

- Plugins docs: https://docs.obsproject.com/plugins

这条路线后续可以考虑，但不建议作为当前版本目标。

原因：

- 复杂度明显高
- 需要转到 OBS 原生插件开发链路
- 不适合先快速验证视觉与交互

## Architecture

建议重构成下面几个模块：

### 1. Audio Input Layer

负责：

- 选择音频输入来源
- 拉取实时音频数据
- 输出统一频谱输入

候选方案：

- 浏览器内音频文件/麦克风输入
- 系统输出音频桥接

注意：

纯浏览器环境对“直接采集指定系统输出设备”有限制。桌面浏览器里可以通过用户授权采集某些媒体流，但不像 Python + WASAPI loopback 那样天然适合直接绑定任意系统播放设备。

因此建议分两阶段：

- Web 首版先支持浏览器内可行的输入路径和模拟源
- 后续如果必须保留“指定系统输出设备”，再增加本地桥接服务

### 2. Analyzer Layer

负责：

- FFT 频谱分析
- 多频段压缩
- 平滑、归一化、峰值保持
- 音乐活动检测

输出：

- 柱条能量数组
- 总体音量强度
- 是否处于活跃播放状态

### 3. Renderer Layer

负责：

- 透明背景绘制
- 环形柱状频谱
- 玻璃质感、渐变、高光、辉光
- 中心图片旋转

### 4. Config Layer

负责：

- 参数编辑
- 本地持久化
- 实时热更新
- 页面间共享配置

建议本地持久化使用：

- `localStorage`

如果后续需要跨进程同步，再升级。

## Visual Design Direction

目标风格不是纯色柱子，而是：

- 透明背景
- 玻璃或亚克力质感
- 发光但不过分刺眼
- 中心图层与环形柱条统一

建议的视觉组件：

### Background

- 完全透明
- 不要纯色底板
- 仅保留轻微光晕或体积光效果

### Circular Bars

每根柱条建议包含：

- 半透明主体
- 内部纵向渐变
- 外沿高光
- 外圈柔和辉光
- 动态长度和轻微透明波动

### Center Image

建议支持：

- PNG 优先
- 圆形裁切
- 外圈玻璃边框
- 音乐活跃时旋转
- 无音频时缓慢减速或静止

### Motion

建议动画规则：

- 柱条长度跟随频段变化
- 中心图旋转速度跟随音频活跃度或单独配置
- 可选轻微呼吸光晕

## Config Page Requirements

配置页建议至少包含以下设置：

### Audio

- 音频输入源选择
- 输入设备切换
- 是否启用模拟源
- 灵敏度
- 平滑程度

### Bars

- 柱子数量
- 最小长度
- 最大长度倍率
- 半径
- 柱子粗细
- 发光强度
- 颜色主题

### Center Image

- 选择图片
- 图片缩放
- 图片旋转速度
- 是否启用音频驱动旋转
- 图片边框光效强度

### Window / OBS

- 预览尺寸
- 透明度预览
- OBS 推荐分辨率
- 专用 Browser Source 页面入口

## Key Technical Decision

这里有一个关键点需要先定：

### A. 纯 Web 版本

优点：

- 最适合接 OBS Browser Source
- 架构更干净
- 透明背景更自然

缺点：

- “指定系统输出设备采集”不如 Python 版本直接

### B. Web 前端 + 本地桥接服务

结构：

- Web 负责渲染和配置
- 本地 Python 服务负责枚举设备和系统音频采集
- Web 通过 WebSocket 或本地 HTTP 读取频谱数据

优点：

- 保留你要的“指定输出设备”能力
- 也保留 Web + OBS 的优势

缺点：

- 架构更复杂
- 需要同时维护前端和本地服务

### Recommendation

我建议采用 `B`，但分阶段做：

- 首先完成纯 Web 渲染和配置页
- 然后再把现有 Python 采集能力改造成一个本地桥接服务

这样不会一开始就把系统做复杂，但也不会丢掉你最初最在意的“自定义音频输出设备”能力。

## Implementation Phases

### Phase 1: Web Skeleton

目标：

搭出可运行的 Web 项目骨架。

内容：

- Vite + React + TypeScript 初始化
- 两个页面：`/visualizer` 和 `/config`
- 配置模型定义
- 本地持久化
- Canvas 渲染基础循环

### Phase 2: Visual Upgrade

目标：

把可视化做成你要的透明玻璃质感。

内容：

- 透明背景
- 环形柱条
- 玻璃渐变与辉光
- 中心图层
- 音频驱动旋转动画

### Phase 3: Config UI

目标：

让所有关键参数都能在配置页里调。

内容：

- 图片选择
- 旋转速度
- 柱长倍率
- 半径、数量、粗细
- 灵敏度和平滑参数
- 主题参数

### Phase 4: Audio Integration

目标：

先接可在 Web 环境稳定工作的音频输入。

内容：

- 演示信号源
- 浏览器音频输入
- 基础分析链

### Phase 5: Local Bridge For System Output

目标：

把“指定系统输出设备”能力接回来。

内容：

- 将当前 Python 采集逻辑改造成本地服务
- 暴露设备列表接口
- 向 Web 页面推送频谱数据
- 配置页可选择目标输出设备

### Phase 6: OBS Packaging

目标：

让项目能直接作为 OBS Browser Source 使用。

内容：

- 提供固定入口页面
- 提供 OBS 推荐尺寸说明
- 适配透明背景
- 适配 OBS 刷新帧率

## Deliverables

如果你确认按这个计划做，建议交付顺序如下：

1. `Web 可视化页面`
2. `Web 配置页面`
3. `透明玻璃质感视觉版本`
4. `中心图片旋转功能`
5. `Web 音频分析输入`
6. `Python 本地桥接服务`
7. `OBS Browser Source 接入说明`

## Risks

### 1. System Audio Capture In Browser

浏览器端不能直接等价替代 Python 的 WASAPI loopback 能力。

这是这次改成 Web 架构后最大的技术风险。

### 2. Transparent Rendering Consistency In OBS

虽然 OBS Browser Source 支持透明背景，但不同视觉特效在 OBS 的实际表现和普通浏览器里可能会有细节差异，需要实际调试。

### 3. Performance

如果玻璃质感、辉光、模糊和旋转效果叠加太多，OBS 中会增加渲染负担。

首版应优先控制：

- 粒度
- 模糊次数
- 柱条数量
- 动画复杂度

## Recommended Next Step

如果你确认这份计划，我建议实际编码顺序先做：

1. Web 项目骨架
2. `/visualizer` 透明环形频谱页面
3. `/config` 配置页面
4. 中心图片旋转
5. 再决定是否立即接 Python 本地桥接服务
