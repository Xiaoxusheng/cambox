// camhub 摄像头监控服务入口: 读取配置 → 初始化组件 → 启动流水线与 HTTP → 优雅关闭。
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"camhub/internal/config"
	"camhub/internal/pipeline"
	"camhub/internal/server"
	"camhub/internal/store"
)

func main() {
	cfgPath := flag.String("config", "configs/config.yaml", "配置文件路径")
	flag.Parse()

	cfg, err := config.Load(*cfgPath)
	if err != nil {
		slog.Error("加载配置失败", "err", err)
		os.Exit(1)
	}
	st, err := store.Open(cfg.Server.DataDir, 5000)
	if err != nil {
		slog.Error("初始化事件存储失败", "err", err)
		os.Exit(1)
	}

	p := pipeline.New(cfg, *cfgPath, st)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	p.Start(ctx)

	srv := server.New(p, st)
	httpServer := &http.Server{
		Addr:              fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port),
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() {
		slog.Info("服务已启动", "addr", "http://"+httpServer.Addr)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("HTTP 服务异常退出", "err", err)
			stop()
		}
	}()

	<-ctx.Done()
	slog.Info("收到退出信号, 正在关闭")

	shCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(shCtx); err != nil {
		slog.Warn("HTTP 关闭超时", "err", err)
	}
	p.Stop()
	slog.Info("已退出")
}
