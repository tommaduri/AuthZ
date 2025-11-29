# Phase 5 Quick Reference Guide

**One-page reference for Phase 5 coordination activities**

---

## Key Dates

| Milestone | Date | Week |
|-----------|------|------|
| **Phase 5 Start** | Dec 1, 2025 | Week 1 |
| **Week 3 Checkpoint** (Agent Identity) | Dec 15, 2025 | Week 3 |
| **Week 6 Checkpoint** (Vector Store) | Dec 22, 2025 | Week 6 |
| **Week 7 Checkpoint** (Both Tracks) | Dec 29, 2025 | Week 7 |
| **Week 9 Checkpoint** (Integration) | Jan 12, 2026 | Week 9 |
| **Phase 5 Complete** | Jan 19, 2026 | Week 10 |

---

## Critical Path Dependencies

```
Track A: Vector Store (6 weeks, independent)
├── Week 1: Research & Design
├── Weeks 2-3: Core Implementation
├── Weeks 4-5: Integration
└── Week 6: Final optimization

Track B: Agent Identity (3 weeks, must complete for MCP to start)
├── Week 1: Research & Design
├── Weeks 2-3: Implementation
└── Week 3: CHECKPOINT (GATES MCP/A2A)
    └── Week 4: MCP/A2A Starts (4 weeks)

Integration Testing (2 weeks, starts after both tracks complete)
├── Week 8: Heavy testing
└── Week 9: System validation

Documentation (continuous, intensive Week 10)
└── Week 10: Final docs and release
```

---

## Daily Standup

**Run Daily (Morning):**
```bash
cd /Users/tommaduri/Documents/GitHub/authz-engine
bash coordination/PHASE5_DAILY_STANDUP.sh [week_number]
```

**Expected Output:**
- Test status (pass/fail count)
- Failing test names
- Memory system status
- Track progress estimate

**Quick Check (30 seconds):**
```bash
cd /Users/tommaduri/Documents/GitHub/authz-engine/go-core
go test ./... -v 2>&1 | tail -5
```

---

## Weekly Report Due Date

**Every Friday - End of Week**

**Create File:**
```bash
cp coordination/PHASE5_WEEKLY_TEMPLATE.md \
   coordination/PHASE5_WEEKLY_REPORTS/WEEK[XX]_REPORT.md
```

**Fill Out:**
1. Executive summary
2. Track A status
3. Track B status
4. Test results
5. Performance metrics
6. Blockers
7. Next week priorities

**Submit:** Share with user

---

## Test Commands

**Full Test Suite:**
```bash
cd /Users/tommaduri/Documents/GitHub/authz-engine/go-core
go test ./... -v
```

**Track A (Vector Store) Tests:**
```bash
go test ./internal/vector/... -v
go test ./tests/vector/... -v
```

**Track B (Agent Identity) Tests:**
```bash
go test ./internal/identity/... -v
go test ./tests/identity/... -v
```

**Track B (MCP/A2A) Tests:**
```bash
go test ./internal/mcp/... -v
go test ./internal/a2a/... -v
go test ./tests/mcp/... -v
```

**Performance Benchmarks:**
```bash
go test -bench=. -benchmem ./internal/vector/
go test -bench=. -benchmem ./internal/identity/
go test -bench=. -benchmem ./internal/mcp/
```

---

## Critical Deadlines

### BEFORE Week 1 Starts (Dec 1)
- [ ] Fix existing test failures
- [ ] Establish clean test baseline
- [ ] Assign agents to tracks
- [ ] Confirm Week 1 research tasks

### Week 3 Checkpoint (Dec 15)
- [ ] Agent Identity: 100% tests passing
- [ ] Agent Identity: Performance targets met
- [ ] Agent Identity: Code review complete
- [ ] **GATE: MCP/A2A can start Week 4**

### Week 6 Checkpoint (Dec 22)
- [ ] Vector Store: Core implementation done
- [ ] Vector Store: 80+ tests passing
- [ ] Vector Store: Performance on track

### Week 7 Checkpoint (Dec 29)
- [ ] Both tracks: 100% complete
- [ ] Both tracks: Ready for integration
- [ ] **GATE: Integration testing can start Week 8**

### Week 9 Checkpoint (Jan 12)
- [ ] Integration tests: 150+ tests passing
- [ ] Performance: Validated against targets
- [ ] System: Ready for production validation

### Phase 5 Complete (Jan 19)
- [ ] All 150+ tests passing
- [ ] Documentation complete
- [ ] Performance targets met
- [ ] Ready for deployment

---

## File Locations

**Coordination Files:**
```
coordination/
├── PHASE5_COORDINATION_PLAN.md ............ Main 10-week plan
├── PHASE5_BLOCKERS.md .................... Active blocker tracking
├── PHASE5_WEEKLY_TEMPLATE.md ............. Template for weekly reports
├── PHASE5_QUICK_REFERENCE.md ............ This file
├── PHASE5_DAILY_STANDUP.sh .............. Daily status check script
└── PHASE5_WEEKLY_REPORTS/
    ├── WEEK00_BASELINE.md ................ Week 0 baseline metrics
    ├── WEEK01_REPORT.md .................. (To be created)
    └── ...
```

**Go Core Code:**
```
go-core/
├── internal/
│   ├── vector/ ........................... Track A (Vector Store)
│   ├── identity/ ......................... Track B (Agent Identity)
│   ├── mcp/ ............................. Track B (MCP Server)
│   ├── a2a/ ............................. Track B (Agent-to-Agent)
│   └── ...
├── tests/
│   ├── vector/ ........................... Vector Store tests
│   ├── identity/ ......................... Identity tests
│   ├── mcp/ ............................. MCP tests
│   ├── integration/ ...................... Integration tests (Week 8+)
│   └── ...
├── docs/ ................................ Go Core documentation
└── ...
```

---

## Performance Targets (Quick Reference)

| Component | Target | Track |
|-----------|--------|-------|
| Vector embedding | < 50ms/item | A |
| Vector search | < 10ms/query | A |
| Agent authentication | < 5ms | B |
| Token validation | < 1ms | B |
| MCP request | < 20ms | B |
| A2A message delivery | < 10ms | B |
| Full auth check with vector | < 100ms | Integration |

---

## Test Pass Rate Targets

| Phase | Week | Target | Alert Level |
|-------|------|--------|------------|
| Development | 1-7 | > 90% | < 85% = escalate |
| Integration | 8-9 | > 95% | < 90% = escalate |
| Release | 10 | 100% | Any failure = blocker |

---

## Blocker Escalation

**IMMEDIATE (< 1 hour):**
- Test pass rate < 80%
- Security vulnerability
- Agent unavailable
- Build failure

**URGENT (< 4 hours):**
- Track slips > 2 days
- Performance misses > 20%
- Critical documentation gap

**NORMAL (< 24 hours):**
- Minor timeline adjustments
- Research findings
- Design decisions

---

## Agent Assignments

| Agent | Role | Tracks | Duration |
|-------|------|--------|----------|
| system-architect | Track A Lead | Vector Store | Weeks 1-6 |
| backend-dev | Track B Lead | Agent Identity + MCP/A2A | Weeks 1-7 |
| tester | Integration Lead | Testing | Weeks 8-9 |
| reviewer | Documentation | Docs + QA | Weeks 1-10 |
| planner | Coordinator | All | Weeks 1-10 |

---

## Useful Commands

**Check Memory System:**
```bash
ls -lh /Users/tommaduri/Documents/GitHub/authz-engine/.swarm/
```

**View Current Blockers:**
```bash
head -50 /Users/tommaduri/Documents/GitHub/authz-engine/coordination/PHASE5_BLOCKERS.md
```

**View Latest Report:**
```bash
ls -lt /Users/tommaduri/Documents/GitHub/authz-engine/coordination/PHASE5_WEEKLY_REPORTS/ | head -5
```

**Quick Project Status:**
```bash
cd /Users/tommaduri/Documents/GitHub/authz-engine
echo "=== Go Core Tests ===" && \
cd go-core && go test ./... -v 2>&1 | grep "^(PASS|FAIL)" | sort | uniq -c
```

---

## When Tests Fail

**Step 1: Identify Failures**
```bash
go test ./... -v 2>&1 | grep "^FAIL"
```

**Step 2: Get Details**
```bash
go test [package] -v -run [TestName]
```

**Step 3: Log Blocker**
Update `/Users/tommaduri/Documents/GitHub/authz-engine/coordination/PHASE5_BLOCKERS.md`

**Step 4: Escalate if Critical**
If test pass rate drops below 85%, escalate immediately

---

## Documentation Structure

**Weekly Report Template:**
- Executive Summary (1-2 sentences)
- Track A Status (goals, tests, blockers)
- Track B Status (goals, tests, blockers)
- Integration Status (test results)
- Documentation Alignment (divergences)
- Performance Metrics (vs targets)
- Risk Assessment (timeline confidence)
- Next Week Priorities
- Files & Artifacts (references)

---

## Team Communication

**Daily:** Memory updates (async)
**Weekly:** Progress report (Friday)
**Escalation:** Immediate notification

**Coordinator Responsibilities:**
1. Daily standup check
2. Weekly progress report
3. Blocker escalation
4. Dependency management
5. Risk monitoring

---

## Success Definition

**Phase 5 Complete When:**
- ✅ All 150+ tests passing
- ✅ All performance targets met
- ✅ All documentation complete
- ✅ Integration validated
- ✅ Ready for production deployment

---

## Quick Links

- **Main Plan:** `PHASE5_COORDINATION_PLAN.md`
- **Blockers:** `PHASE5_BLOCKERS.md`
- **Reports:** `PHASE5_WEEKLY_REPORTS/`
- **Week 0 Baseline:** `PHASE5_WEEKLY_REPORTS/WEEK00_BASELINE.md`

---

**This quick reference should be your go-to resource for Phase 5 coordination.**
**For details, see the main coordination plan document.**

**Last Updated:** November 25, 2025
**Next Update:** Weekly with each progress report
