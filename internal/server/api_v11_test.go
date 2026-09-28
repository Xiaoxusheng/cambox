package server

import (
	"context"
	"encoding/json"
	"io"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"camhub/internal/config"
	"camhub/internal/logbuf"
	"camhub/internal/pipeline"
	"camhub/internal/store"
)

// ---- 测试脚手架 ----

type apiResp struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data"`
}

type harness struct {
	srv    *Server
	pl     *pipeline.Pipeline
	st     *store.Store
	root   string
	cfg    *config.Config
	cfgAt  string
	logbuf *logbuf.Buffer
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	root := t.TempDir()
	cfg := config.Default()
	cfg.Server.DataDir = filepath.Join(root, "data")
	cfg.Server.SnapshotDir = filepath.Join(root, "snapshots")
	cfg.Record.Dir = filepath.Join(root, "recordings")
	cfgPath := filepath.Join(root, "config.yaml")
	if err := config.Save(cfgPath, cfg); err != nil {
		t.Fatal(err)
	}
	st, err := store.Open(cfg.Server.DataDir, 5000)
	if err != nil {
		t.Fatal(err)
	}
	pl := pipeline.New(cfg, cfgPath, st)
	lg := logbuf.New(50)
	return &harness{srv: New(pl, st, lg), pl: pl, st: st, root: root, cfg: cfg, cfgAt: cfgPath, logbuf: lg}
}

func (h *harness) do(t *testing.T, method, target, body string) (int, apiResp) {
	t.Helper()
	var rdr io.Reader
	if body != "" {
		rdr = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, target, rdr)
	rec := httptest.NewRecorder()
	h.srv.Handler().ServeHTTP(rec, req)

	var resp apiResp
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("%s %s 响应不是 JSON: %v (%s)", method, target, err, rec.Body.String())
	}
	return rec.Code, resp
}

func decodeData[T any](t *testing.T, resp apiResp) T {
	t.Helper()
	var out T
	if err := json.Unmarshal(resp.Data, &out); err != nil {
		t.Fatalf("解析 data 失败: %v (%s)", err, resp.Data)
	}
	return out
}

// ---- POST /api/arm ----

func TestArmEndpoint(t *testing.T) {
	h := newHarness(t)

	code, resp := h.do(t, "POST", "/api/arm", `{"armed":false}`)
	if code != 200 || resp.Code != 0 {
		t.Fatalf("应返回 200/code=0: %d %+v", code, resp)
	}
	got := decodeData[map[string]bool](t, resp)
	if got["armed"] {
		t.Errorf("data.armed 应为 false: %+v", got)
	}
	if h.pl.Armed() {
		t.Error("pipeline 应已撤防")
	}

	_, resp = h.do(t, "POST", "/api/arm", `{"armed":true}`)
	if !decodeData[map[string]bool](t, resp)["armed"] || !h.pl.Armed() {
		t.Error("应可重新布防")
	}

	// 缺字段 / 非法 JSON → 400, 且不得改变状态
	if code, _ := h.do(t, "POST", "/api/arm", `{}`); code != 400 {
		t.Errorf("缺 armed 字段应 400, got %d", code)
	}
	if code, _ := h.do(t, "POST", "/api/arm", `{oops`); code != 400 {
		t.Errorf("非法 JSON 应 400, got %d", code)
	}
	if !h.pl.Armed() {
		t.Error("非法请求不应改变布防状态")
	}
}

// ---- GET /api/timeline ----

func writeSegment(t *testing.T, dir, name string, size int, mod time.Time) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, make([]byte, size), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(path, mod, mod); err != nil {
		t.Fatal(err)
	}
}

func TestTimelineEndpoint(t *testing.T) {
	h := newHarness(t)
	dir := h.cfg.Record.Dir

	// 2026-09-28 的两个分段(乱序写入, 期望按 start 升序返回)
	base := time.Date(2026, 9, 28, 8, 0, 0, 0, time.Local)
	writeSegment(t, dir, "2026-09-28_08-10-00.mp4", 20, base.Add(10*time.Minute+time.Minute))
	writeSegment(t, dir, "2026-09-28_08-00-00.mp4", 10, base.Add(time.Minute))
	// 非分段命名与其他日期: 应被过滤
	writeSegment(t, dir, "random.mp4", 5, base)
	writeSegment(t, dir, "2026-09-27_08-00-00.mp4", 5, base.AddDate(0, 0, -1))

	// 两条事件(时间=现在, 属于今天)
	for i := 0; i < 2; i++ {
		if _, err := h.st.Append("motion", 500, "/media/snapshots/events/x.jpg", ""); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := h.st.Append("selfcheck", 0, "", "frozen"); err != nil {
		t.Fatal(err)
	}

	code, resp := h.do(t, "GET", "/api/timeline?date=2026-09-28", "")
	if code != 200 {
		t.Fatalf("应 200, got %d", code)
	}
	data := decodeData[timelineResponse](t, resp)
	if data.Date != "2026-09-28" {
		t.Errorf("date = %q", data.Date)
	}
	if len(data.Segments) != 2 {
		t.Fatalf("应返回 2 个分段, got %d: %+v", len(data.Segments), data.Segments)
	}
	if data.Segments[0].Name != "2026-09-28_08-00-00.mp4" || data.Segments[1].Name != "2026-09-28_08-10-00.mp4" {
		t.Errorf("分段应按 start 升序: %+v", data.Segments)
	}
	if !data.Segments[0].Start.Equal(base) {
		t.Errorf("start 解析错误: %v", data.Segments[0].Start)
	}
	// 分段 mtime = start+1min < start+segment(600s) → end 取 mtime
	if !data.Segments[0].End.Equal(base.Add(time.Minute)) {
		t.Errorf("end 应取 mtime(未超过 segment_seconds): %v", data.Segments[0].End)
	}
	if data.Segments[0].SizeBytes != 10 {
		t.Errorf("size_bytes = %d", data.Segments[0].SizeBytes)
	}
	if len(data.Hourly) != 24 {
		t.Fatalf("hourly 长度应恒为 24, got %d", len(data.Hourly))
	}

	// 默认今天: 事件都在今天, 数量应为 3
	_, resp = h.do(t, "GET", "/api/timeline", "")
	today := decodeData[timelineResponse](t, resp)
	if len(today.Events) != 3 {
		t.Errorf("默认应为今天且含 3 条事件, got %d", len(today.Events))
	}
	if sum := sumInts(today.Hourly); sum != 3 {
		t.Errorf("hourly 合计应等于事件数 3, got %d", sum)
	}
	if today.Events[0].Type != "motion" || today.Events[2].Detail != "frozen" {
		t.Errorf("事件应按时间升序且带 detail: %+v", today.Events)
	}

	// 空日期
	_, resp = h.do(t, "GET", "/api/timeline?date=2020-01-01", "")
	empty := decodeData[timelineResponse](t, resp)
	if len(empty.Segments) != 0 || len(empty.Events) != 0 || sumInts(empty.Hourly) != 0 {
		t.Errorf("空日期应返回空数据: %+v", empty)
	}
	if empty.Segments == nil || empty.Events == nil {
		t.Error("空数组应序列化为 [] 而非 null")
	}

	// 非法日期
	if code, _ := h.do(t, "GET", "/api/timeline?date=2026/09/28", ""); code != 400 {
		t.Errorf("非法日期应 400, got %d", code)
	}
}

func sumInts(v []int) int {
	n := 0
	for _, x := range v {
		n += x
	}
	return n
}

func TestParseSegmentName(t *testing.T) {
	cases := []struct {
		name string
		ok   bool
	}{
		{"2026-09-28_08-00-00.mp4", true},
		{"2026-13-01_08-00-00.mp4", false}, // 月越界
		{"2026-02-30_08-00-00.mp4", false}, // 日越界
		{"2026-09-28_25-00-00.mp4", false}, // 时越界
		{"2026-9-28_08-00-00.mp4", false},  // 非零填充
		{"2026-09-28_08-00-00.mkv", false},
		{"2026-09-28_08-00-00.mp4.tmp", false},
		{"evil.mp4", false},
		{"../2026-09-28_08-00-00.mp4", false},
	}
	for _, tc := range cases {
		_, ok := parseSegmentName(tc.name)
		if ok != tc.ok {
			t.Errorf("parseSegmentName(%q) = %v, want %v", tc.name, ok, tc.ok)
		}
	}
}

func TestSegmentEndClampsToModTime(t *testing.T) {
	start := time.Date(2026, 9, 28, 8, 0, 0, 0, time.Local)

	// 正在写入的分段: mtime 在 start 与 start+segment 之间 → 取 mtime
	if got := segmentEnd(start, start.Add(30*time.Second), 600); !got.Equal(start.Add(30 * time.Second)) {
		t.Errorf("应钳到 mtime, got %v", got)
	}
	// 已完成的分段: mtime >= start+segment → 取 start+segment
	if got := segmentEnd(start, start.Add(700*time.Second), 600); !got.Equal(start.Add(600 * time.Second)) {
		t.Errorf("应取 start+segment, got %v", got)
	}
	// mtime 缺失 → 取 start+segment
	if got := segmentEnd(start, time.Time{}, 600); !got.Equal(start.Add(600 * time.Second)) {
		t.Errorf("mtime 为零值时应取 start+segment, got %v", got)
	}
}

// ---- POST /api/events/batch-delete ----

func TestBatchDeleteEventsRemovesSnapshots(t *testing.T) {
	h := newHarness(t)
	evDir := filepath.Join(h.cfg.Server.SnapshotDir, "events")
	if err := os.MkdirAll(evDir, 0o755); err != nil {
		t.Fatal(err)
	}
	mkSnap := func(name string) string {
		if err := os.WriteFile(filepath.Join(evDir, name), []byte("jpg"), 0o644); err != nil {
			t.Fatal(err)
		}
		return "/media/snapshots/events/" + name
	}
	e1, _ := h.st.Append("motion", 100, mkSnap("a.jpg"), "")
	e2, _ := h.st.Append("motion", 200, mkSnap("b.jpg"), "")
	e3, _ := h.st.Append("selfcheck", 0, mkSnap("c.jpg"), "frozen")

	code, resp := h.do(t, "POST", "/api/events/batch-delete",
		`{"ids":[`+itoa(e1.ID)+`,`+itoa(e2.ID)+`]}`)
	if code != 200 {
		t.Fatalf("应 200, got %d", code)
	}
	got := decodeData[map[string]int](t, resp)
	if got["deleted"] != 2 {
		t.Errorf("deleted = %d, want 2", got["deleted"])
	}
	if _, err := os.Stat(filepath.Join(evDir, "a.jpg")); !os.IsNotExist(err) {
		t.Error("关联快照 a.jpg 应被删除")
	}
	if _, err := os.Stat(filepath.Join(evDir, "b.jpg")); !os.IsNotExist(err) {
		t.Error("关联快照 b.jpg 应被删除")
	}
	if _, err := os.Stat(filepath.Join(evDir, "c.jpg")); err != nil {
		t.Error("未删除事件的快照应保留")
	}
	items, total := h.st.Query(store.Filter{}, 10, 0)
	if total != 1 || items[0].ID != e3.ID {
		t.Errorf("应只剩 1 条事件: %+v", items)
	}

	// 空 ids
	_, resp = h.do(t, "POST", "/api/events/batch-delete", `{"ids":[]}`)
	if decodeData[map[string]int](t, resp)["deleted"] != 0 {
		t.Error("空 ids 应返回 deleted=0")
	}
	// 非法 JSON
	if code, _ := h.do(t, "POST", "/api/events/batch-delete", `{oops`); code != 400 {
		t.Errorf("非法 JSON 应 400, got %d", code)
	}
}

// 事件图片路径异常时不得越界删除文件。
func TestBatchDeleteIgnoresOutOfScopeImagePaths(t *testing.T) {
	h := newHarness(t)
	outside := filepath.Join(h.root, "outside.jpg")
	if err := os.WriteFile(outside, []byte("keep"), 0o644); err != nil {
		t.Fatal(err)
	}
	ev, err := h.st.Append("motion", 1, "/media/snapshots/../../outside.jpg", "")
	if err != nil {
		t.Fatal(err)
	}
	if code, _ := h.do(t, "POST", "/api/events/batch-delete", `{"ids":[`+itoa(ev.ID)+`]}`); code != 200 {
		t.Fatal("应 200")
	}
	if _, err := os.Stat(outside); err != nil {
		t.Error("快照目录外的文件不得被删除")
	}
}

func itoa(v int64) string {
	return strconv.FormatInt(v, 10)
}

// ---- DELETE /api/recordings/{name} ----

func TestDeleteRecording(t *testing.T) {
	h := newHarness(t)
	dir := h.cfg.Record.Dir
	name := "2026-09-28_08-00-00.mp4"
	writeSegment(t, dir, name, 10, time.Now())

	code, resp := h.do(t, "DELETE", "/api/recordings/"+name, "")
	if code != 200 || resp.Code != 0 {
		t.Fatalf("应 200/code=0, got %d %+v", code, resp)
	}
	if string(resp.Data) != "{}" {
		t.Errorf("data 应为 {}, got %s", resp.Data)
	}
	if _, err := os.Stat(filepath.Join(dir, name)); !os.IsNotExist(err) {
		t.Error("录像文件应被删除")
	}

	// 不存在 → 404
	if code, _ := h.do(t, "DELETE", "/api/recordings/"+name, ""); code != 404 {
		t.Errorf("不存在的录像应 404, got %d", code)
	}
}

func TestDeleteRecordingRejectsBadNames(t *testing.T) {
	h := newHarness(t)
	dir := h.cfg.Record.Dir
	keep := filepath.Join(dir, "keep.mp4")
	writeSegment(t, dir, "keep.mp4", 10, time.Now())

	bad := []string{
		"keep.txt",        // 后缀不符
		"keep",            // 无后缀
		"a b.mp4",         // 空格
		"keep.mp4.bak",    // 双后缀
		"2026-09-28.mp4/", // 尾部斜杠
		"../keep.mp4",     // 路径穿越
		"a;rm.mp4",        // 特殊字符
		"a\\b.mp4",        // 反斜杠
	}
	for _, n := range bad {
		// 用 PathEscape 构造合法 URL, 保证被服务端解出的 PathValue 仍是原始字符串
		target := "/api/recordings/" + url.PathEscape(n)
		if code, _ := h.do(t, "DELETE", target, ""); code != 400 {
			t.Errorf("非法文件名 %q 应 400, got %d", n, code)
		}
	}
	if _, err := os.Stat(keep); err != nil {
		t.Error("非法请求不得删除任何文件")
	}
}

func TestRecordingNameRegexMatchesContract(t *testing.T) {
	// 契约 §3.3: ^[A-Za-z0-9_-]+\.(mp4)$
	valid := []string{"2026-09-28_08-00-00.mp4", "abc.mp4", "A_1-2.mp4"}
	for _, n := range valid {
		if !recordingNameRe.MatchString(n) {
			t.Errorf("%q 应通过校验", n)
		}
	}
	invalid := []string{"a/b.mp4", "a\\b.mp4", "a.mp4.bak", ".mp4", "a b.mp4", "中文.mp4", "a.mp4/../b.mp4"}
	for _, n := range invalid {
		if recordingNameRe.MatchString(n) {
			t.Errorf("%q 不应通过校验", n)
		}
	}
}

// ---- POST /api/notify/test ----

func TestNotifyTestEndpoint(t *testing.T) {
	h := newHarness(t)

	// 未配置任何通道 → results 为空数组(不是 null)
	code, resp := h.do(t, "POST", "/api/notify/test", `{"channel":""}`)
	if code != 200 {
		t.Fatalf("应 200, got %d", code)
	}
	if !strings.Contains(string(resp.Data), `"results":[]`) {
		t.Errorf("无启用通道时应返回空数组: %s", resp.Data)
	}

	// 未知通道 → 单条失败结果
	_, resp = h.do(t, "POST", "/api/notify/test", `{"channel":"nope"}`)
	out := decodeData[struct {
		Results []struct {
			Channel string `json:"channel"`
			OK      bool   `json:"ok"`
			Error   string `json:"error"`
		} `json:"results"`
	}](t, resp)
	if len(out.Results) != 1 || out.Results[0].OK || out.Results[0].Channel != "nope" {
		t.Errorf("未知通道应返回失败结果: %+v", out.Results)
	}
	if !strings.Contains(out.Results[0].Error, "未知通道") {
		t.Errorf("错误信息应说明原因: %q", out.Results[0].Error)
	}

	// 已启用但配置不完整的通道 → 失败结果
	_, resp = h.do(t, "POST", "/api/notify/test", `{"channel":"telegram"}`)
	out2 := decodeData[struct {
		Results []struct {
			OK    bool   `json:"ok"`
			Error string `json:"error"`
		} `json:"results"`
	}](t, resp)
	if len(out2.Results) != 1 || out2.Results[0].OK || !strings.Contains(out2.Results[0].Error, "未启用") {
		t.Errorf("未启用通道应返回失败: %+v", out2.Results)
	}

	// 空 body 等价于全部启用通道
	if code, _ := h.do(t, "POST", "/api/notify/test", ""); code != 200 {
		t.Errorf("空 body 应 200, got %d", code)
	}
}

// ---- GET /api/logs/stream ----

func TestLogsStreamReplaysBuffer(t *testing.T) {
	h := newHarness(t)
	h.logbuf.Add(logbuf.Entry{Time: time.Now(), Level: "INFO", Msg: "服务已启动"})
	h.logbuf.Add(logbuf.Entry{Time: time.Now(), Level: "WARN", Msg: "磁盘紧张"})

	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest("GET", "/api/logs/stream", nil).WithContext(ctx)
	rec := newSyncRecorder() // 并发安全: 处理器在后台 goroutine 持续写, 测试同时在读

	done := make(chan struct{})
	go func() {
		defer close(done)
		h.srv.Handler().ServeHTTP(rec, req)
	}()

	// 等缓冲区回放完成
	deadline := time.After(15 * time.Second)
	for !strings.Contains(rec.String(), "磁盘紧张") {
		select {
		case <-deadline:
			cancel()
			<-done
			t.Fatalf("未收到缓冲区回放: %q", rec.String())
		case <-time.After(10 * time.Millisecond):
		}
	}

	// 实时日志也应推送
	h.logbuf.Add(logbuf.Entry{Time: time.Now(), Level: "ERROR", Msg: "实时日志"})
	deadline = time.After(15 * time.Second)
	for !strings.Contains(rec.String(), "实时日志") {
		select {
		case <-deadline:
			cancel()
			<-done
			t.Fatalf("未收到实时日志: %q", rec.String())
		case <-time.After(10 * time.Millisecond):
		}
	}

	cancel()
	select {
	case <-done:
	case <-time.After(15 * time.Second):
		t.Fatal("SSE 未随请求取消退出")
	}

	body := rec.String()
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/event-stream") {
		t.Errorf("Content-Type = %q", ct)
	}
	if rec.Header().Get("Cache-Control") != "no-cache" {
		t.Errorf("Cache-Control = %q", rec.Header().Get("Cache-Control"))
	}
	if rec.FlushCount() == 0 {
		t.Error("SSE 必须边写边 Flush, 否则前端收不到实时日志")
	}
	for _, line := range strings.Split(strings.TrimSpace(body), "\n\n") {
		if !strings.HasPrefix(line, "data: ") {
			t.Fatalf("SSE 每条应为 data: 前缀, got %q", line)
		}
		var e logbuf.Entry
		if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &e); err != nil {
			t.Fatalf("SSE data 不是合法 JSON: %v (%q)", err, line)
		}
		if e.Msg == "" || e.Level == "" || e.Time.IsZero() {
			t.Errorf("SSE 字段不全: %+v", e)
		}
	}
}

// ---- GET /api/status 扩展 ----

func TestStatusExtension(t *testing.T) {
	h := newHarness(t)
	code, resp := h.do(t, "GET", "/api/status", "")
	if code != 200 {
		t.Fatalf("应 200, got %d", code)
	}
	out := decodeData[struct {
		Armed          bool `json:"armed"`
		ScheduleActive struct {
			Motion bool `json:"motion"`
			Record bool `json:"record"`
		} `json:"schedule_active"`
		SelfCheck struct {
			Enabled           bool       `json:"enabled"`
			LastRun           *time.Time `json:"last_run"`
			State             string     `json:"state"`
			LastAlert         string     `json:"last_alert"`
			ConsecutiveFrozen int        `json:"consecutive_frozen"`
			ConsecutiveChange int        `json:"consecutive_change"`
		} `json:"selfcheck"`
	}](t, resp)

	if !out.Armed {
		t.Error("重启默认应布防")
	}
	if !out.ScheduleActive.Motion || !out.ScheduleActive.Record {
		t.Error("空日程应全天放行")
	}
	if !out.SelfCheck.Enabled || out.SelfCheck.State != "ok" || out.SelfCheck.LastAlert != "" {
		t.Errorf("selfcheck 初始状态不符: %+v", out.SelfCheck)
	}
	if out.SelfCheck.LastRun != nil {
		t.Error("未运行过时 last_run 应为 null")
	}
	if !strings.Contains(string(resp.Data), `"last_run":null`) {
		t.Errorf("last_run 应为 null: %s", resp.Data)
	}

	// 撤防后 status 应反映
	h.do(t, "POST", "/api/arm", `{"armed":false}`)
	_, resp = h.do(t, "GET", "/api/status", "")
	if decodeData[map[string]any](t, resp)["armed"] != false {
		t.Error("撤防后 status.armed 应为 false")
	}
}

// ---- GET /api/events 过滤 ----

func TestEventsFilter(t *testing.T) {
	h := newHarness(t)
	for i := 0; i < 2; i++ {
		if _, err := h.st.Append("motion", 100, "", ""); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := h.st.Append("selfcheck", 0, "", "frozen"); err != nil {
		t.Fatal(err)
	}

	_, resp := h.do(t, "GET", "/api/events", "")
	if total := decodeData[map[string]any](t, resp)["total"].(float64); total != 3 {
		t.Errorf("无条件 total = %v, want 3", total)
	}

	_, resp = h.do(t, "GET", "/api/events?type=selfcheck", "")
	data := decodeData[struct {
		Items []store.Event `json:"items"`
		Total int           `json:"total"`
	}](t, resp)
	if data.Total != 1 || len(data.Items) != 1 || data.Items[0].Detail != "frozen" {
		t.Errorf("type=selfcheck 过滤失败: %+v", data)
	}

	// 非法 type
	if code, _ := h.do(t, "GET", "/api/events?type=bogus", ""); code != 400 {
		t.Errorf("非法 type 应 400, got %d", code)
	}
	// 非法时间
	if code, _ := h.do(t, "GET", "/api/events?from=2026-09-28", ""); code != 400 {
		t.Errorf("非法 from 应 400, got %d", code)
	}
	if code, _ := h.do(t, "GET", "/api/events?to=nope", ""); code != 400 {
		t.Errorf("非法 to 应 400, got %d", code)
	}

	// from 未来 → 空 (RFC3339 含 '+' 偏移, 必须 URL 编码否则被当成空格)
	_, resp = h.do(t, "GET", "/api/events?from="+url.QueryEscape(time.Now().Add(time.Hour).Format(time.RFC3339)), "")
	if total := decodeData[map[string]any](t, resp)["total"].(float64); total != 0 {
		t.Errorf("from 在未来应为空, got %v", total)
	}
	// to 过去 → 空
	_, resp = h.do(t, "GET", "/api/events?to="+url.QueryEscape(time.Now().Add(-time.Hour).Format(time.RFC3339)), "")
	if total := decodeData[map[string]any](t, resp)["total"].(float64); total != 0 {
		t.Errorf("to 在过去应为空, got %v", total)
	}
	// 覆盖全部
	_, resp = h.do(t, "GET", "/api/events?from="+url.QueryEscape(time.Now().Add(-time.Hour).Format(time.RFC3339))+
		"&to="+url.QueryEscape(time.Now().Add(time.Hour).Format(time.RFC3339)), "")
	if total := decodeData[map[string]any](t, resp)["total"].(float64); total != 3 {
		t.Errorf("区间覆盖全部应为 3, got %v", total)
	}
}

// ---- GET /api/recordings 的 start/end ----

func TestRecordingsStartEnd(t *testing.T) {
	h := newHarness(t)
	dir := h.cfg.Record.Dir
	mod := time.Date(2026, 9, 28, 8, 20, 0, 0, time.Local)
	writeSegment(t, dir, "2026-09-28_08-00-00.mp4", 10, mod)
	writeSegment(t, dir, "manual.mp4", 5, mod)

	_, resp := h.do(t, "GET", "/api/recordings", "")
	data := decodeData[struct {
		Items []struct {
			Name  string     `json:"name"`
			Start *time.Time `json:"start"`
			End   *time.Time `json:"end"`
		} `json:"items"`
		TotalSizeBytes int64 `json:"total_size_bytes"`
	}](t, resp)
	if data.TotalSizeBytes != 15 {
		t.Errorf("total_size_bytes = %d, want 15", data.TotalSizeBytes)
	}

	byName := map[string]int{}
	for i, it := range data.Items {
		byName[it.Name] = i
	}
	seg := data.Items[byName["2026-09-28_08-00-00.mp4"]]
	if seg.Start == nil || !seg.Start.Equal(time.Date(2026, 9, 28, 8, 0, 0, 0, time.Local)) {
		t.Errorf("分段 start 解析错误: %v", seg.Start)
	}
	// mtime(08:20) < start+600s(08:10)? 否: 08:20 晚于 08:10 → end 取 start+600s
	if seg.End == nil || !seg.End.Equal(time.Date(2026, 9, 28, 8, 10, 0, 0, time.Local)) {
		t.Errorf("分段 end 应为 start+segment_seconds: %v", seg.End)
	}
	manual := data.Items[byName["manual.mp4"]]
	if manual.Start != nil || manual.End != nil {
		t.Errorf("非分段命名 start/end 应为 null: %+v", manual)
	}
}

// ---- GET/POST /api/config 全量 ----

func TestConfigFullRoundTrip(t *testing.T) {
	h := newHarness(t)

	_, resp := h.do(t, "GET", "/api/config", "")
	for _, key := range []string{
		`"camera"`, `"motion"`, `"record"`, `"notify"`, `"schedules"`,
		`"selfcheck"`, `"digest"`, `"bot"`, `"sub_rtsp"`, `"rois"`, `"allowed_users"`,
	} {
		if !strings.Contains(string(resp.Data), key) {
			t.Errorf("GET /api/config 缺少 %s: %s", key, resp.Data)
		}
	}
	if strings.Contains(string(resp.Data), `"data_dir"`) {
		t.Error("config 视图不应暴露 server 段(data_dir 等)")
	}
	top := decodeData[map[string]json.RawMessage](t, resp)
	if _, ok := top["server"]; ok {
		t.Error("config 视图不应包含顶层 server 段")
	}
	for _, key := range []string{"camera", "motion", "record", "notify", "schedules", "selfcheck", "digest", "bot"} {
		if _, ok := top[key]; !ok {
			t.Errorf("config 视图缺少顶层段 %s", key)
		}
	}

	body := `{
	  "camera": {"name": "前门", "type": "rtsp", "rtsp": "rtsp://m", "sub_rtsp": "rtsp://s",
	             "file": "", "dshow_device": "", "width": 1280, "height": 720, "fps": 25, "reconnect_delay_sec": 3},
	  "motion": {"enabled": false, "threshold": 30, "min_area": 600, "cooldown_sec": 12,
	             "downscale_width": 320, "rois": [[0.1, 0.2, 0.3, 0.4]]},
	  "record": {"enabled": true, "dir": "` + strings.ReplaceAll(h.cfg.Record.Dir, `\`, `\\`) + `",
	             "segment_seconds": 300, "retention_days": 14, "max_disk_gb": 50},
	  "notify": {"cooldown_sec": 120,
	             "dingtalk": {"enabled": false, "webhook": "", "secret": ""},
	             "wecom": {"enabled": false, "webhook": ""},
	             "telegram": {"enabled": false, "bot_token": "", "chat_id": ""},
	             "bark": {"enabled": false, "server": "https://api.day.app", "device_key": ""},
	             "webhook": {"enabled": false, "url": "", "secret": ""}},
	  "schedules": {"rules": [{"days": [1, 2], "start": "08:00", "end": "22:00", "motion": true, "record": false}]},
	  "selfcheck": {"enabled": false, "interval_sec": 120, "frozen_checks": 5, "change_threshold": 33, "change_checks": 2},
	  "digest": {"enabled": true, "time": "21:30"},
	  "bot": {"enabled": false, "bot_token": "", "allowed_users": ["111"]}
	}`
	code, resp := h.do(t, "POST", "/api/config", body)
	if code != 200 {
		t.Fatalf("POST /api/config 应 200, got %d (%s)", code, resp.Message)
	}
	out := decodeData[config.View](t, resp)
	if out.Camera.Name != "前门" || out.Camera.SubRTSP != "rtsp://s" {
		t.Errorf("camera 未更新: %+v", out.Camera)
	}
	if out.Motion.Enabled || out.Motion.MinArea != 600 || len(out.Motion.ROIs) != 1 {
		t.Errorf("motion 未更新: %+v", out.Motion)
	}
	if out.Record.SegmentSeconds != 300 || out.Record.RetentionDays != 14 {
		t.Errorf("record 未更新: %+v", out.Record)
	}
	if out.Notify.CooldownSec != 120 || len(out.Schedules.Rules) != 1 ||
		out.SelfCheck.IntervalSec != 120 || out.Digest.Time != "21:30" ||
		len(out.Bot.AllowedUsers) != 1 {
		t.Errorf("v1.1 段未更新: %+v", out)
	}

	// 运行时已生效
	if h.pl.Settings().Motion.MinArea != 600 || h.pl.SelfCheck().Config().IntervalSec != 120 {
		t.Error("热更新未下发到子系统")
	}

	// 已落盘
	reloaded, err := config.Load(h.cfgAt)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.Camera.SubRTSP != "rtsp://s" || reloaded.Motion.MinArea != 600 ||
		reloaded.Digest.Time != "21:30" || len(reloaded.Schedules.Rules) != 1 {
		t.Errorf("配置未持久化: %+v", reloaded)
	}
	// server 段不受影响
	if reloaded.Server.Port != h.cfg.Server.Port {
		t.Error("POST /api/config 不应改动 server 段")
	}

	// 非法值被钳制
	_, resp = h.do(t, "POST", "/api/config", `{"motion":{"min_area":0,"cooldown_sec":99999},"notify":{"cooldown_sec":1}}`)
	clamped := decodeData[config.View](t, resp)
	if clamped.Motion.MinArea != 1 || clamped.Motion.CooldownSec != 3600 || clamped.Notify.CooldownSec != 10 {
		t.Errorf("非法值未按契约 §1 钳制: %+v", clamped)
	}

	// 非法 JSON
	if code, _ := h.do(t, "POST", "/api/config", `{oops`); code != 400 {
		t.Errorf("非法 JSON 应 400, got %d", code)
	}
}

// ---- 路由完整性 ----

func TestV11RoutesRegistered(t *testing.T) {
	h := newHarness(t)
	writeSegment(t, h.cfg.Record.Dir, "x.mp4", 4, time.Now())

	cases := []struct{ method, target, body string }{
		{"POST", "/api/arm", `{"armed":true}`},
		{"GET", "/api/timeline", ""},
		{"POST", "/api/events/batch-delete", `{"ids":[]}`},
		{"DELETE", "/api/recordings/x.mp4", ""},
		{"POST", "/api/notify/test", `{"channel":""}`},
	}
	for _, tc := range cases {
		code, resp := h.do(t, tc.method, tc.target, tc.body)
		if code != 200 {
			t.Errorf("%s %s 返回 %d (%s), 路由未注册或异常", tc.method, tc.target, code, resp.Message)
		}
	}
}
