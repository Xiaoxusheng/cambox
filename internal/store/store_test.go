package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writeFile(path, content string) error {
	return os.WriteFile(path, []byte(content), 0o644)
}

// openWithSeed 用指定事件(时间可控)构造 store: 写 JSONL 后由 Open 载入。
func openWithSeed(t *testing.T, events ...Event) (*Store, string) {
	t.Helper()
	dir := t.TempDir()
	if len(events) > 0 {
		var buf []byte
		for _, ev := range events {
			line, err := json.Marshal(ev)
			if err != nil {
				t.Fatal(err)
			}
			buf = append(buf, line...)
			buf = append(buf, '\n')
		}
		if err := os.WriteFile(filepath.Join(dir, "events-202609.jsonl"), buf, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	s, err := Open(dir, 5000)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	return s, dir
}

func day(y int, mo time.Month, d, h, mi int) time.Time {
	return time.Date(y, mo, d, h, mi, 0, 0, time.Local)
}

func TestAppendAndList(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "data"), 100)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	for i := 0; i < 5; i++ {
		if _, err := s.Append("motion", 100+i, "/media/snapshots/x.jpg", ""); err != nil {
			t.Fatalf("Append %d: %v", i, err)
		}
	}

	items, total := s.List(3, 0)
	if total != 5 {
		t.Errorf("total = %d, want 5", total)
	}
	if len(items) != 3 {
		t.Fatalf("items = %d, want 3", len(items))
	}
	if items[0].ID != 5 || items[1].ID != 4 || items[2].ID != 3 {
		t.Errorf("应按新→旧排序: got ids %d,%d,%d", items[0].ID, items[1].ID, items[2].ID)
	}

	page2, _ := s.List(3, 3)
	if len(page2) != 2 || page2[0].ID != 2 || page2[1].ID != 1 {
		t.Errorf("第二页应为 id 2,1: got %+v", page2)
	}

	empty, total := s.List(3, 99)
	if len(empty) != 0 || total != 5 {
		t.Errorf("越界 offset 应返回空列表, got %d items, total %d", len(empty), total)
	}

	if _, total = s.List(999, 0); total != 5 {
		t.Errorf("limit 超限应被钳制且不影响 total, got %d", total)
	}
}

func TestPersistenceAcrossReopen(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "data")

	s1, err := Open(dir, 100)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		if _, err := s1.Append("motion", i, "", ""); err != nil {
			t.Fatal(err)
		}
	}

	s2, err := Open(dir, 100)
	if err != nil {
		t.Fatal(err)
	}
	if got := s2.Count(); got != 3 {
		t.Fatalf("重开后应加载 3 条, got %d", got)
	}
	ev, err := s2.Append("motion", 9, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if ev.ID != 4 {
		t.Errorf("重开后 ID 应延续, got %d", ev.ID)
	}
}

func TestMaxEventsCapAndBadLines(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir, 3)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 5; i++ {
		if _, err := s.Append("motion", i, "", ""); err != nil {
			t.Fatal(err)
		}
	}
	if got := s.Count(); got != 3 {
		t.Fatalf("内存应只保留最近 3 条, got %d", got)
	}

	// 坏行不阻断重新加载
	f := filepath.Join(dir, "events-manual.jsonl")
	if err := writeFile(f, "not-json\n{\"id\":99,\"time\":\"2026-09-28T10:00:00+08:00\",\"type\":\"motion\"}\n\n"); err != nil {
		t.Fatal(err)
	}
	s2, err := Open(dir, 3)
	if err != nil {
		t.Fatalf("坏行不应导致 Open 失败: %v", err)
	}
	// 磁盘共 6 条有效(5+手动1), 坏行跳过, 内存按上限 3 截断
	if got := s2.Count(); got != 3 {
		t.Fatalf("坏行应被跳过且内存截断为 3: got %d", got)
	}
}

// ---- v1.1: Query / Between / DayStats / Delete ----

func seedEvents() []Event {
	return []Event{
		{ID: 1, Time: day(2026, 9, 28, 8, 0), Type: "motion", Score: 300, Image: "/media/snapshots/events/a.jpg"},
		{ID: 2, Time: day(2026, 9, 28, 8, 30), Type: "selfcheck", Score: 0, Detail: "frozen", Image: "/media/snapshots/events/b.jpg"},
		{ID: 3, Time: day(2026, 9, 28, 15, 0), Type: "motion", Score: 900, Image: "/media/snapshots/events/c.jpg"},
		{ID: 4, Time: day(2026, 9, 27, 22, 0), Type: "motion", Score: 100, Image: "/media/snapshots/events/d.jpg"},
	}
}

func TestQueryFilterByTypeAndRange(t *testing.T) {
	s, _ := openWithSeed(t, seedEvents()...)

	// 无条件: 等价于 List(新→旧)
	items, total := s.Query(Filter{}, 10, 0)
	if total != 4 || len(items) != 4 {
		t.Fatalf("无条件应返回 4 条, got %d/%d", len(items), total)
	}
	if items[0].ID != 3 || items[3].ID != 4 {
		t.Errorf("应按新→旧排序: %+v", ids(items))
	}

	// type=motion
	items, total = s.Query(Filter{Type: "motion"}, 10, 0)
	if total != 3 || len(items) != 3 {
		t.Fatalf("type=motion 应 3 条, got %d/%d", len(items), total)
	}
	for _, ev := range items {
		if ev.Type != "motion" {
			t.Errorf("类型过滤失效: %+v", ev)
		}
	}

	// type=selfcheck 且 detail 保留
	items, _ = s.Query(Filter{Type: "selfcheck"}, 10, 0)
	if len(items) != 1 || items[0].Detail != "frozen" {
		t.Errorf("selfcheck 事件应带 detail: %+v", items)
	}

	// from 闭区间
	items, total = s.Query(Filter{From: day(2026, 9, 28, 8, 30)}, 10, 0)
	if total != 2 || items[1].ID != 2 {
		t.Errorf("from=08:30 应命中 id 2,3, got %v", ids(items))
	}

	// to 开区间
	items, total = s.Query(Filter{To: day(2026, 9, 28, 8, 30)}, 10, 0)
	if total != 2 || items[0].ID != 1 || items[1].ID != 4 {
		t.Errorf("to=08:30 应命中 id 1,4(新→旧), got %v", ids(items))
	}

	// 组合 + 分页
	items, total = s.Query(Filter{Type: "motion", From: day(2026, 9, 28, 0, 0), To: day(2026, 9, 29, 0, 0)}, 1, 1)
	if total != 2 || len(items) != 1 || items[0].ID != 1 {
		t.Errorf("组合过滤分页错误: total=%d items=%v", total, ids(items))
	}

	// 无命中
	if items, total = s.Query(Filter{Type: "nope"}, 10, 0); total != 0 || len(items) != 0 {
		t.Errorf("无命中应返回空, got %v/%d", ids(items), total)
	}
}

func TestBetweenIsAscendingAndHalfOpen(t *testing.T) {
	s, _ := openWithSeed(t, seedEvents()...)
	got := s.Between(day(2026, 9, 27, 22, 0), day(2026, 9, 28, 15, 0))
	if len(got) != 3 || got[0].ID != 4 || got[1].ID != 1 || got[2].ID != 2 {
		t.Errorf("应含 [9/27 22:00, 9/28 15:00) 且按时间升序, got %v", ids(got))
	}
	// to 为开区间: id 3 在 15:00 不计入
	for _, ev := range got {
		if ev.ID == 3 {
			t.Error("to 应为开区间, 不应含 id 3")
		}
	}
}

func TestDayStats(t *testing.T) {
	s, _ := openWithSeed(t, seedEvents()...)
	total, hourly, top := s.DayStats(day(2026, 9, 28, 0, 0), day(2026, 9, 29, 0, 0))
	if total != 3 {
		t.Errorf("total = %d, want 3", total)
	}
	if hourly[8] != 2 || hourly[15] != 1 || hourly[0] != 0 {
		t.Errorf("小时分布错误: %v", hourly)
	}
	if len(hourly) != 24 {
		t.Errorf("hourly 长度应恒为 24, got %d", len(hourly))
	}
	if top == nil || top.ID != 3 || top.Score != 900 {
		t.Errorf("最高分事件错误: %+v", top)
	}

	// 空区间
	total, hourly, top = s.DayStats(day(2026, 1, 1, 0, 0), day(2026, 1, 2, 0, 0))
	if total != 0 || top != nil {
		t.Errorf("空区间应 total=0 且 top=nil, got %d/%v", total, top)
	}
	for _, n := range hourly {
		if n != 0 {
			t.Errorf("空区间 hourly 应全 0: %v", hourly)
		}
	}
}

func TestDeleteRemovesMemoryAndDisk(t *testing.T) {
	s, dir := openWithSeed(t, seedEvents()...)

	n, images, err := s.Delete([]int64{2, 3})
	if err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if n != 2 {
		t.Errorf("应删除 2 条, got %d", n)
	}
	if len(images) != 2 || !strings.Contains(strings.Join(images, ","), "b.jpg") {
		t.Errorf("应返回关联图片: %v", images)
	}
	if s.Count() != 2 {
		t.Errorf("内存应剩 2 条, got %d", s.Count())
	}
	if items, total := s.Query(Filter{}, 10, 0); total != 2 {
		t.Errorf("查询应剩 2 条, got %d %v", total, ids(items))
	} else {
		for _, ev := range items {
			if ev.ID == 2 || ev.ID == 3 {
				t.Errorf("被删事件仍在: %+v", ev)
			}
		}
	}

	// 磁盘已重写, 重开不再出现
	s2, err := Open(dir, 5000)
	if err != nil {
		t.Fatal(err)
	}
	if s2.Count() != 2 {
		t.Errorf("重开后应剩 2 条, got %d", s2.Count())
	}
	if items, _ := s2.Query(Filter{}, 10, 0); len(items) != 2 || items[0].ID != 1 || items[1].ID != 4 {
		t.Errorf("重开后应剩 id 1,4(新→旧), got %v", ids(items))
	}

	// 不残留 .tmp
	if _, err := os.Stat(filepath.Join(dir, "events-202609.jsonl.tmp")); !os.IsNotExist(err) {
		t.Error("原子写后不应残留 .tmp")
	}
}

func TestDeleteIgnoresUnknownAndEmpty(t *testing.T) {
	s, _ := openWithSeed(t, seedEvents()...)

	n, images, err := s.Delete(nil)
	if err != nil || n != 0 || len(images) != 0 {
		t.Errorf("空 ids 应为无操作: n=%d images=%v err=%v", n, images, err)
	}
	n, _, err = s.Delete([]int64{999, 1000})
	if err != nil {
		t.Fatalf("不存在的 ID 不应报错: %v", err)
	}
	if n != 0 {
		t.Errorf("不存在的 ID 应删除 0 条, got %d", n)
	}
	if s.Count() != 4 {
		t.Errorf("事件不应被误删, got %d", s.Count())
	}
}

func TestDeleteKeepsBadLinesAndOtherMonths(t *testing.T) {
	_, dir := openWithSeed(t, seedEvents()...)
	// 追加一个含坏行与另一月份的文件
	other := filepath.Join(dir, "events-202608.jsonl")
	if err := writeFile(other, "not-json\n{\"id\":50,\"time\":\"2026-08-01T10:00:00+08:00\",\"type\":\"motion\"}\n"); err != nil {
		t.Fatal(err)
	}
	s3, err := Open(dir, 5000)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := s3.Delete([]int64{1}); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	data, err := os.ReadFile(other)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "not-json") {
		t.Error("坏行应原样保留")
	}
	if !strings.Contains(string(data), `"id":50`) {
		t.Error("其他月份事件不应被改动")
	}
}

func TestDeleteNoMatchDoesNotRewriteFile(t *testing.T) {
	s, dir := openWithSeed(t, seedEvents()...)
	path := filepath.Join(dir, "events-202609.jsonl")
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.Delete([]int64{777}); err != nil {
		t.Fatal(err)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Error("未命中任何 ID 时不应重写文件")
	}
}

func TestEventJSONHasDetailField(t *testing.T) {
	line, err := json.Marshal(Event{ID: 1, Type: "selfcheck", Detail: "occlusion"})
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{`"id":`, `"time":`, `"type":`, `"score":`, `"image":`, `"detail":`} {
		if !strings.Contains(string(line), key) {
			t.Errorf("Event JSON 缺少 %s: %s", key, line)
		}
	}
}

func ids(evs []Event) []int64 {
	out := make([]int64, 0, len(evs))
	for _, e := range evs {
		out = append(out, e.ID)
	}
	return out
}
