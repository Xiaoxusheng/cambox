package server

import (
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
)

// 回归测试: 面板从 v1.0 单文件 index.html 换成 Vite 构建产物(webdist)后,
// 多了 /assets/* 资源。v1.0 只注册了 "GET /{$}", 导致 /assets/* 全部 404
// (面板白屏)——这是 mock/dev-server 下测不出来的集成缺陷。
func TestWebPanelAssetsServed(t *testing.T) {
	h := newHarness(t)
	handler := h.srv.Handler()

	get := func(target string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest("GET", target, nil))
		return rec
	}

	// 1) 首页
	rec := get("/")
	if rec.Code != 200 {
		t.Fatalf("GET / 应 200, 实际 %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "text/html") {
		t.Errorf("GET / Content-Type 应为 html, 实际 %q", ct)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-cache" {
		t.Errorf("首页必须 no-cache, 实际 %q", cc)
	}
	html := rec.Body.String()
	if !strings.Contains(html, `id="root"`) {
		t.Errorf("首页不是 Vite 产物(缺 #root): %.200s", html)
	}

	// 2) 首页引用的每个资源都必须可访问(否则白屏)
	refs := regexp.MustCompile(`(?:src|href)="\.?(/assets/[^"]+)"`).FindAllStringSubmatch(html, -1)
	if len(refs) == 0 {
		t.Fatalf("首页未引用任何 /assets/* 资源, 产物可能异常: %.400s", html)
	}
	for _, m := range refs {
		asset := m[1]
		arec := get(asset)
		if arec.Code != 200 {
			t.Errorf("资源 %s 应 200, 实际 %d(面板会白屏)", asset, arec.Code)
			continue
		}
		if arec.Body.Len() == 0 {
			t.Errorf("资源 %s 内容为空", asset)
		}
	}

	// 3) 未命中的深链回退到 index.html(SPA 兜底), 而不是 404
	drec := get("/dashboard")
	if drec.Code != 200 || !strings.Contains(drec.Body.String(), `id="root"`) {
		t.Errorf("深链 /dashboard 应回退 index.html, 实际 %d", drec.Code)
	}

	// 4) API 路由不能被兜底吞掉
	arec := get("/api/status")
	if arec.Code != 200 || !strings.Contains(arec.Header().Get("Content-Type"), "json") {
		t.Errorf("/api/status 应仍是 JSON, 实际 %d %q", arec.Code, arec.Header().Get("Content-Type"))
	}

	// 5) 未注册的 /api、/media 路径必须回 JSON 404，不能被兜底成 200 的 index.html
	//    （否则客户端把 HTML 当 JSON 解析，拼错接口名时报出难以定位的错误）
	for _, p := range []string{"/api/nope", "/api/event", "/media/nope"} {
		rec := get(p)
		if rec.Code != 404 {
			t.Errorf("%s 应 404, 实际 %d", p, rec.Code)
		}
		if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "json") {
			t.Errorf("%s 应回 JSON, 实际 %q", p, ct)
		}
		if strings.Contains(rec.Body.String(), `id="root"`) {
			t.Errorf("%s 被兜底成了 index.html", p)
		}
	}
}
