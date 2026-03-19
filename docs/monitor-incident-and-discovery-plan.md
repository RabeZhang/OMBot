# OMBot Monitor 事件闭环与本地服务发现实施方案

**版本**: v0.1  
**状态**: 开发方案  
**最后更新**: 2026-03-19

---

## 一、问题背景

当前 OMBot 的 monitor 能力已经可以：

- 依据 `monitors.yaml` 执行定时检查
- 支持 `http / port / process / resource`
- 根据失败结果触发 `monitor.alert`
- 根据恢复结果触发 `monitor.recovered`

但目前仍存在两个明显问题：

1. Monitor 事件没有真正进入 Agent 分析闭环  
2. Monitor 的目标定义仍然比较接近“手写 probe”，缺少服务发现与服务建模能力

也就是说，当前实现更像：

```text
规则轮询 -> 产生日志 -> 发布事件
```

而不是：

```text
服务建模 -> 状态变化 -> incident -> Gateway -> Agent 分析 -> transcript / audit / CLI 可见
```

---

## 二、设计目标

下一阶段目标不是“自动监控本机所有东西”，而是分成两条主线：

### 2.1 主线一：Monitor 事件自动进入 Agent 分析闭环

目标：

- 只有重要状态变化才触发 Agent
- Monitor 事件进入独立 incident session 或绑定 service session
- Agent 基于 monitor 上下文进行分析、排查、调用工具
- 分析过程和结果进入 transcript / audit / CLI

### 2.2 主线二：增加本地服务发现能力

目标：

- 自动发现“本机可能值得监控的对象”
- 生成候选服务清单
- 帮助用户初始化监控配置

非目标：

- 不自动把发现到的一切对象都纳入监控
- 不把“发现器”直接当成长期监控数据源

---

## 三、核心设计判断

### 3.1 不建议直接监控自动扫描到的所有服务

原因：

- 本机临时进程和临时端口会很多
- 发现到的对象不一定代表业务服务
- 没有服务语义就很难设阈值、冷却、严重级别
- 会显著增加误报与噪音

因此应采用：

- **显式配置为主**
- **自动发现为辅**

也就是：

- 自动发现负责“找候选对象”
- 监控配置负责“确认哪些对象值得长期监控”

### 3.2 Monitor 不应只做单次检查，而应输出状态变化

真正值得进入 Agent 的，不是“某次检查失败了”，而是：

- 连续失败达到阈值
- 从正常进入异常
- 从异常恢复
- 异常持续时间达到某个门槛

因此下一阶段的核心不是简单增加 probe 数量，而是加强状态机与事件模型。

---

## 四、目标架构

建议形成如下结构：

```text
Monitor Rules + Local Discovery
        |
        v
  Monitor Engine / State Machine
        |
        v
  Monitor Incident Dispatcher
        |
        v
      Gateway
        |
        v
 Incident Session / Service Session
        |
        v
   Agent Runtime + Existing Tools
        |
        v
 Transcript / Audit / CLI
```

其中：

- `Local Discovery` 是辅助能力，不直接代替监控配置
- `Monitor Incident Dispatcher` 负责把状态变化转成结构化事件
- `Gateway` 负责把事件转为 Agent 输入
- `Agent` 负责分析和处置建议

---

## 五、分阶段实施方案

建议拆成 4 个阶段。

### Phase 1：打通 Monitor -> Agent 闭环

这是优先级最高的阶段。

目标：

- `monitor.alert` 和 `monitor.recovered` 不再只记录事件
- Gateway 正式支持 `monitor_event` 输入进入 Agent
- CLI 中能看到后台 monitor 触发的分析过程和结果

建议改动：

1. 扩展 Agent 输入类型

- 在 `src/agent/types.ts` 中增加 `kind: "monitor_event"`
- 字段建议包括：
  - `ruleId`
  - `monitorType`
  - `eventType`
  - `severity`
  - `summary`
  - `observedAt`
  - `details`
  - `consecutiveFailures`
  - `serviceKey?`

2. 扩展 Gateway monitor 入口

- 修改 `src/gateway/types.ts`
- 修改 `src/gateway/core.ts`
- 让 `dispatchMonitorEvent()` 的行为改成：
  - 为 monitor 事件创建或复用 incident session
  - 落 transcript
  - 启动 Agent run
  - 把事件流推给 CLI

3. 为 monitor 事件定义 session 路由策略

第一版建议：

- 按 `ruleId` 强绑定 session
- 同一条规则的持续异常与恢复都进入同一个 incident session
- 便于用户回看该服务的完整历史

建议 session title 形如：

```text
[monitor] cpu-usage
[monitor] healthy-service
```

4. Prompt 中增加 monitor 事件语义

- 让 Agent 明确知道 monitor 输入是系统触发事件
- 让 Agent 优先：
  - 解释异常
  - 判断是否需要进一步探测
  - 使用只读工具先确认现场
  - 避免直接进行高风险写操作

### Phase 2：增强 Monitor 状态模型

目标：

- 从“失败即告警”升级到“状态机驱动告警”

建议新增规则级状态：

- `healthy`
- `degraded`
- `failing`
- `recovering`

建议新增配置能力：

- `failure_threshold`
- `recovery_threshold`
- `incident_reopen_window`
- `max_agent_runs_per_window`

行为建议：

- 失败达到阈值后才触发 incident
- 恢复达到阈值后才发 recovered
- cooldown 不只是“静音”，还要限制 Agent 重复分析频率

### Phase 3：增加本地服务发现器

这一步不直接替代 monitor，而是生成候选对象。

Linux 优先建议支持：

1. 进程发现

- 扫描长期运行进程
- 提取：
  - `pid`
  - `comm / command`
  - `user`
  - `uptime`

2. 监听端口发现

- 发现当前监听中的 TCP 端口
- 提取：
  - `host`
  - `port`
  - `pid`
  - `processName`

3. systemd 服务发现

- 如果系统存在 `systemctl`
- 提取：
  - `serviceName`
  - `activeState`
  - `subState`
  - `description`

4. Docker 容器发现

- 如果本机可用 `docker`
- 只作为可选信息源
- 提取：
  - `containerName`
  - `image`
  - `status`
  - `publishedPorts`

发现器输出目标：

- 落到结构化 `json`
- 支持 CLI 查看
- 支持生成候选 monitor 配置草稿

### Phase 4：服务建模与配置升级

这一步把 `monitors.yaml` 从“探针列表”提升成“服务定义”。

建议保留兼容旧格式，但逐步增加字段：

- `service_key`
- `service_type`
- `discovery_source`
- `owner`
- `dependencies`
- `severity`
- `create_incident_session`
- `auto_analyze`

示例方向：

```yaml
monitors:
  - id: api-gateway-http
    service_key: api-gateway
    name: API Gateway HTTP 健康检查
    type: http
    interval: 30s
    target:
      url: http://localhost:8080/health
      expected_status: 200
    failure_threshold: 3
    recovery_threshold: 2
    on_failure:
      severity: critical
      create_incident_session: true
      auto_analyze: true
```

---

## 六、第一阶段的最小实现建议

为了尽快形成可用闭环，建议先只做 Phase 1。

第一阶段最小目标：

1. `monitor.alert` 自动进入 Agent
2. `monitor.recovered` 自动进入 Agent
3. 一个 `ruleId` 绑定一个 incident session
4. transcript 中记录 monitor 事件
5. CLI 可以看到 monitor 触发的分析结果

第一阶段暂不做：

- 本地服务自动发现
- systemd / docker 发现器
- monitor 配置格式升级
- 多层服务依赖模型
- 自动生成 monitor 配置草稿

---

## 七、建议新增与修改的文件

### 7.1 建议新增

- `src/monitor/discovery/types.ts`
- `src/monitor/discovery/local-discovery.ts`
- `src/monitor/discovery/render.ts`

说明：

- 这些文件属于 Phase 3
- Phase 1 可以先不新增 discovery 实现

### 7.2 建议修改

- `src/agent/types.ts`
- `src/agent/pi-runtime.ts`
- `src/gateway/types.ts`
- `src/gateway/core.ts`
- `src/memory/types.ts`
- `src/monitor/engine.ts`
- `src/monitor/types.ts`
- `src/cli/repl.ts`
- `config/prompts/system.txt`

---

## 八、测试建议

### 8.1 Phase 1 测试

- monitor alert 触发时创建 incident session
- 同一 `ruleId` 重复告警复用同一个 session
- recovered 事件进入同一 session
- monitor 事件写入 transcript
- Agent 收到的输入类型为 `monitor_event`
- CLI 可显示后台 monitor run 的结果

### 8.2 Phase 3 测试

- 进程发现输出稳定结构
- 端口发现输出稳定结构
- Linux 下 `systemctl` 不存在时优雅降级
- Docker 不可用时优雅降级

---

## 九、优先级结论

建议按以下顺序推进：

1. **Phase 1：Monitor -> Agent 闭环**
2. **Phase 2：状态机增强**
3. **Phase 3：本地服务发现器**
4. **Phase 4：服务建模与配置升级**

理由：

- 当前最大缺口不是“找不到更多服务”，而是“已有异常不会自动进入分析闭环”
- 先把闭环打通，现有 monitor 就已经显著更有价值
- 服务发现器是重要增强，但不应抢在 incident 闭环之前

---

## 十、结论

下一阶段不建议把方向改成“自动监控本机所有服务”。

更合理的路线是：

- **显式配置为主**
- **自动发现为辅**
- **状态变化驱动 incident**
- **incident 再进入 Agent 分析**

先打通 `Monitor -> Gateway -> Agent -> Transcript / CLI` 这条主链，再补服务发现和服务建模，会更稳、更可控。
