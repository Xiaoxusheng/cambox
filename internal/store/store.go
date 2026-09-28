// Package store 以 JSONL(按月分文件)持久化事件, 内存保留最近 maxEvents 条。
// 设计见 docs/开发文档.md §4.2。append 即写盘, 单条写失败不影响已有数据。
package store

import (
	"bufio"
	"bytes"
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
	// 保证内存切片恒为时间升序(分页/区间查询/统计都依赖该不变量),
	// 同一时刻按 ID 升序, 使结果稳定可复现。
	sort.SliceStable(s.events, func(i, j int) bool {
		if s.events[i].Time.Equal(s.events[j].Time) {
			return s.events[i].ID < s.events[j].ID
		}
		return s.events[i].Time.Before(s.events[j].Time)
	})
	if n := len(s.events); n > s.maxEvents {
		s.events = s.events[n-s.maxEvents:]
	}
	// nextID 取最大 ID + 1: 排序后末元素不一定 ID 最大。
	s.nextID = 1
	for _, ev := range s.events {
		if ev.ID >= s.nextID {
			s.nextID = ev.ID + 1
		}
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

// Filter 事件查询条件; 零值字段表示不限(契约 §3.2 GET /api/events 的 type/detail/from/to,
// detail 为 v1.2 §3.3 增量: 仅 selfcheck 事件携带 frozen|occlusion)。
type Filter struct {
	Type   string
	Detail string
	From   time.Time
	To     time.Time
}

func (f Filter) match(ev Event) bool {
	if f.Type != "" && ev.Type != f.Type {
		return false
	}
	if f.Detail != "" && ev.Detail != f.Detail {
		return false
	}
	if !f.From.IsZero() && ev.Time.Before(f.From) {
		return false
	}
	if !f.To.IsZero() && !ev.Time.Before(f.To) {
		return false
	}
	return true
}

// Query 按条件分页返回事件(新→旧)与符合条件的总数; limit 上限 100。
func (s *Store) Query(f Filter, limit, offset int) ([]Event, int) {
	s.mu.Lock()
	defer s.mu.Unlock()

	matched := make([]Event, 0, len(s.events))
	for _, ev := range s.events {
		if f.match(ev) {
			matched = append(matched, ev)
		}
	}
	total := len(matched)

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
		out = append(out, matched[i])
	}
	return out, total
}

// Between 返回 [from, to) 内的事件, 时间升序; 供 timeline 与日报统计使用。
func (s *Store) Between(from, to time.Time) []Event {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Event, 0, len(s.events))
	for _, ev := range s.events {
		if !ev.Time.Before(from) && ev.Time.Before(to) {
			out = append(out, ev)
		}
	}
	return out
}

// DayStats 统计 [from, to) 内的事件: 总数、按当地小时分布(长度恒 24)、最高分事件(无则 nil)。
func (s *Store) DayStats(from, to time.Time) (total int, hourly [24]int, top *Event) {
	for _, ev := range s.Between(from, to) {
		total++
		h := ev.Time.Hour()
		if h >= 0 && h < 24 {
			hourly[h]++
		}
		if top == nil || ev.Score > top.Score {
			e := ev
			top = &e
		}
	}
	return total, hourly, top
}

// Delete 删除指定 ID 的事件: 内存移除 + 重写受影响的月度 JSONL(临时文件 + rename 原子替换)。
// 返回实际删除条数与关联的图片 URL(调用方负责删除文件, 忽略不存在)。
// 坏行原样保留, 不因删除操作丢数据; 未命中任何 ID 的文件不重写。
func (s *Store) Delete(ids []int64) (int, []string, error) {
	if len(ids) == 0 {
		return 0, nil, nil
	}
	set := make(map[int64]struct{}, len(ids))
	for _, id := range ids {
		set[id] = struct{}{}
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	removed := make(map[int64]struct{})
	imageSet := make(map[string]struct{})
	addImages := func(imgs []string) {
		for _, img := range imgs {
			if img != "" {
				imageSet[img] = struct{}{}
			}
		}
	}

	kept := make([]Event, 0, len(s.events))
	for _, ev := range s.events {
		if _, hit := set[ev.ID]; hit {
			removed[ev.ID] = struct{}{}
			addImages([]string{ev.Image})
			continue
		}
		kept = append(kept, ev)
	}
	s.events = kept

	paths, err := filepath.Glob(filepath.Join(s.dir, "events-*.jsonl"))
	if err != nil {
		return len(removed), sortedKeys(imageSet), err
	}
	sort.Strings(paths)
	for _, path := range paths {
		dropped, images, err := rewriteWithout(path, set)
		if err != nil {
			return len(removed), sortedKeys(imageSet), err
		}
		for _, id := range dropped {
			removed[id] = struct{}{}
		}
		addImages(images)
	}
	return len(removed), sortedKeys(imageSet), nil
}

// rewriteWithout 重写文件, 丢弃 ids 命中的行; 返回被丢弃的 ID 与其图片 URL。
func rewriteWithout(path string, ids map[int64]struct{}) ([]int64, []string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, nil, err
	}
	var keptLines [][]byte
	var dropped []int64
	var images []string

	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		line := bytes.TrimSpace(sc.Bytes())
		if len(line) == 0 {
			continue
		}
		var ev Event
		if err := json.Unmarshal(line, &ev); err != nil {
			keptLines = append(keptLines, append([]byte(nil), line...)) // 坏行原样保留
			continue
		}
		if _, hit := ids[ev.ID]; hit {
			dropped = append(dropped, ev.ID)
			images = append(images, ev.Image)
			continue
		}
		keptLines = append(keptLines, append([]byte(nil), line...))
	}
	scanErr := sc.Err()
	if err := f.Close(); err != nil && scanErr == nil {
		scanErr = err
	}
	if scanErr != nil {
		return nil, nil, scanErr
	}
	if len(dropped) == 0 {
		return nil, nil, nil // 未命中, 不重写
	}

	var buf bytes.Buffer
	for _, line := range keptLines {
		buf.Write(line)
		buf.WriteByte('\n')
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, buf.Bytes(), 0o644); err != nil {
		return nil, nil, err
	}
	if err := os.Rename(tmp, path); err != nil {
		return nil, nil, err
	}
	return dropped, images, nil
}

func sortedKeys(m map[string]struct{}) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
