# Test HTTP Servers

用于测试 OMBot 监控能力的模拟服务集群。

## 服务列表

| 端口 | 服务名 | 模拟场景 | 健康检查端点 |
|------|--------|----------|-------------|
| 9001 | healthy | 正常服务，始终返回 200 | /health |
| 9002 | slow | 慢响应服务，响应时间 3-5s | /health |
| 9003 | flaky | 不稳定服务，50% 概率返回 500 | /health |
| 9004 | leaky | 内存泄漏模拟，每次请求占用更多内存 | /health, /stats |
| 9005 | cpu-stress | CPU 高负载模拟 | /health, /stress |

## 启动方式

```bash
# 启动所有服务
tsx test_http_server/index.ts

# 或者单独启动某个服务
tsx test_http_server/index.ts healthy
tsx test_http_server/index.ts slow
tsx test_http_server/index.ts flaky
tsx test_http_server/index.ts leaky
tsx test_http_server/index.ts cpu-stress
```

## 测试示例

```bash
# 正常服务
curl http://localhost:9001/health

# 慢响应
curl http://localhost:9002/health

# 不稳定服务（多次请求观察变化）
curl http://localhost:9003/health
curl http://localhost:9003/health
curl http://localhost:9003/health

# 内存泄漏服务
curl http://localhost:9004/health
curl http://localhost:9004/stats

# CPU 压力测试
curl http://localhost:9005/health
curl http://localhost:9005/stress?duration=2
```