// Package config 负责配置的加载、保存、默认值与合法性钳制。
// 设计见 docs/开发文档.md §4.1 与 docs/contracts/api-v1.1.md §1。
// v1.1 新增 notify/schedules/selfcheck/digest/bot 结构与 camera.sub_rtsp、motion.rois。
// 所有字段必须 yaml+json 双 tag（历史 bug: 缺 json tag 导致 API 提交字段解码为 0）。
package config

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// CameraType 取流来源类型（camera.type 合法值）。
const (
	TypeSynthetic = "synthetic"
	TypeRTSP      = "rtsp"
	TypeFile      = "file"
	TypeDShow     = "dshow"
)

// 默认值(v1.1 新增部分)。
const (
	DefaultBarkServer = "https://api.day.app"
	DefaultDigestTime = "22:00"
	MaxROIs           = 8
	MaxScheduleRules  = 16
)

type Config struct {
	Camera    CameraConfig    `yaml:"camera" json:"camera"`
	Record    RecordConfig    `yaml:"record" json:"record"`
	Motion    MotionConfig    `yaml:"motion" json:"motion"`
	Server    ServerConfig    `yaml:"server" json:"server"`
	Notify    NotifyConfig    `yaml:"notify" json:"notify"`
	Schedules SchedulesConfig `yaml:"schedules" json:"schedules"`
	SelfCheck SelfCheckConfig `yaml:"selfcheck" json:"selfcheck"`
	Digest    DigestConfig    `yaml:"digest" json:"digest"`
	Bot       BotConfig       `yaml:"bot" json:"bot"`
}

type CameraConfig struct {
	Name           string `yaml:"name" json:"name"`
	Type           string `yaml:"type" json:"type"` // synthetic | rtsp | file | dshow
	RTSP           string `yaml:"rtsp" json:"rtsp"`
	SubRTSP        string `yaml:"sub_rtsp" json:"sub_rtsp"` // 子码流(预览+检测解码用); 空=用主码流
	File           string `yaml:"file" json:"file"`
	DShowDevice    string `yaml:"dshow_device" json:"dshow_device"`
	Width          int    `yaml:"width" json:"width"`
	Height         int    `yaml:"height" json:"height"`
	FPS            int    `yaml:"fps" json:"fps"`
	ReconnectDelay int    `yaml:"reconnect_delay_sec" json:"reconnect_delay_sec"`
}

type RecordConfig struct {
	Enabled        bool    `yaml:"enabled" json:"enabled"`
	Dir            string  `yaml:"dir" json:"dir"`
	SegmentSeconds int     `yaml:"segment_seconds" json:"segment_seconds"`
	RetentionDays  int     `yaml:"retention_days" json:"retention_days"`
	MaxDiskGB      float64 `yaml:"max_disk_gb" json:"max_disk_gb"`
}

// ROI 归一化检测区域矩形, 值域 [0,1]; w/h > 0。
//
// 在 YAML 与 JSON 中统一序列化为 [x,y,w,h] 四元数组(契约 §1 的 `[[x,y,w,h],...]`、
// §3.2 的 config.motion.rois), 前端 Roi 类型同为四元组。自定义编解码放在这里,
// 避免前后端对 ROI 形态各写一套而静默分叉(集成时曾出现: 后端发对象/前端发数组,
// 保存 ROI 直接 400)。
type ROI struct {
	X float64
	Y float64
	W float64
	H float64
}

// roiToSlice 供 YAML/JSON 编码复用。
func (r ROI) roiToSlice() []float64 { return []float64{r.X, r.Y, r.W, r.H} }

// roiFromSlice 校验并写入四元数组。
func (r *ROI) roiFromSlice(v []float64) error {
	if len(v) != 4 {
		return fmt.Errorf("roi 需为 [x,y,w,h] 四元数组, 实际 %d 个元素", len(v))
	}
	r.X, r.Y, r.W, r.H = v[0], v[1], v[2], v[3]
	return nil
}

// MarshalJSON 输出 [x,y,w,h]。
func (r ROI) MarshalJSON() ([]byte, error) { return json.Marshal(r.roiToSlice()) }

// UnmarshalJSON 只接受 [x,y,w,h]。
func (r *ROI) UnmarshalJSON(b []byte) error {
	var v []float64
	if err := json.Unmarshal(b, &v); err != nil {
		return fmt.Errorf("roi 需为 [x,y,w,h] 数组: %w", err)
	}
	return r.roiFromSlice(v)
}

// MarshalYAML 输出 [x,y,w,h]。
func (r ROI) MarshalYAML() (any, error) { return r.roiToSlice(), nil }

// UnmarshalYAML 只接受 [x,y,w,h]。
func (r *ROI) UnmarshalYAML(value *yaml.Node) error {
	var v []float64
	if err := value.Decode(&v); err != nil {
		return fmt.Errorf("roi 需为 [x,y,w,h] 数组: %w", err)
	}
	return r.roiFromSlice(v)
}

type MotionConfig struct {
	Enabled        bool  `yaml:"enabled" json:"enabled"`
	Threshold      int   `yaml:"threshold" json:"threshold"` // 像素差阈值, 越小越灵敏
	MinArea        int   `yaml:"min_area" json:"min_area"`   // 降采样图上触发像素数
	CooldownSec    int   `yaml:"cooldown_sec" json:"cooldown_sec"`
	DownscaleWidth int   `yaml:"downscale_width" json:"downscale_width"`
	ROIs           []ROI `yaml:"rois" json:"rois"` // 归一化矩形; 空=全屏
}

type ServerConfig struct {
	Host        string `yaml:"host" json:"host"`
	Port        int    `yaml:"port" json:"port"`
	DataDir     string `yaml:"data_dir" json:"data_dir"`
	SnapshotDir string `yaml:"snapshot_dir" json:"snapshot_dir"`
}

type DingTalkConfig struct {
	Enabled bool   `yaml:"enabled" json:"enabled"`
	Webhook string `yaml:"webhook" json:"webhook"`
	Secret  string `yaml:"secret" json:"secret"` // 加签密钥
}

type WecomConfig struct {
	Enabled bool   `yaml:"enabled" json:"enabled"`
	Webhook string `yaml:"webhook" json:"webhook"`
}

type TelegramConfig struct {
	Enabled  bool   `yaml:"enabled" json:"enabled"`
	BotToken string `yaml:"bot_token" json:"bot_token"`
	ChatID   string `yaml:"chat_id" json:"chat_id"`
}

type BarkConfig struct {
	Enabled   bool   `yaml:"enabled" json:"enabled"`
	Server    string `yaml:"server" json:"server"`
	DeviceKey string `yaml:"device_key" json:"device_key"`
}

type WebhookConfig struct {
	Enabled bool   `yaml:"enabled" json:"enabled"`
	URL     string `yaml:"url" json:"url"`
	Secret  string `yaml:"secret" json:"secret"`
}

type NotifyConfig struct {
	CooldownSec int            `yaml:"cooldown_sec" json:"cooldown_sec"` // 同一通道最小推送间隔
	DingTalk    DingTalkConfig `yaml:"dingtalk" json:"dingtalk"`
	Wecom       WecomConfig    `yaml:"wecom" json:"wecom"`
	Telegram    TelegramConfig `yaml:"telegram" json:"telegram"`
	Bark        BarkConfig     `yaml:"bark" json:"bark"`
	Webhook     WebhookConfig  `yaml:"webhook" json:"webhook"`
}

// ScheduleRule 一条布防日程。days: 1=周一 ... 7=周日; 空=每天。
// start==end 视为全天; end<start 跨零点。
type ScheduleRule struct {
	Days   []int  `yaml:"days" json:"days"`
	Start  string `yaml:"start" json:"start"`
	End    string `yaml:"end" json:"end"`
	Motion bool   `yaml:"motion" json:"motion"`
	Record bool   `yaml:"record" json:"record"`
}

type SchedulesConfig struct {
	Rules []ScheduleRule `yaml:"rules" json:"rules"` // 空=全天按 motion.enabled/record.enabled
}

type SelfCheckConfig struct {
	Enabled         bool `yaml:"enabled" json:"enabled"`
	IntervalSec     int  `yaml:"interval_sec" json:"interval_sec"`
	FrozenChecks    int  `yaml:"frozen_checks" json:"frozen_checks"`
	ChangeThreshold int  `yaml:"change_threshold" json:"change_threshold"`
	ChangeChecks    int  `yaml:"change_checks" json:"change_checks"`
}

type DigestConfig struct {
	Enabled bool   `yaml:"enabled" json:"enabled"`
	Time    string `yaml:"time" json:"time"` // 每天该时刻推送 HH:MM
}

type BotConfig struct {
	Enabled      bool     `yaml:"enabled" json:"enabled"`
	BotToken     string   `yaml:"bot_token" json:"bot_token"`
	AllowedUsers []string `yaml:"allowed_users" json:"allowed_users"` // Telegram 数字用户ID白名单; 空=拒绝所有
}

// View 是 GET/POST /api/config 的请求/响应体(全量, 不含 server——server 不暴露给面板)。
// camera 可写: 保存到配置文件, 但运行中的取流不热更, 需重启生效(契约 §2.7)。
type View struct {
	Camera    CameraConfig    `json:"camera"`
	Motion    MotionConfig    `json:"motion"`
	Record    RecordConfig    `json:"record"`
	Notify    NotifyConfig    `json:"notify"`
	Schedules SchedulesConfig `json:"schedules"`
	SelfCheck SelfCheckConfig `json:"selfcheck"`
	Digest    DigestConfig    `json:"digest"`
	Bot       BotConfig       `json:"bot"`
}

// View 返回 API 视图。
func (c *Config) View() View {
	return View{
		Camera:    c.Camera,
		Motion:    c.Motion,
		Record:    c.Record,
		Notify:    c.Notify,
		Schedules: c.Schedules,
		SelfCheck: c.SelfCheck,
		Digest:    c.Digest,
		Bot:       c.Bot,
	}
}

// ApplyView 用视图覆盖配置(server 除外)。
func (c *Config) ApplyView(v View) {
	c.Camera = v.Camera
	c.Motion = v.Motion
	c.Record = v.Record
	c.Notify = v.Notify
	c.Schedules = v.Schedules
	c.SelfCheck = v.SelfCheck
	c.Digest = v.Digest
	c.Bot = v.Bot
}

// Default 返回文档规定的默认配置。
func Default() *Config {
	return &Config{
		Camera: CameraConfig{
			Name:           "模拟摄像头",
			Type:           TypeSynthetic,
			Width:          1280,
			Height:         720,
			FPS:            25,
			ReconnectDelay: 3,
		},
		Record: RecordConfig{
			Enabled:        true,
			Dir:            "recordings",
			SegmentSeconds: 600,
			RetentionDays:  7,
			MaxDiskGB:      20,
		},
		Motion: MotionConfig{
			Enabled:        true,
			Threshold:      22,
			MinArea:        500,
			CooldownSec:    8,
			DownscaleWidth: 320,
			ROIs:           []ROI{},
		},
		Server: ServerConfig{
			Host:        "127.0.0.1",
			Port:        8787,
			DataDir:     "data",
			SnapshotDir: "snapshots",
		},
		Notify: NotifyConfig{
			CooldownSec: 60,
			Bark:        BarkConfig{Server: DefaultBarkServer},
		},
		Schedules: SchedulesConfig{Rules: []ScheduleRule{}},
		SelfCheck: SelfCheckConfig{
			Enabled:         true,
			IntervalSec:     300,
			FrozenChecks:    3,
			ChangeThreshold: 25,
			ChangeChecks:    3,
		},
		Digest: DigestConfig{Enabled: true, Time: DefaultDigestTime},
		Bot:    BotConfig{AllowedUsers: []string{}},
	}
}

// Load 读取 YAML 配置; 文件不存在时生成默认配置文件。
func Load(path string) (*Config, error) {
	c := Default()
	data, err := os.ReadFile(path)
	if err != nil {
		if !os.IsNotExist(err) {
			return nil, fmt.Errorf("读取配置: %w", err)
		}
		if err := Save(path, c); err != nil {
			return nil, fmt.Errorf("生成默认配置: %w", err)
		}
		return c, nil
	}
	if err := yaml.Unmarshal(data, c); err != nil {
		return nil, fmt.Errorf("解析配置 %s: %w", path, err)
	}
	c.Sanitize()
	return c, nil
}

// Save 原子写配置(临时文件 + rename), 写入前先钳制。
func Save(path string, c *Config) error {
	c.Sanitize()
	data, err := yaml.Marshal(c)
	if err != nil {
		return fmt.Errorf("序列化配置: %w", err)
	}
	if dir := filepath.Dir(path); dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// Sanitize 将非法值钳制到契约 §1 规定的范围; nil 切片回填为空切片(JSON 输出 [] 而非 null)。
func (c *Config) Sanitize() {
	switch c.Camera.Type {
	case TypeSynthetic, TypeRTSP, TypeFile, TypeDShow:
	default:
		c.Camera.Type = TypeSynthetic
	}
	if c.Camera.Name == "" {
		c.Camera.Name = "摄像头"
	}
	c.Camera.Width = clampInt(c.Camera.Width, 320, 3840)
	c.Camera.Height = clampInt(c.Camera.Height, 240, 2160)
	c.Camera.FPS = clampInt(c.Camera.FPS, 1, 60)
	c.Camera.ReconnectDelay = clampInt(c.Camera.ReconnectDelay, 1, 300)

	if c.Record.Dir == "" {
		c.Record.Dir = "recordings"
	}
	c.Record.SegmentSeconds = clampInt(c.Record.SegmentSeconds, 10, 86400)
	c.Record.RetentionDays = clampInt(c.Record.RetentionDays, 1, 365)
	c.Record.MaxDiskGB = clampFloat(c.Record.MaxDiskGB, 0.1, 10000)

	c.Motion.Threshold = clampInt(c.Motion.Threshold, 1, 255)
	c.Motion.MinArea = clampInt(c.Motion.MinArea, 1, 1000000)
	c.Motion.CooldownSec = clampInt(c.Motion.CooldownSec, 1, 3600)
	c.Motion.DownscaleWidth = clampInt(c.Motion.DownscaleWidth, 64, 1280)
	c.Motion.ROIs = sanitizeROIs(c.Motion.ROIs)

	if c.Server.Host == "" {
		c.Server.Host = "127.0.0.1"
	}
	c.Server.Port = clampInt(c.Server.Port, 1, 65535)
	if c.Server.DataDir == "" {
		c.Server.DataDir = "data"
	}
	if c.Server.SnapshotDir == "" {
		c.Server.SnapshotDir = "snapshots"
	}

	c.Notify.CooldownSec = clampInt(c.Notify.CooldownSec, 10, 3600)
	if c.Notify.Bark.Server == "" {
		c.Notify.Bark.Server = DefaultBarkServer
	}

	c.Schedules.Rules = sanitizeRules(c.Schedules.Rules)

	c.SelfCheck.IntervalSec = clampInt(c.SelfCheck.IntervalSec, 60, 3600)
	c.SelfCheck.FrozenChecks = clampInt(c.SelfCheck.FrozenChecks, 1, 60)
	c.SelfCheck.ChangeChecks = clampInt(c.SelfCheck.ChangeChecks, 1, 60)
	c.SelfCheck.ChangeThreshold = clampInt(c.SelfCheck.ChangeThreshold, 1, 255)

	if _, ok := ParseHHMM(c.Digest.Time); !ok {
		c.Digest.Time = DefaultDigestTime
	}

	users := make([]string, 0, len(c.Bot.AllowedUsers))
	for _, u := range c.Bot.AllowedUsers {
		u = strings.TrimSpace(u)
		if u == "" {
			continue
		}
		if _, err := strconv.ParseInt(u, 10, 64); err != nil {
			continue // 白名单只收数字用户 ID
		}
		users = append(users, u)
	}
	c.Bot.AllowedUsers = users
}

// sanitizeROIs 钳制归一化矩形: 值域 [0,1], w/h>0, 最多 8 个。
// 裁剪结果四舍五入到 4 位小数, 避免浮点误差写入配置。
func sanitizeROIs(rois []ROI) []ROI {
	out := make([]ROI, 0, len(rois))
	for _, r := range rois {
		r.X = round4(clampFloat(r.X, 0, 1))
		r.Y = round4(clampFloat(r.Y, 0, 1))
		r.W = round4(clampFloat(r.W, 0, 1))
		r.H = round4(clampFloat(r.H, 0, 1))
		if r.X+r.W > 1 {
			r.W = round4(1 - r.X)
		}
		if r.Y+r.H > 1 {
			r.H = round4(1 - r.Y)
		}
		if r.X+r.W > 1 {
			r.W = 1 - r.X
		}
		if r.Y+r.H > 1 {
			r.H = 1 - r.Y
		}
		if r.W <= 0 || r.H <= 0 {
			continue
		}
		out = append(out, r)
		if len(out) >= MaxROIs {
			break
		}
	}
	return out
}

// sanitizeRules 钳制日程规则: 最多 16 条, start/end 必须是合法 HH:MM(非法整条丢弃),
// 时间归一化为零填充格式, days 只保留 1~7(原非空过滤后为空则整条丢弃)。
func sanitizeRules(rules []ScheduleRule) []ScheduleRule {
	out := make([]ScheduleRule, 0, len(rules))
	for _, r := range rules {
		sm, okS := ParseHHMM(r.Start)
		em, okE := ParseHHMM(r.End)
		if !okS || !okE {
			continue
		}
		r.Start, r.End = FormatHHMM(sm), FormatHHMM(em)
		if len(r.Days) > 0 {
			days := make([]int, 0, len(r.Days))
			for _, d := range r.Days {
				if d >= 1 && d <= 7 {
					days = append(days, d)
				}
			}
			if len(days) == 0 {
				continue
			}
			r.Days = days
		}
		out = append(out, r)
		if len(out) >= MaxScheduleRules {
			break
		}
	}
	return out
}

// ActiveAt 评估 t 时刻日程是否放行移动侦测与录像。
// 规则为空 = 全天放行(按 motion.enabled/record.enabled 各自开关)。
// 多条规则同时命中按 OR 合并。
func (s SchedulesConfig) ActiveAt(t time.Time) (motion, record bool) {
	if len(s.Rules) == 0 {
		return true, true
	}
	day := weekdayNum(t)
	minutes := t.Hour()*60 + t.Minute()
	for _, r := range s.Rules {
		if !ruleHits(r, day, minutes) {
			continue
		}
		motion = motion || r.Motion
		record = record || r.Record
	}
	return motion, record
}

func ruleHits(r ScheduleRule, day, minutes int) bool {
	sm, okS := ParseHHMM(r.Start)
	em, okE := ParseHHMM(r.End)
	if !okS || !okE {
		return false
	}
	switch {
	case sm == em: // 全天
		return dayIn(r.Days, day)
	case sm < em:
		return dayIn(r.Days, day) && minutes >= sm && minutes < em
	default: // 跨零点: 前半段属当日, 后半段属前一日
		return (dayIn(r.Days, day) && minutes >= sm) ||
			(dayIn(r.Days, prevDay(day)) && minutes < em)
	}
}

// weekdayNum 1=周一 ... 7=周日。
func weekdayNum(t time.Time) int {
	return (int(t.Weekday())+6)%7 + 1
}

func prevDay(d int) int {
	if d <= 1 {
		return 7
	}
	return d - 1
}

func dayIn(days []int, d int) bool {
	if len(days) == 0 {
		return true // 空=每天
	}
	for _, x := range days {
		if x == d {
			return true
		}
	}
	return false
}

// ParseHHMM 解析 "HH:MM" 或 "H:MM", 返回当日分钟数。
func ParseHHMM(s string) (int, bool) {
	parts := strings.Split(strings.TrimSpace(s), ":")
	if len(parts) != 2 {
		return 0, false
	}
	h, err1 := strconv.Atoi(parts[0])
	m, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil || h < 0 || h > 23 || m < 0 || m > 59 {
		return 0, false
	}
	return h*60 + m, true
}

// FormatHHMM 分钟数 → "HH:MM"。
func FormatHHMM(minutes int) string {
	return fmt.Sprintf("%02d:%02d", minutes/60, minutes%60)
}

func round4(v float64) float64 {
	return math.Round(v*10000) / 10000
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func clampFloat(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
