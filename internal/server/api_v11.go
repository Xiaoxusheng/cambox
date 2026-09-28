// v1.1 新增接口(契约 §3.3): arm / timeline / batch-delete / recordings 删除 /
// notify 测试 / logs SSE。
package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"camhub/internal/logbuf"
	"camhub/internal/notify"
)

// ---- POST /api/arm ----

type armRequest struct {
	Armed *bool `json:"armed"`
}

func (s *Server) handleArm(w http.ResponseWriter, r *http.Request) {
	var req armRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<12)).Decode(&req); err != nil || req.Armed == nil {
		writeErr(w, http.StatusBadRequest, `请求体应为 {"armed": true|false}`)
		return
	}
	s.pl.SetArmed(*req.Armed)
	writeOK(w, map[string]bool{"armed": s.pl.Armed()})
}

// ---- GET /api/timeline ----

type timelineSegment struct {
	Name      string    `json:"name"`
	Start     time.Time `json:"start"`
	End       time.Time `json:"end"`
	SizeBytes int64     `json:"size_bytes"`
}

type timelineEvent struct {
	ID     int64     `json:"id"`
	Time   time.Time `json:"time"`
	Type   string    `json:"type"`
	Score  int       `json:"score"`
	Image  string    `json:"image"`
	Detail string    `json:"detail"`
}

type timelineResponse struct {
	Date     string            `json:"date"`
	Segments []timelineSegment `json:"segments"`
	Events   []timelineEvent   `json:"events"`
	Hourly   []int             `json:"hourly"`
}

func (s *Server) handleTimeline(w http.ResponseWriter, r *http.Request) {
	day := time.Now()
	if v := r.URL.Query().Get("date"); v != "" {
		t, err := time.ParseInLocation("2006-01-02", v, time.Local)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "date 格式应为 YYYY-MM-DD")
			return
		}
		day = t
	}
	dayStart := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, time.Local)
	dayEnd := dayStart.AddDate(0, 0, 1)

	cfg := s.pl.Settings()
	segments, err := listSegments(cfg.Record.Dir, cfg.Record.SegmentSeconds, dayStart, dayEnd)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "读取录像目录失败")
		return
	}

	events := s.st.Between(dayStart, dayEnd)
	items := make([]timelineEvent, 0, len(events))
	var hourly [24]int
	for _, ev := range events {
		items = append(items, timelineEvent{
			ID: ev.ID, Time: ev.Time, Type: ev.Type, Score: ev.Score, Image: ev.Image, Detail: ev.Detail,
		})
		if h := ev.Time.Hour(); h >= 0 && h < 24 {
			hourly[h]++
		}
	}

	writeOK(w, timelineResponse{
		Date:     dayStart.Format("2006-01-02"),
		Segments: segments,
		Events:   items,
		Hourly:   hourly[:], // 长度恒 24
	})
}

// listSegments 返回 [dayStart, dayEnd) 内的录像分段, 按 start 升序。
func listSegments(dir string, segmentSeconds int, dayStart, dayEnd time.Time) ([]timelineSegment, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return []timelineSegment{}, nil
		}
		return nil, err
	}
	type cand struct {
		start time.Time
		name  string
		size  int64
		mod   time.Time
	}
	cands := make([]cand, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		start, ok := parseSegmentName(e.Name())
		if !ok || start.Before(dayStart) || !start.Before(dayEnd) {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		cands = append(cands, cand{start: start, name: e.Name(), size: info.Size(), mod: info.ModTime()})
	}
	sort.Slice(cands, func(i, j int) bool { return cands[i].start.Before(cands[j].start) })

	out := make([]timelineSegment, 0, len(cands))
	for _, c := range cands {
		out = append(out, timelineSegment{
			Name:      c.name,
			Start:     c.start,
			End:       segmentEnd(c.start, c.mod, segmentSeconds),
			SizeBytes: c.size,
		})
	}
	return out, nil
}

// segmentNameRe 录像分段文件名(ffmpeg strftime 模式 2026-09-28_08-00-00.mp4)。
// 同时用于「文件名解析」与「删除接口的文件名校验」, 天然阻断路径穿越。
var segmentNameRe = regexp.MustCompile(`^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.mp4$`)

// recordingNameRe 契约 §3.3 规定的 DELETE /api/recordings/{name} 校验正则。
var recordingNameRe = regexp.MustCompile(`^[A-Za-z0-9_-]+\.mp4$`)

// parseSegmentName 严格解析分段文件名; 非法(含 2026-13-45 这类越界值)返回 false。
func parseSegmentName(name string) (time.Time, bool) {
	m := segmentNameRe.FindStringSubmatch(name)
	if m == nil {
		return time.Time{}, false
	}
	var n [6]int
	for i := 0; i < 6; i++ {
		v, err := strconv.Atoi(m[i+1])
		if err != nil {
			return time.Time{}, false
		}
		n[i] = v
	}
	t := time.Date(n[0], time.Month(n[1]), n[2], n[3], n[4], n[5], 0, time.Local)
	if t.Year() != n[0] || int(t.Month()) != n[1] || t.Day() != n[2] ||
		t.Hour() != n[3] || t.Minute() != n[4] || t.Second() != n[5] {
		return time.Time{}, false
	}
	return t, true
}

// segmentEnd 分段结束时刻 = start + segment_seconds, 但不超过文件修改时间:
// 正在写入的分段 mtime 即当前时刻, 避免时间轴出现未来区间。
func segmentEnd(start, mod time.Time, segmentSeconds int) time.Time {
	end := start.Add(time.Duration(segmentSeconds) * time.Second)
	if !mod.IsZero() && mod.After(start) && mod.Before(end) {
		return mod
	}
	return end
}

// ---- POST /api/events/batch-delete ----

type batchDeleteRequest struct {
	IDs []int64 `json:"ids"`
}

const maxBatchDelete = 1000

func (s *Server) handleBatchDeleteEvents(w http.ResponseWriter, r *http.Request) {
	var req batchDeleteRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, `请求体应为 {"ids":[1,2]}`)
		return
	}
	if len(req.IDs) > maxBatchDelete {
		writeErr(w, http.StatusBadRequest, fmt.Sprintf("一次最多删除 %d 条", maxBatchDelete))
		return
	}
	if len(req.IDs) == 0 {
		writeOK(w, map[string]int{"deleted": 0})
		return
	}

	deleted, images, err := s.st.Delete(req.IDs)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "删除事件失败: "+err.Error())
		return
	}
	removed := s.removeSnapshotFiles(images)
	slog.Info("批量删除事件", "deleted", deleted, "snapshots_removed", removed)
	writeOK(w, map[string]int{"deleted": deleted})
}

// removeSnapshotFiles 删除事件关联的快照文件; 越界路径与不存在的文件一律忽略。
func (s *Server) removeSnapshotFiles(images []string) int {
	const prefix = "/media/snapshots/"
	root := s.pl.Settings().Server.SnapshotDir
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return 0
	}
	removed := 0
	for _, img := range images {
		rel, ok := strings.CutPrefix(img, prefix)
		if !ok {
			continue
		}
		local := filepath.Join(absRoot, filepath.FromSlash(rel))
		// 双保险: 解析后必须仍在快照目录内(事件图片路径由本服务生成, 此处仅防御)
		if r, err := filepath.Rel(absRoot, local); err != nil || r == ".." ||
			strings.HasPrefix(r, ".."+string(filepath.Separator)) {
			continue
		}
		if err := os.Remove(local); err == nil {
			removed++
		}
	}
	return removed
}

// ---- DELETE /api/recordings/{name} ----

func (s *Server) handleDeleteRecording(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !recordingNameRe.MatchString(name) {
		writeErr(w, http.StatusBadRequest, `文件名非法, 必须匹配 ^[A-Za-z0-9_-]+\.mp4$`)
		return
	}
	dir := s.pl.Settings().Record.Dir
	if err := os.Remove(filepath.Join(dir, name)); err != nil {
		if os.IsNotExist(err) {
			writeErr(w, http.StatusNotFound, "录像不存在")
			return
		}
		writeErr(w, http.StatusInternalServerError, "删除录像失败: "+err.Error())
		return
	}
	slog.Info("录像已删除", "name", name)
	writeOK(w, map[string]any{})
}

// ---- POST /api/notify/test ----

type notifyTestRequest struct {
	Channel string `json:"channel"`
}

func (s *Server) handleNotifyTest(w http.ResponseWriter, r *http.Request) {
	var req notifyTestRequest
	// 空 body 视为「全部启用通道」, 因此忽略 io.EOF。
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<12)).Decode(&req); err != nil && err != io.EOF {
		writeErr(w, http.StatusBadRequest, "请求体不是合法 JSON")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	results := s.pl.Notifier().SendChannel(ctx, req.Channel, notify.Message{
		Title: "camhub 测试通知",
		Body:  "这是一条测试消息, 收到即表示通道配置可用。\n时间: " + time.Now().Format("2006-01-02 15:04:05"),
	})
	if results == nil {
		results = []notify.Result{}
	}
	writeOK(w, map[string]any{"results": results})
}

// ---- GET /api/logs/stream (SSE) ----

// sseKeepAlive 心跳间隔: 空闲时发注释行, 防止中间代理断连。
const sseKeepAlive = 20 * time.Second

func (s *Server) handleLogsStream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeErr(w, http.StatusInternalServerError, "连接不支持流式输出")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	writeEntry := func(e logbuf.Entry) bool {
		raw, err := json.Marshal(e)
		if err != nil {
			return false
		}
		if _, err := fmt.Fprintf(w, "data: %s\n\n", raw); err != nil {
			return false
		}
		flusher.Flush()
		return true
	}

	// 先回放缓冲区(契约 §3.3), 再推送实时日志。
	for _, e := range s.logs.Snapshot() {
		if !writeEntry(e) {
			return
		}
	}
	ch, cancel := s.logs.Subscribe()
	defer cancel()

	keepAlive := time.NewTicker(sseKeepAlive)
	defer keepAlive.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case e, ok := <-ch:
			if !ok {
				return
			}
			if !writeEntry(e) {
				return
			}
		case <-keepAlive.C:
			if _, err := io.WriteString(w, ": ping\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}
