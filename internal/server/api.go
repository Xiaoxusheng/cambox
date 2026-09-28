package server

import (
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"time"

	"camhub/internal/config"
	"camhub/internal/imgconv"
	"camhub/internal/selfcheck"
	"camhub/internal/source"
	"camhub/internal/store"
)

// ---- 统一响应结构 ----

type apiResponse struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data"`
}

func writeJSON(w http.ResponseWriter, httpCode, code int, msg string, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(httpCode)
	_ = json.NewEncoder(w).Encode(apiResponse{Code: code, Message: msg, Data: data})
}

func writeOK(w http.ResponseWriter, data any) {
	writeJSON(w, http.StatusOK, 0, "success", data)
}

func writeErr(w http.ResponseWriter, httpCode int, msg string) {
	writeJSON(w, httpCode, httpCode, msg, nil)
}

// ---- 状态 DTO ----

type cameraStatus struct {
	Name      string  `json:"name"`
	Type      string  `json:"type"`
	Connected bool    `json:"connected"`
	FPS       float64 `json:"fps"`
	Width     int     `json:"width"`
	Height    int     `json:"height"`
	Restarts  int64   `json:"restarts"`
	LastError string  `json:"last_error,omitempty"`
}

type recorderStatus struct {
	Enabled     bool   `json:"enabled"`
	Running     bool   `json:"running"`
	Mode        string `json:"mode"`
	CurrentFile string `json:"current_file"`
	LastErr     string `json:"last_error,omitempty"`
}

type motionStatus struct {
	Enabled bool `json:"enabled"`
}

type diskStatus struct {
	RecordingsBytes int64   `json:"recordings_bytes"`
	SnapshotsBytes  int64   `json:"snapshots_bytes"`
	MaxGB           float64 `json:"max_gb"`
}

// scheduleActiveStatus 当前时刻日程放行情况(契约 §3.2)。
type scheduleActiveStatus struct {
	Motion bool `json:"motion"`
	Record bool `json:"record"`
}

type statusResponse struct {
	Time           time.Time            `json:"time"`
	UptimeSec      float64              `json:"uptime_sec"`
	Camera         cameraStatus         `json:"camera"`
	Recorder       recorderStatus       `json:"recorder"`
	Motion         motionStatus         `json:"motion"`
	Disk           diskStatus           `json:"disk"`
	EventsCount    int                  `json:"events_count"`
	FFmpegLog      []string             `json:"ffmpeg_log"`
	Armed          bool                 `json:"armed"`
	ScheduleActive scheduleActiveStatus `json:"schedule_active"`
	SelfCheck      selfcheck.State      `json:"selfcheck"`
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	cfg := s.pl.Settings()
	stats := s.pl.Source().Stats()
	rec := s.pl.Recorder().Status()
	recBytes, snapBytes := s.disk.get(cfg.Record.Dir, cfg.Server.SnapshotDir, 30*time.Second)
	schedMotion, schedRecord := s.pl.ScheduleActive()

	writeOK(w, statusResponse{
		Time:      time.Now(),
		UptimeSec: time.Since(s.pl.StartedAt()).Seconds(),
		Camera: cameraStatus{
			Name:      cfg.Camera.Name,
			Type:      cfg.Camera.Type,
			Connected: stats.Connected,
			FPS:       stats.FPS,
			Width:     stats.Width,
			Height:    stats.Height,
			Restarts:  stats.Restarts,
			LastError: stats.LastError,
		},
		Recorder: recorderStatus(rec),
		Motion:   motionStatus{Enabled: cfg.Motion.Enabled},
		Disk: diskStatus{
			RecordingsBytes: recBytes,
			SnapshotsBytes:  snapBytes,
			MaxGB:           cfg.Record.MaxDiskGB,
		},
		EventsCount:    s.st.Count(),
		FFmpegLog:      stats.Log,
		Armed:          s.pl.Armed(),
		ScheduleActive: scheduleActiveStatus{Motion: schedMotion, Record: schedRecord},
		SelfCheck:      s.pl.SelfCheck().State(),
	})
}

// ---- 实时画面 ----

// previewInterval 由 camera.preview_fps 换算 MJPEG 推送间隔。
// 这是**预览**帧率上限, 不是录像帧率(录像帧率由源本身决定); 面板文案要如实说明。
func previewInterval(cfg config.Config) time.Duration {
	fps := cfg.Camera.PreviewFPS
	if fps <= 0 {
		fps = config.DefaultPreviewFPS
	}
	if fps > 30 {
		fps = 30
	}
	return time.Second / time.Duration(fps)
}

func (s *Server) handleMJPEG(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeErr(w, http.StatusInternalServerError, "连接不支持流式输出")
		return
	}
	w.Header().Set("Content-Type", "multipart/x-mixed-replace; boundary=frame")
	w.Header().Set("Cache-Control", "no-store")

	// v1.2: 帧率上限由 camera.preview_fps 决定, 且热更新即时生效 ——
	// 每拍都读一次配置并在变化时 Reset ticker, 这样在设置页改帧率不必重开页面。
	interval := previewInterval(s.pl.Settings())
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	frame := source.Frame{}
	var jpg []byte
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			cfg := s.pl.Settings()
			if iv := previewInterval(cfg); iv != interval {
				interval = iv
				ticker.Reset(iv)
			}
			if !s.pl.Source().Snapshot(&frame) {
				continue // 源未就绪, 等下一拍
			}
			jpg = imgconv.EncodeJPEGQuality(jpg[:0], &frame, cfg.Camera.PreviewQuality)
			if len(jpg) == 0 {
				continue
			}
			if _, err := fmt.Fprintf(w, "--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %d\r\n\r\n", len(jpg)); err != nil {
				return
			}
			if _, err := w.Write(jpg); err != nil {
				return
			}
			if _, err := io.WriteString(w, "\r\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func (s *Server) handleSnapshot(w http.ResponseWriter, r *http.Request) {
	frame := source.Frame{}
	if !s.pl.Source().Snapshot(&frame) {
		writeErr(w, http.StatusServiceUnavailable, "暂无画面")
		return
	}
	// v1.2: 抓拍质量同样走 camera.preview_quality
	jpg := imgconv.EncodeJPEGQuality(nil, &frame, s.pl.Settings().Camera.PreviewQuality)
	w.Header().Set("Content-Type", "image/jpeg")
	_, _ = w.Write(jpg)
}

func (s *Server) handleManualSnapshot(w http.ResponseWriter, r *http.Request) {
	cfg := s.pl.Settings()
	frame := source.Frame{}
	if !s.pl.Source().Snapshot(&frame) {
		writeErr(w, http.StatusServiceUnavailable, "暂无画面, 无法抓拍")
		return
	}
	name := fmt.Sprintf("snap-%d.jpg", time.Now().UnixNano())
	dir := filepath.Join(cfg.Server.SnapshotDir, "manual")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		writeErr(w, http.StatusInternalServerError, "创建抓拍目录失败")
		return
	}
	jpg := imgconv.EncodeJPEGQuality(nil, &frame, cfg.Camera.PreviewQuality)
	if err := os.WriteFile(filepath.Join(dir, name), jpg, 0o644); err != nil {
		writeErr(w, http.StatusInternalServerError, "保存抓拍失败")
		return
	}
	writeOK(w, map[string]string{
		"file": name,
		"url":  "/media/snapshots/manual/" + name,
	})
}

// ---- 事件与录像 ----

type eventsResponse struct {
	Items []store.Event `json:"items"`
	Total int           `json:"total"`
}

func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	offset, _ := strconv.Atoi(q.Get("offset"))

	f := store.Filter{Type: q.Get("type")}
	switch f.Type {
	case "", "motion", "selfcheck":
	default:
		writeErr(w, http.StatusBadRequest, "type 只能是 motion 或 selfcheck")
		return
	}
	var err error
	if f.From, err = parseTimeParam(q.Get("from")); err != nil {
		writeErr(w, http.StatusBadRequest, "from 需为 RFC3339 时间")
		return
	}
	if f.To, err = parseTimeParam(q.Get("to")); err != nil {
		writeErr(w, http.StatusBadRequest, "to 需为 RFC3339 时间")
		return
	}

	items, total := s.st.Query(f, limit, offset)
	writeOK(w, eventsResponse{Items: items, Total: total})
}

// parseTimeParam 解析可选的时间参数; 空串表示不限。
func parseTimeParam(v string) (time.Time, error) {
	if v == "" {
		return time.Time{}, nil
	}
	return time.Parse(time.RFC3339, v)
}

type recFileItem struct {
	Name      string     `json:"name"`
	SizeBytes int64      `json:"size_bytes"`
	Modified  time.Time  `json:"modified"`
	Start     *time.Time `json:"start"`
	End       *time.Time `json:"end"`
}

type recordingsResponse struct {
	Items          []recFileItem `json:"items"`
	TotalSizeBytes int64         `json:"total_size_bytes"`
}

func (s *Server) handleRecordings(w http.ResponseWriter, r *http.Request) {
	cfg := s.pl.Settings()
	entries, err := os.ReadDir(cfg.Record.Dir)
	if err != nil && !os.IsNotExist(err) {
		writeErr(w, http.StatusInternalServerError, "读取录像目录失败")
		return
	}
	resp := recordingsResponse{Items: []recFileItem{}}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		item := recFileItem{
			Name:      e.Name(),
			SizeBytes: info.Size(),
			Modified:  info.ModTime(),
		}
		// start/end 由文件名解析(契约 §3.2); 解析失败两者均为 null
		if start, ok := parseSegmentName(e.Name()); ok {
			end := segmentEnd(start, info.ModTime(), cfg.Record.SegmentSeconds)
			item.Start, item.End = &start, &end
		}
		resp.Items = append(resp.Items, item)
		resp.TotalSizeBytes += info.Size()
	}
	sort.Slice(resp.Items, func(i, j int) bool {
		return resp.Items[i].Modified.After(resp.Items[j].Modified)
	})
	writeOK(w, resp)
}

// ---- 配置 ----

func (s *Server) handleGetConfig(w http.ResponseWriter, r *http.Request) {
	cfg := s.pl.Settings()
	writeOK(w, cfg.View())
}

func (s *Server) handlePostConfig(w http.ResponseWriter, r *http.Request) {
	var req config.View
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求体不是合法 JSON")
		return
	}
	if err := s.pl.UpdateConfig(req); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	cfg := s.pl.Settings()
	writeOK(w, cfg.View())
}

// ---- 工具 ----

func dirSize(root string) int64 {
	var total int64
	_ = filepath.WalkDir(root, func(_ string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // 跳过不可读项
		}
		if !d.IsDir() {
			if info, err := d.Info(); err == nil {
				total += info.Size()
			}
		}
		return nil
	})
	return total
}
