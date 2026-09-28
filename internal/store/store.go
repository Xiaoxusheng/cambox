// Package store 以 JSONL(按月分文件)持久化事件, 内存保留最近 maxEvents 条。
// 设计见 docs/开发文档.md §4.2。append 即写盘, 单条写失败不影响已有数据。
package store

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// Event 一次事件。Image 为面板可直接引用的相对 URL。
// Detail 仅 selfcheck 事件使用(契约 §3.4): frozen | occlusion, 其余为空串。
type Event struct {
	ID     int64     `json:"id"`
	Time   time.Time `json:"time"`
	Type   string    `json:"type"`
	Score  int       `json:"score"`
	Image  string    `json:"image"`
	Detail string    `json:"detail"`
}

// Store 并发安全的事件存储。
type Store struct {
	mu        sync.Mutex
	dir       string
	maxEvents int
	events    []Event // 时间升序, 最新在尾部
	nextID    int64
}

// Open 初始化存储目录并加载历史事件(坏行跳过)。
func Open(dir string, maxEvents int) (*Store, error) {
	if maxEvents <= 0 {
		maxEvents = 5000
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	s := &Store{dir: dir, maxEvents: maxEvents}
	entries, err := filepath.Glob(filepath.Join(dir, "events-*.jsonl"))
	if err != nil {
		return nil, err
	}
	sort.Strings(entries)
	for _, f := range entries {
		if err := s.loadFile(f); err != nil {
			return nil, err
		}
	}
	if n := len(s.events); n > s.maxEvents {
		s.events = s.events[n-s.maxEvents:]
	}
	s.nextID = 1
	if n := len(s.events); n > 0 {
		s.nextID = s.events[n-1].ID + 1
	}
	return s, nil
}

func (s *Store) loadFile(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		var ev Event
		if err := json.Unmarshal([]byte(line), &ev); err != nil {
			continue
		}
		s.events = append(s.events, ev)
	}
	return sc.Err()
}

// Append 追加一条事件并落盘(文件按月自动切换)。
// detail 仅 selfcheck 事件使用, 其余传空串。
func (s *Store) Append(typ string, score int, image, detail string) (Event, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	ev := Event{ID: s.nextID, Time: time.Now(), Type: typ, Score: score, Image: image, Detail: detail}
	line, err := json.Marshal(ev)
	if err != nil {
		return Event{}, err
	}
	name := filepath.Join(s.dir, ev.Time.Format("events-200601.jsonl"))
	f, err := os.OpenFile(name, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return Event{}, err
	}
	if _, err := f.Write(append(line, '\n')); err != nil {
		f.Close()
		return Event{}, err
	}
	if err := f.Close(); err != nil {
		return Event{}, err
	}

	s.nextID = ev.ID + 1
	s.events = append(s.events, ev)
	if len(s.events) > s.maxEvents {
		s.events = s.events[len(s.events)-s.maxEvents:]
	}
	return ev, nil
}

// List 分页返回事件(新→旧), limit 上限 100, 同时返回内存中的事件总数。
func (s *Store) List(limit, offset int) ([]Event, int) {
	s.mu.Lock()
	defer s.mu.Unlock()

	total := len(s.events)
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	if offset >= total {
		return []Event{}, total
	}
	end := total - offset
	start := end - limit
	if start < 0 {
		start = 0
	}
	out := make([]Event, 0, end-start)
	for i := end - 1; i >= start; i-- {
		out = append(out, s.events[i])
	}
	return out, total
}

// Count 返回内存中事件数(受 maxEvents 上限约束)。
func (s *Store) Count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.events)
}
