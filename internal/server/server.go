// Package server 提供 HTTP API 与嵌入式 Web 面板。设计见 docs/开发文档.md §4.7。
package server

import (
	"embed"
	"io/fs"
	"net/http"
	"sync"
	"time"

	"camhub/internal/pipeline"
	"camhub/internal/store"
)

//go:embed web/index.html
var webFiles embed.FS

// Server 组装路由; 媒体目录等设置在每次请求时从 pipeline 读取, 支持热更新。
type Server struct {
	pl   *pipeline.Pipeline
	st   *store.Store
	disk *diskCache
}

func New(pl *pipeline.Pipeline, st *store.Store) *Server {
	return &Server{pl: pl, st: st, disk: &diskCache{}}
}

// Handler 构建全部路由。
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache") // 升级后浏览器不得使用旧面板
		http.FileServerFS(mustSub(webFiles, "web")).ServeHTTP(w, r)
	})
	mux.HandleFunc("GET /api/status", s.handleStatus)
	mux.HandleFunc("GET /api/stream.mjpeg", s.handleMJPEG)
	mux.HandleFunc("GET /api/snapshot", s.handleSnapshot)
	mux.HandleFunc("POST /api/snapshots", s.handleManualSnapshot)
	mux.HandleFunc("GET /api/events", s.handleEvents)
	mux.HandleFunc("GET /api/recordings", s.handleRecordings)
	mux.HandleFunc("GET /api/config", s.handleGetConfig)
	mux.HandleFunc("POST /api/config", s.handlePostConfig)

	mux.Handle("GET /media/recordings/",
		http.StripPrefix("/media/recordings/", dirHandler(func() string { return s.pl.Settings().Record.Dir })))
	mux.Handle("GET /media/snapshots/",
		http.StripPrefix("/media/snapshots/", dirHandler(func() string { return s.pl.Settings().Server.SnapshotDir })))

	return mux
}

func mustSub(fsys embed.FS, dir string) fs.FS {
	sub, err := fs.Sub(fsys, dir)
	if err != nil {
		panic(err)
	}
	return sub
}

// dirHandler 每次请求按当前设置打开目录(热更新生效), http.FileServer 内置路径穿越防护。
func dirHandler(dir func() string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.FileServer(http.Dir(dir())).ServeHTTP(w, r)
	})
}

// diskCache 磁盘用量缓存, 避免状态轮询频繁遍历目录。
type diskCache struct {
	mu       sync.Mutex
	rec      int64
	snap     int64
	walkedAt time.Time
}

func (d *diskCache) get(recordDir, snapDir string, ttl time.Duration) (rec, snap int64) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if !d.walkedAt.IsZero() && time.Since(d.walkedAt) < ttl {
		return d.rec, d.snap
	}
	d.rec = dirSize(recordDir)
	d.snap = dirSize(snapDir)
	d.walkedAt = time.Now()
	return d.rec, d.snap
}
