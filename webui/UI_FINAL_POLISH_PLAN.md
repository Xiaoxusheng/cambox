# UI_FINAL_POLISH_PLAN — v1.4.4 Final Polish

> 审计方式：grep 全源码核实（backdrop-blur / 半透明 Surface / 无 size 的 Arco Button /
> status=danger Button / 任意值字号 / 硬编码色）。架构、主题系统、API 一律不动。

## 审计结论（对任务书指控的核实）

| 指控 | 核实结果 |
|---|---|
| P0-1 Settings 保存条玻璃感 | **已不成立**（v1.4.3 已改实底 + border-t）；本轮补「通栏 full-bleed」 |
| P0-3 BottomNav 玻璃 | **成立**：`bg-cam-bg/90 + backdrop-blur-sm` → 改实底 |
| P0-4 Danger Zone 中英混杂 | **成立**：导航与分区标题均为 "Danger Zone" → 改「危险操作」 |
| P0-7 ChannelSection 像小 Card | **不成立**（已是 border-b 行式）；保持 |
| P0-8/9 按钮色彩/尺寸不统一 | **部分成立**：Events「删除选中」为红色 Arco 按钮（36px）且常驻 → 改为选中后出现的 quiet danger 选择工具条；Monitor 抓拍弹窗「关闭」无 size |
| §16 缩略图移动端 | **成立**：Events 缩略图 <sm 隐藏 → 改为始终可见（mobile 56×36，desktop 80×40） |
| §17 选中工具条 | **成立**：无 → 补「已选择 N 条 / 取消选择 / 删除」 |
| §19 Drawer 移动端宽度 | **成立**：固定 440px 会超出 390 屏 → 移动端 100% |
| §21 hover chip 裁切 | **成立**：left 0%/100% 时被裁 → clamp |
| §23 时间轴移动端标签 | **成立**：7 个标签在 390px 过挤 → 移动端只显示 00/08/16/24 |
| §24 播放控制移动端折行 | **成立**：改为 移动两行（Play/Time/Fullscreen + Slider/Speed） |
| §31 Recordings 搜索/操作 | **成立**：SearchInput 240px + 移动全宽；Play/Download/Delete 改 IconButton |
| §33 Logs 移动端网格 | **成立**：移动端 64/48 列 + 11px 字号 |
| §40 Monitor 事件栏 320px | **成立**：1440 下改 300px（2xl 320）；移动事件区 max-h 360px |
| §45 TopBar Mobile | **成立**：移动端隐藏 REC/Armed，功能移入导航 Drawer（不删功能） |
| §51 任意值 | **部分成立**：h-[45px]/w-[80px] → h-10/w-20 等标准档；规格值（30/52/220/1500）保留 |
| Save bar 玻璃/Panel 复活/Arco Table | 不成立，无动作 |

## P0（必须修）
1. BottomNav 实底化（去 bg/90 + blur）。
2. Settings：Danger Zone → 「危险操作」（导航 + Section 标题）；保存条通栏（-mx 对齐断点）；
   Row 移动端改纵向堆叠（Title/Desc/Control），FIELD_* 常量加 `w-full sm:*` 响应式。
3. Events：选择工具条（selected>0 时出现：已选择 N 条 · 取消选择 · 删除，quiet danger）；
   页头红色 Arco 按钮移除；缩略图移动端可见（56×36 / sm 80×40，标准档类名）；
   Drawer 移动端 width 100%（桌面 440）。
4. Playback：hover chip clamp（不裁切）；时间轴标签移动端只显示 00/08/16/24；
   控制条移动端两行（Play/Time/Fullscreen + Slider/Speed）。
5. TopBar：移动端隐藏 REC/Armed；提取 StatusActions 组件复用，导航 Drawer 增加状态操作区（功能不丢）。
6. 全站 Arco Button 尺寸审计：显式 size="small"（28px）补齐。

## P1（应该修）
7. Recordings：Play/Download/Delete → IconButton（tooltip）；搜索 240px + 移动全宽。
8. Logs：移动端 grid 64/48 + 11px；行 hover 保持。
9. Monitor：事件栏 300px（2xl 320）；移动事件区 max-h-[360px]；HUD 底 black/45→40。
10. CommandMenu：外层 px-3（移动 100vw-24）。
11. Overview：最新事件列表用 EventList compact（缩略图更小、行更紧）。

## P2（可选修）
12. tokens.css：Arco 输入字号统一 13px（与 body 一致）。
13. 任意值清理：h-[45px]/w-[80px] 等换标准档（规格值 30/52/220/1500 保留）。

## 不做
- 不恢复 Panel/Card；不引入 Arco Table；不改 API/后端/mock；
- 视频叠层（HUD/ROI/黑底）的白名单玻璃与硬编码色保留；
- Modal.confirm 的红色确认按钮保留（对话框主危险操作惯例）。

## 验证
npm run build + go build + webdist 内嵌；浏览器 Dark/Light × 7 页 + 390/768/1280/1440 走查；
Console 0 error；Monitor 轮询/Logs SSE/Playback 播放不受影响。
