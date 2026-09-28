package store

import (
	"os"
	"path/filepath"
	"testing"
)

func writeFile(path, content string) error {
	return os.WriteFile(path, []byte(content), 0o644)
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
